import { and, desc, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { mentions } from '@/lib/db/schema';
import { fetchArticles } from '@/lib/article-text';

export async function enrichArticles(projectId: number, limit = 150): Promise<{
  tried: number; extracted: number;
}> {
  const db = await getDb();

  // Mark opaque Google News links so they do not exhaust fetch queues
  await db.update(mentions).set({ articleAt: new Date() })
    .where(and(
      eq(mentions.projectId, projectId),
      isNull(mentions.articleAt),
      sql`${mentions.url} ILIKE '%news.google.%'`,
    ));

  const todo = await db.select({ id: mentions.id, url: mentions.url })
    .from(mentions)
    .where(and(
      eq(mentions.projectId, projectId),
      eq(mentions.kind, 'article'),
      isNull(mentions.articleAt),
      isNotNull(mentions.url),
    ))
    .orderBy(desc(mentions.publishedAt))
    .limit(limit);

  const jobs = todo.filter((r): r is { id: number; url: string } => Boolean(r.url));
  if (jobs.length === 0) return { tried: 0, extracted: 0 };

  const texts = await fetchArticles(jobs);

  for (const job of jobs) {
    const text = texts.get(job.id);
    await db.update(mentions)
      .set({ articleAt: new Date(), ...(text ? { articleText: text } : {}) })
      .where(eq(mentions.id, job.id));
  }

  return { tried: jobs.length, extracted: texts.size };
}

export async function articleCoverage(projectId: number): Promise<{
  articles: number; withText: number; opaque: number; posts: number;
}> {
  const db = await getDb();
  const [r] = await db.select({
    articles: sql<number>`count(*) FILTER (WHERE ${mentions.kind} = 'article')`,
    withText: sql<number>`count(*) FILTER (WHERE ${mentions.articleText} IS NOT NULL)`,
    opaque: sql<number>`count(*) FILTER (WHERE ${mentions.kind} = 'article' AND ${mentions.url} ILIKE '%news.google.%')`,
    posts: sql<number>`count(*) FILTER (WHERE ${mentions.kind} = 'post')`,
  }).from(mentions).where(eq(mentions.projectId, projectId));
  return {
    articles: Number(r?.articles ?? 0),
    withText: Number(r?.withText ?? 0),
    opaque: Number(r?.opaque ?? 0),
    posts: Number(r?.posts ?? 0),
  };
}
