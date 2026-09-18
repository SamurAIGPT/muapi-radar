import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { mentions, trends } from '@/lib/db/schema';
import { callClaude, claudeAvailable, MODELS } from '@/lib/claude';

export type Trend = typeof trends.$inferSelect;

export async function computeTrends(projectId: number): Promise<number> {
  const db = await getDb();
  const { projects } = await import('@/lib/db/schema');
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const selfTopics = new Set((project?.keywords ?? []).map((k) => k.toLowerCase()));
  const h24 = new Date(Date.now() - 24 * 3600_000).toISOString();
  const d5 = new Date(Date.now() - 5 * 86400_000).toISOString();

  const rows = await db.execute(sql`
    SELECT t AS topic,
      count(*) FILTER (WHERE published_at >= ${h24}::timestamptz) AS n24,
      count(*) FILTER (WHERE published_at < ${h24}::timestamptz) / 4.0 AS baseline
    FROM mentions, jsonb_array_elements_text(topics) AS t
    WHERE project_id = ${projectId} AND published_at >= ${d5}::timestamptz
    GROUP BY t
    HAVING count(*) FILTER (WHERE published_at >= ${h24}::timestamptz) >= 4
  `);

  const emerging = (rows.rows as { topic: string; n24: number; baseline: number }[])
    .map((r) => ({
      topic: r.topic,
      n24: Number(r.n24),
      baseline: Number(r.baseline),
      score: Math.min(50, Number(r.n24) / Math.max(0.5, Number(r.baseline))),
    }))
    .filter((r) => r.score >= 2.5 && !selfTopics.has(r.topic.toLowerCase()))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  await db.delete(trends).where(eq(trends.projectId, projectId));
  if (emerging.length === 0) return 0;
  await db.insert(trends).values(emerging.map((e) => ({ projectId, ...e })));
  return emerging.length;
}

export async function explainTrends(projectId: number): Promise<number> {
  const db = await getDb();
  if (!await claudeAvailable()) return 0;
  const current = await db.select().from(trends)
    .where(and(eq(trends.projectId, projectId), sql`${trends.explanation} IS NULL`))
    .orderBy(desc(trends.score)).limit(5);
  if (current.length === 0) return 0;

  const h48 = new Date(Date.now() - 48 * 3600_000);
  let explained = 0;
  for (const t of current) {
    const sample = await db.select({ title: mentions.title, content: mentions.content, source: mentions.source })
      .from(mentions)
      .where(and(
        eq(mentions.projectId, projectId),
        gte(mentions.publishedAt, h48),
        sql`${mentions.topics} @> ${JSON.stringify([t.topic])}::jsonb`,
      ))
      .orderBy(desc(mentions.engagementScore)).limit(8);
    const text = await callClaude(
      MODELS.haiku, 'trend_radar',
      'You are a media analyst. Explain in ONE sentence in English (max 30 words) why this topic is growing right now, based on the provided content. Respond only with the sentence.',
      `Growing topic: "${t.topic}" (${t.n24} mentions in 24h, baseline ${t.baseline.toFixed(1)}/day)\n\nContent:\n${sample.map((s) => `- ${(s.title ?? s.content).slice(0, 150)}`).join('\n')}`,
      150, true,
    );
    if (text) {
      await db.update(trends).set({ explanation: text.trim() }).where(eq(trends.id, t.id));
      explained++;
    }
  }
  return explained;
}

export async function getTrends(projectId: number): Promise<Trend[]> {
  const db = await getDb();
  return db.select().from(trends)
    .where(eq(trends.projectId, projectId))
    .orderBy(desc(trends.score));
}
