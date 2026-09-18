import Anthropic from '@anthropic-ai/sdk';
import { sql, and, isNull, eq, desc, gte, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { apiUsage, mentions, stories, briefs, type Quality } from '@/lib/db/schema';
import { NEWS_SOURCES } from '@/lib/connectors';
import { aiProvider, aiModels, providerKey, priceFor, callOpenAICompat } from '@/lib/ai-provider';

const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';

export async function anthropicKey(): Promise<string | undefined> {
  return providerKey('anthropic');
}

export async function claudeAvailable(): Promise<boolean> {
  return Boolean(await providerKey(await aiProvider()));
}

export async function aiStatus(): Promise<{
  hasKey: boolean; spend: number; budget: number; capReached: boolean; ready: boolean;
}> {
  const hasKey = await claudeAvailable();
  const [spend, budget] = await Promise.all([currentSpendUsd(), budgetUsd()]);
  const capReached = spend >= budget;
  return { hasKey, spend, budget, capReached, ready: hasKey && !capReached };
}

export async function budgetUsd(): Promise<number> {
  const { getMeta } = await import('@/lib/db');
  const meta = await getMeta<number>('api_budget_usd');
  if (typeof meta === 'number' && meta > 0) return meta;
  const n = Number(process.env.API_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

export async function spendResetAt(): Promise<Date> {
  const { getMeta } = await import('@/lib/db');
  const iso = await getMeta<string>('spend_reset_at');
  if (iso) { const d = new Date(iso); if (!Number.isNaN(d.getTime())) return d; }
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  return start;
}

export async function currentSpendUsd(): Promise<number> {
  const db = await getDb();
  const since = await spendResetAt();
  const [row] = await db.select({ cost: sql<number | null>`sum(${apiUsage.costUsd})` })
    .from(apiUsage).where(gte(apiUsage.ts, since));
  return Number(row?.cost ?? 0);
}

export async function lifetimeSpendUsd(): Promise<{ cost: number; calls: number }> {
  const db = await getDb();
  const [row] = await db.select({
    cost: sql<number | null>`sum(${apiUsage.costUsd})`,
    calls: sql<number>`count(*)`,
  }).from(apiUsage);
  return { cost: Number(row?.cost ?? 0), calls: Number(row?.calls ?? 0) };
}

export async function costControl() {
  const db = await getDb();
  const [budget, since, lifetime] = await Promise.all([budgetUsd(), spendResetAt(), lifetimeSpendUsd()]);
  const [cur] = await db.select({
    cost: sql<number | null>`sum(${apiUsage.costUsd})`,
    calls: sql<number>`count(*)`,
    inTok: sql<number | null>`sum(${apiUsage.inputTokens})`,
    outTok: sql<number | null>`sum(${apiUsage.outputTokens})`,
  }).from(apiUsage).where(gte(apiUsage.ts, since));
  const byPurpose = await db.select({
    purpose: apiUsage.purpose,
    cost: sql<number | null>`sum(${apiUsage.costUsd})`,
    calls: sql<number>`count(*)`,
  }).from(apiUsage).where(gte(apiUsage.ts, since)).groupBy(apiUsage.purpose);
  return {
    budget,
    resetAt: since.toISOString(),
    current: {
      cost: Number(cur?.cost ?? 0), calls: Number(cur?.calls ?? 0),
      inTok: Number(cur?.inTok ?? 0), outTok: Number(cur?.outTok ?? 0),
    },
    byPurpose: byPurpose.map((p) => ({ purpose: p.purpose, cost: Number(p.cost ?? 0), calls: Number(p.calls) })),
    lifetime,
  };
}

export const MODELS = { haiku: HAIKU, sonnet: SONNET };

function sanitize(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

export type AiFailure =
  | { why: 'demo'; message: string }
  | { why: 'no-key'; message: string }
  | { why: 'budget'; message: string }
  | { why: 'call-failed'; message: string }
  | { why: 'empty'; message: string };

export type AiResult = { text: string | null; failure?: AiFailure };

export async function callClaudeDetailed(model: string, purpose: string, system: string, user: string, maxTokens: number, localize = false, timeoutMs = 50_000): Promise<AiResult> {
  if (process.env.DEMO_MODE === '1') {
    return { text: null, failure: { why: 'demo', message: 'Demo mode active: AI generation is simulated/disabled.' } };
  }
  const provider = await aiProvider();
  const key = await providerKey(provider);
  if (!key) {
    return { text: null, failure: { why: 'no-key', message: 'No AI API key configured (Settings -> Budget).' } };
  }
  if (localize) {
    const { getContentLocale, localeDirective } = await import('@/lib/content-locale');
    system += localeDirective(await getContentLocale());
  }
  system = sanitize(system);
  user = sanitize(user);

  const [spend, budget] = await Promise.all([currentSpendUsd(), budgetUsd()]);
  if (spend >= budget) {
    console.warn(`[ai] spend cap reached ($${spend.toFixed(2)}/$${budget}): "${purpose}" call skipped`);
    return {
      text: null,
      failure: {
        why: 'budget',
        message: `Spend cap reached: $${spend.toFixed(2)} / $${budget}. Reset counter in Settings -> Budget.`,
      },
    };
  }

  let actualModel = model;
  if (provider !== 'anthropic') {
    const m = await aiModels(provider);
    actualModel = model === HAIKU ? m.fast : model === SONNET ? m.smart : model;
  }

  let text: string | null;
  let inputTokens: number;
  let outputTokens: number;
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: key });
    try {
      const msg = await client.messages.create(
        { model: actualModel, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
        { timeout: timeoutMs, maxRetries: 0 },
      );
      const block = msg.content.find((b) => b.type === 'text');
      text = block?.type === 'text' ? block.text : null;
      inputTokens = msg.usage.input_tokens;
      outputTokens = msg.usage.output_tokens;
    } catch (e) {
      console.error(`[ai] "${purpose}" call failed:`, e);
      const msg = (e as Error).message ?? String(e);
      return {
        text: null,
        failure: {
          why: 'call-failed',
          message: /\b401\b|authentication_error|invalid.*api.?key|unauthorized/i.test(msg)
            ? 'The AI API key was rejected: it is invalid or expired. Update in Settings -> Budget.'
            : /\b429\b|rate.?limit/i.test(msg)
              ? 'Rate limit reached on AI provider. Try again in a few minutes.'
              : `AI provider error: ${msg.slice(0, 200)}`,
        },
      };
    }
  } else {
    try {
      const r = await callOpenAICompat(provider, key, actualModel, system, user, maxTokens);
      text = r.text;
      inputTokens = r.inputTokens;
      outputTokens = r.outputTokens;
    } catch (e) {
      console.error(`[ai] "${purpose}" call failed:`, e);
      const msg = (e as Error).message ?? String(e);
      return {
        text: null,
        failure: {
          why: 'call-failed',
          message: /\b401\b|authentication_error|invalid.*api.?key|unauthorized/i.test(msg)
            ? 'The AI API key was rejected: it is invalid or expired. Update in Settings -> Budget.'
            : /\b429\b|rate.?limit/i.test(msg)
              ? 'Rate limit reached on AI provider. Try again in a few minutes.'
              : `AI provider error: ${msg.slice(0, 200)}`,
        },
      };
    }
  }

  if (!text) {
    return { text: null, failure: { why: 'empty', message: 'The model returned an empty response.' } };
  }

  const price = priceFor(provider, actualModel);
  const cost = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  const db = await getDb();
  await db.insert(apiUsage).values({
    model: actualModel, purpose,
    inputTokens, outputTokens,
    costUsd: cost,
  });
  return { text };
}

export async function callClaude(model: string, purpose: string, system: string, user: string, maxTokens: number, localize = false, timeoutMs = 50_000): Promise<string | null> {
  return (await callClaudeDetailed(model, purpose, system, user, maxTokens, localize, timeoutMs)).text;
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = Math.min(
    ...['[', '{'].map((c) => { const i = cleaned.indexOf(c); return i === -1 ? Infinity : i; }),
  );
  if (!Number.isFinite(start)) return null;
  const candidate = cleaned.slice(start);
  const end = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'));
  try {
    return JSON.parse(candidate.slice(0, end + 1)) as T;
  } catch {
    return null;
  }
}

type AnalysisRow = {
  id: number; language: string; sentiment: 'positive' | 'neutral' | 'negative';
  sentiment_score: number; relevance: number; relevance_reason: string;
  topics: string[]; entities: string[]; emotion: string;
};

export const EMOTIONS = ['joy', 'trust', 'fear', 'anger', 'sadness', 'surprise'] as const;

const ANALYSIS_SYSTEM = `You are a media intelligence analyst. You receive the monitored topic and a JSON array of items (news, social posts).
For EACH item, return an object with:
- id: the same id you received
- language: ISO 639-1 code of the text's language (e.g. "it", "en")
- sentiment: "positive", "neutral" or "negative" — about the tone of the content toward the topic it discusses
- sentiment_score: number from -1 (very negative) to 1 (very positive)
- emotion: dominant emotion, one of "joy", "trust", "fear", "anger", "sadness", "surprise"
- relevance: 1-5, how relevant and important the item is for someone monitoring the topic (5 = central and weighty, 3 = ordinary, 1 = marginal/off-topic)
- relevance_reason: at most 12 words in English explaining the relevance judgment
- topics: at most 3 topics in English, short (1-3 words, lowercase)
- entities: at most 5 named entities (brands, companies, people, products)
Respond ONLY with the JSON array, no other text.`;

export async function analyzePendingMentions(projectId: number, theme: string, limit = 80): Promise<{ analyzed: number; pending: number }> {
  const db = await getDb();
  const d3 = new Date(Date.now() - 3 * 86400_000);
  const pendingCond = sql`(${mentions.analyzedAt} IS NULL OR ((${mentions.relevance} IS NULL OR ${mentions.emotion} IS NULL) AND ${mentions.publishedAt} >= ${d3.toISOString()}::timestamptz))`;
  const pending = await db.select({
    id: mentions.id, title: mentions.title, content: mentions.content, source: mentions.source,
    articleText: mentions.articleText,
  }).from(mentions)
    .where(and(eq(mentions.projectId, projectId), pendingCond))
    .orderBy(desc(mentions.publishedAt))
    .limit(limit);

  if (pending.length === 0 || !(await claudeAvailable())) {
    return { analyzed: 0, pending: pending.length };
  }

  const chunks: typeof pending[] = [];
  for (let i = 0; i < pending.length; i += 20) chunks.push(pending.slice(i, i + 20));

  let analyzed = 0;
  await Promise.all(chunks.map(async (chunk) => {
    const payload = chunk.map((m) => ({
      id: m.id,
      text: (m.articleText
        ? `${m.title ?? ''}\n${m.articleText}`
        : `${m.title ?? ''} ${m.content}`).slice(0, 900).trim(),
    }));
    try {
      const text = await callClaude(
        HAIKU, 'mention_analysis', ANALYSIS_SYSTEM,
        `Monitored topic: ${theme}\n\n${JSON.stringify(payload)}`, 3800,
      );
      const rows = parseJson<AnalysisRow[]>(text);
      if (!rows) return;
      const sentimentMap: Record<string, string> = { positive: 'positive', neutral: 'neutral', negative: 'negative' };
      for (const r of rows) {
        if (!chunk.some((m) => m.id === r.id)) continue;
        const emotion = (EMOTIONS as readonly string[]).includes((r.emotion ?? '').toLowerCase())
          ? (r.emotion as string).toLowerCase() : null;
        await db.update(mentions).set({
          language: r.language?.slice(0, 5),
          sentiment: sentimentMap[r.sentiment] ?? 'neutral',
          sentimentScore: Math.max(-1, Math.min(1, Number(r.sentiment_score) || 0)),
          emotion,
          relevance: Math.max(1, Math.min(5, Math.round(Number(r.relevance)) || 3)),
          relevanceReason: r.relevance_reason?.slice(0, 200) ?? null,
          topics: (r.topics ?? []).slice(0, 3),
          entities: (r.entities ?? []).slice(0, 5),
          analyzedAt: new Date(),
        }).where(eq(mentions.id, r.id));
        analyzed++;
      }
    } catch (e) {
      console.error('Batch analysis failed:', e);
    }
  }));

  return { analyzed, pending: pending.length - analyzed };
}

const QUALITY_SYSTEM = `You are a social content analyst. You receive a JSON array of high-engagement items.
For EACH item, return:
- id: the same id
- score: 0-100, overall content quality (informativeness, credibility, relevance to the topic)
- relevance: 0-100, pertinence to the monitored topic
- virality: 0-100, spread potential
- risk: "low", "medium" or "high" — reputational risk
- note: one sentence in English (max 15 words) justifying the judgment
Respond ONLY with the JSON array.`;

export async function scoreTopContent(projectId: number, topic: string): Promise<number> {
  const db = await getDb();
  if (!(await claudeAvailable())) return 0;
  const since = new Date(Date.now() - 7 * 86400_000);
  const top = await db.select({
    id: mentions.id, title: mentions.title, content: mentions.content,
    source: mentions.source, engagementScore: mentions.engagementScore,
  }).from(mentions)
    .where(and(
      eq(mentions.projectId, projectId),
      gte(mentions.publishedAt, since),
      isNull(mentions.quality),
      sql`${mentions.engagementScore} > 0`,
    ))
    .orderBy(desc(mentions.engagementScore))
    .limit(20);
  if (top.length === 0) return 0;

  const payload = top.map((m) => ({
    id: m.id, source: m.source, text: `${m.title ?? ''} ${m.content}`.slice(0, 500).trim(),
  }));
  const text = await callClaude(
    SONNET, 'content_ratings', QUALITY_SYSTEM,
    `Monitored topic: ${topic}\n\n${JSON.stringify(payload)}`, 3500, true,
  );
  const rows = parseJson<(Quality & { id: number })[]>(text);
  if (!rows) return 0;
  let updated = 0;
  for (const r of rows) {
    if (!top.some((m) => m.id === r.id)) continue;
    await db.update(mentions).set({
      quality: {
        score: Math.max(0, Math.min(100, Number(r.score) || 0)),
        relevance: Math.max(0, Math.min(100, Number(r.relevance) || 0)),
        virality: Math.max(0, Math.min(100, Number(r.virality) || 0)),
        risk: ['low', 'medium', 'high'].includes(r.risk) ? r.risk : 'low',
        note: r.note,
      },
    }).where(eq(mentions.id, r.id));
    updated++;
  }
  return updated;
}

const STORIES_SYSTEM = `You are a media analyst. You receive news headlines (with id) about the same sector.
Group the ones covering the SAME story/event (even across different languages).
Respond ONLY with a JSON array of objects: { "title": "story title in English", "summary": "1-2 sentence summary in English", "ids": [id, ...] }.
Include only stories with at least 2 articles. Ignore articles that cannot be grouped.`;

export async function clusterNewsStories(projectId: number): Promise<number> {
  const db = await getDb();
  if (!(await claudeAvailable())) return 0;
  const since = new Date(Date.now() - 48 * 3600_000);
  const news = await db.select({ id: mentions.id, title: mentions.title })
    .from(mentions)
    .where(and(
      eq(mentions.projectId, projectId),
      gte(mentions.publishedAt, since),
      inArray(mentions.source, NEWS_SOURCES),
      isNull(mentions.storyId),
    ))
    .orderBy(desc(mentions.publishedAt))
    .limit(60);
  if (news.length < 4) return 0;

  const payload = news.filter((n) => n.title).map((n) => ({ id: n.id, title: n.title!.slice(0, 150) }));
  const text = await callClaude(SONNET, 'story_clustering', STORIES_SYSTEM, JSON.stringify(payload), 3000, true);
  const groups = parseJson<{ title: string; summary: string; ids: number[] }[]>(text);
  if (!groups) return 0;

  let created = 0;
  for (const g of groups) {
    const validIds = (g.ids ?? []).filter((id) => news.some((n) => n.id === id));
    if (validIds.length < 2 || !g.title) continue;
    const [story] = await db.insert(stories).values({
      projectId, title: g.title, summary: g.summary ?? null,
    }).returning();
    await db.update(mentions).set({ storyId: story.id }).where(inArray(mentions.id, validIds));
    created++;
  }
  return created;
}

const BRIEF_SYSTEM = `You are a senior media intelligence analyst. Write a DAILY executive briefing in English, in Markdown, for a decision-maker monitoring a sector.
Required structure:
## At a glance (3 essential bullets)
## What happened (the main stories, with context)
## Sentiment and conversations (tone, where it's discussed, emerging topics)
## Risks and opportunities (concrete, actionable)
Max 500 words. Professional, direct tone. Base it ONLY on the provided data; if data is scarce, say so openly.
The payload states the WINDOW the figures cover. If it is not 24 hours, state so in one line at the top and write the briefing over that wider window instead.`;

export async function generateDailyBrief(
  projectId: number, projectName: string,
  briefData: { window: string; total: number } & Record<string, unknown>,
): Promise<boolean> {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const [existing] = await db.select({ id: briefs.id }).from(briefs)
    .where(and(eq(briefs.projectId, projectId), eq(briefs.briefDate, today)));
  if (existing) return true;

  if (!briefData.total) {
    console.warn(`[brief] "${projectName}": no mentions in window — brief not generated`);
    return false;
  }

  if (!(await claudeAvailable())) return false;
  const text = await callClaude(
    SONNET, 'daily_brief', BRIEF_SYSTEM,
    `Monitored sector: ${projectName}\nDate: ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}\n`
    + `\nWINDOW COVERED BY THIS DATA: ${briefData.window} (${briefData.total} mentions)\n`
    + `${JSON.stringify(briefData).slice(0, 9000)}`,
    1300, true,
  );
  if (!text) return false;
  await db.insert(briefs).values({ projectId, briefDate: today, content: text })
    .onConflictDoUpdate({
      target: [briefs.projectId, briefs.briefDate],
      set: { content: text, createdAt: new Date() },
    });
  return true;
}
