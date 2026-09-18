import { sql } from 'drizzle-orm';
import { getDb, getMeta, setMeta } from '@/lib/db';
import { callClaude, claudeAvailable, MODELS } from '@/lib/claude';
import { getCurrentProject } from '@/lib/data';
import { getNarratives } from '@/lib/narratives';
import { researchEvidence, topicResearchTrends, type ResearchEvidence } from '@/lib/openalex';
import { getContentLocale, type ContentLocale } from '@/lib/content-locale';

const TZ = 'UTC';

export type TopicShift = {
  topic: string; nNow: number; nPrev: number; changePct: number | null;
  sNow: number | null; sPrev: number | null;
  status: 'emerging' | 'rising' | 'stable' | 'declining';
};
export type Citation = {
  id: number; title: string; source: string; date: string;
  sentiment: string | null; url: string | null; engagement: number;
};
export type FactPack = {
  days: number;
  total: number;
  totalNow: number;
  totalPrev: number;
  volumeChangePct: number | null;
  sentNow: number | null;
  sentPrev: number | null;
  weekly: { week: string; n: number; s: number | null }[];
  topics: TopicShift[];
  sources: { source: string; n: number; s: number | null }[];
  peaks: { day: string; n: number; topic: string | null }[];
  citations: Citation[];
  narratives: { title: string; stance: string | null; coordinated: boolean; posts: number }[];
};

export type SignalCross = {
  topic: string;
  marketChangePct: number | null;
  marketNow: number;
  researchWorks: number;
  researchGrowthPct: number | null;
  quadrant: 'ahead' | 'validated' | 'hype' | 'cooling' | 'unknown';
};

export type PovStat = { value: string; label: string };

export type PovBlock = {
  title: string;
  kind: 'trend' | 'innovation' | 'concept' | 'risk' | 'opportunity';
  body: string;
  stats: PovStat[];
  confidence: 'high' | 'medium' | 'low';
  citations: number[];
};

export type PovIntro = { text: string; citations: number[]; research: number[] };

export type PointOfView = {
  headline: string;
  intro: PovIntro[];
  blocks: PovBlock[];
  counterSignals: { point: string; citations: number[] }[];
  implications: string[];
  watch: string[];
  generatedAt: string;
  locale?: ContentLocale;
};

export async function povFactPack(projectId: number, days = 90): Promise<FactPack> {
  const db = await getDb();
  const half = Math.round(days / 3);
  const nowSince = new Date(Date.now() - half * 86400_000).toISOString();
  const prevSince = new Date(Date.now() - half * 2 * 86400_000).toISOString();
  const winSince = new Date(Date.now() - days * 86400_000).toISOString();

  const [totals] = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE published_at >= ${winSince}::timestamptz) AS total,
      count(*) FILTER (WHERE published_at >= ${nowSince}::timestamptz) AS n_now,
      count(*) FILTER (WHERE published_at >= ${prevSince}::timestamptz
                         AND published_at < ${nowSince}::timestamptz) AS n_prev,
      avg(sentiment_score) FILTER (WHERE published_at >= ${nowSince}::timestamptz) AS s_now,
      avg(sentiment_score) FILTER (WHERE published_at >= ${prevSince}::timestamptz
                                     AND published_at < ${nowSince}::timestamptz) AS s_prev
    FROM mentions WHERE project_id = ${projectId}
  `)).rows as { total: number; n_now: number; n_prev: number; s_now: number | null; s_prev: number | null }[];

  const weekly = (await db.execute(sql`
    SELECT to_char(date_trunc('week', published_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS week,
           count(*) AS n, avg(sentiment_score) AS s
    FROM mentions
    WHERE project_id = ${projectId} AND published_at >= ${winSince}::timestamptz
    GROUP BY 1 ORDER BY 1
  `)).rows as { week: string; n: number; s: number | null }[];

  const topicRows = (await db.execute(sql`
    WITH recent AS (
      SELECT t AS topic, count(*) AS n, avg(sentiment_score) AS s
      FROM mentions, jsonb_array_elements_text(topics) AS t
      WHERE project_id = ${projectId} AND published_at >= ${nowSince}::timestamptz
      GROUP BY t
    ), prior AS (
      SELECT t AS topic, count(*) AS n, avg(sentiment_score) AS s
      FROM mentions, jsonb_array_elements_text(topics) AS t
      WHERE project_id = ${projectId} AND published_at >= ${prevSince}::timestamptz
        AND published_at < ${nowSince}::timestamptz
      GROUP BY t
    )
    SELECT coalesce(r.topic, p.topic) AS topic,
           coalesce(r.n, 0) AS n_now, coalesce(p.n, 0) AS n_prev,
           r.s AS s_now, p.s AS s_prev
    FROM recent r FULL OUTER JOIN prior p ON r.topic = p.topic
    ORDER BY (coalesce(r.n, 0) + coalesce(p.n, 0)) DESC
    LIMIT 14
  `)).rows as { topic: string; n_now: number; n_prev: number; s_now: number | null; s_prev: number | null }[];

  const topics: TopicShift[] = topicRows.map((r) => {
    const nNow = Number(r.n_now), nPrev = Number(r.n_prev);
    const changePct = nPrev > 0 ? Math.round(((nNow - nPrev) / nPrev) * 100) : null;
    const status: TopicShift['status'] =
      nPrev === 0 && nNow >= 3 ? 'emerging'
        : changePct !== null && changePct >= 40 ? 'rising'
          : changePct !== null && changePct <= -40 ? 'declining'
            : 'stable';
    return {
      topic: r.topic, nNow, nPrev, changePct,
      sNow: r.s_now === null ? null : Math.round(Number(r.s_now) * 100) / 100,
      sPrev: r.s_prev === null ? null : Math.round(Number(r.s_prev) * 100) / 100,
      status,
    };
  });

  const sources = (await db.execute(sql`
    SELECT source, count(*) AS n, avg(sentiment_score) AS s
    FROM mentions
    WHERE project_id = ${projectId} AND published_at >= ${winSince}::timestamptz
    GROUP BY source ORDER BY n DESC LIMIT 10
  `)).rows as { source: string; n: number; s: number | null }[];

  const peaks = (await db.execute(sql`
    SELECT to_char(published_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, count(*) AS n,
           mode() WITHIN GROUP (ORDER BY t) AS topic
    FROM mentions LEFT JOIN LATERAL jsonb_array_elements_text(topics) AS t ON true
    WHERE project_id = ${projectId} AND published_at >= ${winSince}::timestamptz
    GROUP BY 1 ORDER BY n DESC LIMIT 3
  `)).rows as { day: string; n: number; topic: string | null }[];

  const citations = (await db.execute(sql`
    SELECT id, coalesce(title, left(content, 160)) AS title, source,
           to_char(published_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS date,
           sentiment, url, engagement_score AS engagement
    FROM mentions
    WHERE project_id = ${projectId} AND published_at >= ${nowSince}::timestamptz
      AND coalesce(title, content) IS NOT NULL
    ORDER BY relevance DESC NULLS LAST, engagement_score DESC
    LIMIT 30
  `)).rows as Citation[];

  const narr = await getNarratives(projectId);

  return {
    days,
    total: Number(totals?.total ?? 0),
    totalNow: Number(totals?.n_now ?? 0),
    totalPrev: Number(totals?.n_prev ?? 0),
    volumeChangePct: Number(totals?.n_prev ?? 0) > 0
      ? Math.round(((Number(totals.n_now) - Number(totals.n_prev)) / Number(totals.n_prev)) * 100) : null,
    sentNow: totals?.s_now == null ? null : Math.round(Number(totals.s_now) * 100) / 100,
    sentPrev: totals?.s_prev == null ? null : Math.round(Number(totals.s_prev) * 100) / 100,
    weekly: weekly.map((w) => ({ week: w.week, n: Number(w.n), s: w.s === null ? null : Math.round(Number(w.s) * 100) / 100 })),
    topics,
    sources: sources.map((s) => ({ source: s.source, n: Number(s.n), s: s.s === null ? null : Math.round(Number(s.s) * 100) / 100 })),
    peaks: peaks.map((p) => ({ day: p.day, n: Number(p.n), topic: p.topic })),
    citations: citations.map((c) => ({ ...c, id: Number(c.id), engagement: Math.round(Number(c.engagement ?? 0)) })),
    narratives: narr.slice(0, 6).map((n) => ({
      title: n.title, stance: n.stance, coordinated: n.coordinated === 1, posts: n.mentionCount,
    })),
  };
}

const POV_SYSTEM = `You are a senior market analyst writing a Point of View that will be turned into PRESENTATION SLIDES.

You receive VERIFIED figures (already computed — never recompute or invent numbers) plus a CLOSED list of citable posts and, when available, academic research evidence.

Produce 3-5 BLOCKS. Each block must work as one slide: a title that NAMES the idea, a paragraph with real substance, and the numbers that prove it.

Rules:
- "title": name the trend / innovation / concept, do not describe it vaguely. Max 8 words, specific and memorable.
- "body": 3-4 full sentences of real substance — what is happening, what is driving it, why it matters for decisions.
- "stats": 2-3 figures taken ONLY from the provided data, each with a short label.
- "citations": 1-3 post ids taken ONLY from the provided citable list.
- Be intellectually honest: also give counter-signals.
- Set confidence honestly: "high", "medium", or "low".

Cross-reference market vs research data:
- "ahead": research accelerating, market not caught up yet
- "validated": both rising -> structural shift
- "hype": market loud, research not backing -> fragile
- "cooling": neither moving

Respond ONLY with this JSON object:
{
  "headline": "<the overall thesis in one sentence>",
  "intro": [{
    "text": "<a paragraph of opening argument>",
    "citations": [<post ids>],
    "research": [<indexes into recent_research>]
  }],
  "blocks": [{
    "title": "<the named idea — max 8 words>",
    "kind": "trend|innovation|concept|risk|opportunity",
    "body": "<3-4 substantial sentences>",
    "stats": [{ "value": "<figure>", "label": "<what it measures>" }],
    "confidence": "high|medium|low",
    "citations": [<post ids>]
  }],
  "counterSignals": [{ "point": "<counter argument>", "citations": [<post ids>] }],
  "implications": ["<strategic takeaway>"],
  "watch": ["<leading indicator to monitor>"]
}`;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function validate(raw: unknown, allowed: Set<number>, researchCount = 0): PointOfView | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const ids = (v: unknown) => asArray(v).map(Number).filter((n) => allowed.has(n)).slice(0, 3);
  const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const KINDS = ['trend', 'innovation', 'concept', 'risk', 'opportunity'] as const;

  const blocks: PovBlock[] = asArray(o.blocks).map((s) => {
    const x = s as Record<string, unknown>;
    const c = String(x.confidence ?? 'medium').toLowerCase();
    const confidence: PovBlock['confidence'] = c === 'high' ? 'high' : c === 'low' ? 'low' : 'medium';
    const k = String(x.kind ?? 'trend').toLowerCase() as PovBlock['kind'];
    return {
      title: str(x.title, 120),
      kind: KINDS.includes(k) ? k : 'trend',
      body: str(x.body, 900),
      stats: asArray(x.stats).map((st) => {
        const y = st as Record<string, unknown>;
        return { value: str(y.value, 40), label: str(y.label, 90) };
      }).filter((st) => st.value && st.label).slice(0, 3),
      confidence,
      citations: ids(x.citations),
    };
  }).filter((s) => s.title && s.body).slice(0, 6);

  if (blocks.length === 0) return null;

  const intro: PovIntro[] = asArray(o.intro).map((i) => {
    const x = i as Record<string, unknown>;
    return {
      text: str(x.text, 900),
      citations: ids(x.citations),
      research: asArray(x.research).map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n < researchCount).slice(0, 3),
    };
  }).filter((i) => i.text).slice(0, 4);

  return {
    headline: str(o.headline, 300) || blocks[0].title,
    intro,
    blocks,
    counterSignals: asArray(o.counterSignals).map((c) => {
      const x = c as Record<string, unknown>;
      return { point: str(x.point, 400), citations: ids(x.citations) };
    }).filter((c) => c.point).slice(0, 4),
    implications: asArray(o.implications).map((i) => str(i, 300)).filter(Boolean).slice(0, 5),
    watch: asArray(o.watch).map((i) => str(i, 300)).filter(Boolean).slice(0, 5),
    generatedAt: new Date().toISOString(),
  };
}

export function crossSignals(
  topics: TopicShift[],
  research: { topic: string; ok: boolean; works: number; growthPct: number | null }[],
): SignalCross[] {
  const byTopic = new Map(research.map((r) => [r.topic, r]));
  return topics.slice(0, 6).map((t) => {
    const r = byTopic.get(t.topic);
    const market = t.changePct ?? (t.nPrev === 0 && t.nNow >= 3 ? 100 : 0);
    const res = r?.growthPct ?? null;
    const marketUp = market >= 25;
    const researchUp = res !== null && res >= 25;
    const known = r?.ok === true && (r.works > 0 || res !== null);
    const quadrant: SignalCross['quadrant'] =
      !known ? 'unknown'
        : researchUp && !marketUp ? 'ahead'
          : researchUp && marketUp ? 'validated'
            : !researchUp && marketUp ? 'hype'
              : 'cooling';
    return {
      topic: t.topic,
      marketChangePct: t.changePct,
      marketNow: t.nNow,
      researchWorks: r?.works ?? 0,
      researchGrowthPct: res,
      quadrant,
    };
  });
}

export type PovResult = {
  facts: FactPack;
  research: ResearchEvidence | null;
  cross: SignalCross[];
  pov: PointOfView | null;
  reason?: 'no_ai' | 'thin_data' | 'failed' | 'not_built';
};

const povKey = (projectId: number, days: number) => `pov:v3:${projectId}:${days}`;
const translationKey = (projectId: number, days: number, locale: ContentLocale) =>
  `${povKey(projectId, days)}:tr:${locale}`;

async function readPov(key: string): Promise<PointOfView | null> {
  const raw = await getMeta<PointOfView>(key);
  if (!raw) return null;
  return {
    ...raw,
    intro: raw.intro ?? [],
    blocks: raw.blocks ?? [],
    counterSignals: raw.counterSignals ?? [],
    implications: raw.implications ?? [],
    watch: raw.watch ?? [],
  };
}

export const POV_MAX_AGE_DAYS = 7;
export function povAgeDays(pov: PointOfView): number {
  return Math.floor((Date.now() - new Date(pov.generatedAt).getTime()) / 86400_000);
}

export async function getPovCached(projectId: number, days = 90): Promise<{ facts: FactPack; pov: PointOfView | null }> {
  const facts = await povFactPack(projectId, days);
  const pov = await readPov(povKey(projectId, days));
  return { facts, pov };
}

export async function getPointOfView(projectId: number, days = 90, preferredLocale?: ContentLocale): Promise<PovResult> {
  const facts = await povFactPack(projectId, days);
  const project = await getCurrentProject();
  const terms = [project?.name ?? '', ...(project?.keywords ?? [])].filter(Boolean);
  const [research, topicRes] = await Promise.all([
    researchEvidence(terms),
    topicResearchTrends(facts.topics.slice(0, 6).map((t) => t.topic)),
  ]);
  const cross = crossSignals(facts.topics, topicRes);
  let pov = await readPov(povKey(projectId, days));
  if (pov && preferredLocale && (pov.locale ?? 'en') !== preferredLocale) {
    const translated = await readPov(translationKey(projectId, days, preferredLocale));
    if (translated && translated.generatedAt === pov.generatedAt) pov = translated;
  }
  if (pov) return { facts, research, cross, pov };
  if (facts.total < 15) return { facts, research, cross, pov: null, reason: 'thin_data' };
  return { facts, research, cross, pov: null, reason: await claudeAvailable() ? 'not_built' : 'no_ai' };
}

export async function refreshPointOfViewIfStale(projectId: number, days = 90): Promise<boolean> {
  const existing = await readPov(povKey(projectId, days));
  if (existing && povAgeDays(existing) < POV_MAX_AGE_DAYS) return false;
  const { pov } = await buildPointOfView(projectId, days);
  return pov !== null;
}

export async function buildPointOfView(projectId: number, days = 90): Promise<PovResult> {
  const facts = await povFactPack(projectId, days);
  const project = await getCurrentProject();
  const terms = [project?.name ?? '', ...(project?.keywords ?? [])].filter(Boolean);
  const [research, topicRes] = await Promise.all([
    researchEvidence(terms, { cachedOnly: true }),
    topicResearchTrends(facts.topics.slice(0, 6).map((t) => t.topic), { cachedOnly: true }),
  ]);
  const cross = crossSignals(facts.topics, topicRes);

  if (facts.total < 15) return { facts, research, cross, pov: null, reason: 'thin_data' };

  const key = povKey(projectId, days);
  if (!await claudeAvailable()) return { facts, research, cross, pov: null, reason: 'no_ai' };

  const payload = {
    window_days: days,
    volume: { recent: facts.totalNow, previous: facts.totalPrev, change_pct: facts.volumeChangePct },
    sentiment: { recent: facts.sentNow, previous: facts.sentPrev },
    weekly_arc: facts.weekly,
    topics: facts.topics,
    sources: facts.sources,
    peak_days: facts.peaks,
    narratives: facts.narratives,
    research: research && research.status === 'ok' ? {
      total_works: research.total, growth_pct_3y: research.growthPct,
      top_institutions: research.topInstitutions.slice(0, 6),
      by_year: research.byYear.slice(-6),
    } : null,
    recent_research: (research?.status === 'ok' ? research.recentWorks : []).map((w, i) => ({
      index: i, title: w.title, year: w.year, citations: w.citations, institution: w.institution,
    })),
    market_vs_research: cross.filter((c) => c.quadrant !== 'unknown').map((c) => ({
      topic: c.topic,
      market_change_pct: c.marketChangePct,
      market_mentions_30d: c.marketNow,
      research_works: c.researchWorks,
      research_growth_pct_2y: c.researchGrowthPct,
      reading: c.quadrant,
    })),
    citable_posts: facts.citations.map((c) => ({
      id: c.id, title: c.title.slice(0, 140), source: c.source, date: c.date, sentiment: c.sentiment,
    })),
  };

  const MAX_CHARS = 14000;
  const shrink = (): string => {
    const p = { ...payload };
    const steps: (() => void)[] = [
      () => { p.citable_posts = p.citable_posts.slice(0, 18); },
      () => { p.recent_research = p.recent_research.slice(0, 8); },
      () => { p.citable_posts = p.citable_posts.slice(0, 10); },
      () => { p.narratives = p.narratives.slice(0, 3); },
      () => { p.weekly_arc = p.weekly_arc.slice(-8); },
      () => { p.topics = p.topics.slice(0, 8); },
      () => { p.market_vs_research = p.market_vs_research.slice(0, 8); },
      () => { p.citable_posts = p.citable_posts.slice(0, 6); },
    ];
    let out = JSON.stringify(p);
    for (const step of steps) {
      if (out.length <= MAX_CHARS) break;
      step();
      out = JSON.stringify(p);
    }
    return out;
  };

  const text = await callClaude(
    MODELS.sonnet, 'point_of_view', POV_SYSTEM,
    `Sector monitored: ${project?.name ?? 'n/a'}\n\n${shrink()}`,
    4500, true, 240_000,
  );
  if (!text) {
    console.error('[pov] no response from model');
    return { facts, research, cross, pov: null, reason: 'failed' };
  }

  try {
    const start = text.indexOf('{');
    const parsed = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    const pov = validate(parsed, new Set(facts.citations.map((c) => c.id)), research?.recentWorks.length ?? 0);
    if (!pov) {
      console.error(`[pov] response received but rejected by validation`);
      return { facts, research, cross, pov: null, reason: 'failed' };
    }
    pov.locale = await getContentLocale();
    await setMeta(key, pov);
    return { facts, research, cross, pov };
  } catch (e) {
    console.error(`[pov] unparseable response: ${(e as Error).message}`);
    return { facts, research, cross, pov: null, reason: 'failed' };
  }
}

export async function translatePointOfView(
  projectId: number, days: number, locale: ContentLocale,
): Promise<{ pov: PointOfView | null; reason?: 'not_built' | 'no_ai' | 'failed' }> {
  const key = povKey(projectId, days);
  const canonical = await readPov(key);
  if (!canonical) return { pov: null, reason: 'not_built' };
  if ((canonical.locale ?? 'en') === locale) return { pov: canonical };

  const trKey = translationKey(projectId, days, locale);
  const cached = await readPov(trKey);
  if (cached && cached.generatedAt === canonical.generatedAt) return { pov: cached };

  if (!await claudeAvailable()) return { pov: null, reason: 'no_ai' };

  const strings: string[] = [
    canonical.headline,
    ...canonical.intro.map((i) => i.text),
    ...canonical.blocks.flatMap((b) => [b.title, b.body, ...b.stats.map((s) => s.label)]),
    ...canonical.counterSignals.map((c) => c.point),
    ...canonical.implications,
    ...canonical.watch,
  ];

  const targetName = locale === 'it' ? 'Italian' : 'English';
  const system = `You translate market-analysis prose into ${targetName}.
You receive a JSON array of strings. Return ONLY a JSON array of translated strings:
- EXACTLY the same number of items, in the same order.
- Translate each item into natural, professional ${targetName}.
- Keep every number, percentage, date and proper name exactly as it appears.
- Never merge, split, reorder, drop or add items. An empty string stays an empty string.`;

  const text = await callClaude(
    MODELS.haiku, 'pov_translate', system, JSON.stringify(strings), 8000, false, 240_000,
  );
  if (!text) return { pov: null, reason: 'failed' };

  let out: unknown;
  try {
    out = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  } catch {
    return { pov: null, reason: 'failed' };
  }
  if (!Array.isArray(out) || out.length !== strings.length) return { pov: null, reason: 'failed' };
  const t = out.map((s, i) => (typeof s === 'string' && s.trim() ? s.trim() : strings[i]));

  let k = 0;
  const next = () => t[k++];
  const translated: PointOfView = {
    ...canonical,
    headline: next(),
    intro: canonical.intro.map((i) => ({ ...i, text: next() })),
    blocks: canonical.blocks.map((b) => ({
      ...b,
      title: next(),
      body: next(),
      stats: b.stats.map((s) => ({ ...s, label: next() })),
    })),
    counterSignals: canonical.counterSignals.map((c) => ({ ...c, point: next() })),
    implications: canonical.implications.map(() => next()),
    watch: canonical.watch.map(() => next()),
    generatedAt: canonical.generatedAt,
    locale,
  };

  await setMeta(trKey, translated);
  return { pov: translated };
}
