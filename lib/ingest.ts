import { eq, sql } from 'drizzle-orm';
import { getDb, setMeta, getMeta } from '@/lib/db';
import { backfillCountries, countryFromDomain, countryFromUrl, toCountryCode } from '@/lib/country-codes';
import { mentions, projects, benchmarkEntities } from '@/lib/db/schema';
import { CONNECTORS, kindOf } from '@/lib/connectors';
import { setTelegramChannels } from '@/lib/connectors/telegram';
import { setRssFeeds } from '@/lib/connectors/rss';
import { hydrateConnectorCredentials } from '@/lib/connector-credentials';
import type { RawMention, ListeningQuery } from '@/lib/connectors/types';
import { compilePlan, matchesQuery, queriesMatching, validatePlan, type CompiledQuery } from '@/lib/query-plan';

export type SourceStatus = Record<string, {
  ok: boolean; count: number; error?: string; at: string;
  lastOkAt?: string;
}>;

function rawEngagementScore(m: RawMention): number {
  const e = m.engagement;
  if (!e) return 0;
  return (e.likes ?? 0) + 2 * (e.comments ?? 0) + 3 * (e.shares ?? 0) + (e.views ?? 0) / 200;
}

const CONNECTOR_TERM_CAP: Partial<Record<string, number>> = {
  gdelt: 6, reddit: 5, bluesky: 4, mastodon: 4, newsapi: 6,
  arxiv: 3, github: 2, 'sec-edgar': 3, stackexchange: 3, x: 5, tiktok: 5, youtube: 2,
  talkwalker: 40,
};

const BATCH_FULLY: Set<string> = new Set(['googlenews', 'gdelt', 'reddit', 'bluesky', 'mastodon', 'talkwalker']);
const ENTITY_SEARCH_CONNECTORS: Set<string> = new Set(['googlenews', 'reddit', 'bluesky', 'mastodon']);

const TALKWALKER_COST_PER_CALL = 10;
const talkwalkerBudgetKey = () => `talkwalker_credits_${new Date().toISOString().slice(0, 10)}`;

function talkwalkerDailyBudget(): number {
  const raw = Number(process.env.TALKWALKER_DAILY_CREDITS ?? 1000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1000;
}

async function talkwalkerCreditsSpentToday(): Promise<number> {
  return (await getMeta<number>(talkwalkerBudgetKey())) ?? 0;
}

async function addTalkwalkerCredits(spent: number): Promise<void> {
  if (spent <= 0) return;
  await setMeta(talkwalkerBudgetKey(), (await talkwalkerCreditsSpentToday()) + spent);
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [];
  if (!Number.isFinite(size) || size >= arr.length) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const ROTATION_STEP = 4;
async function rotateTerms(terms: string[], key: string): Promise<string[]> {
  if (terms.length < 2) return terms;
  const offset = (await getMeta<number>(key)) ?? 0;
  const pos = offset % terms.length;
  await setMeta(key, offset + ROTATION_STEP);
  return [...terms.slice(pos), ...terms.slice(0, pos)];
}

type Job = {
  connectorId: string; fetch: () => Promise<RawMention[]>;
  scope: 'project' | 'entity' | 'query';
  label?: string;
  query?: CompiledQuery;
};

const QUERIES_PER_RUN_ON_TIGHT = 2;
async function rotateQueries(list: CompiledQuery[], key: string): Promise<CompiledQuery[]> {
  if (list.length <= QUERIES_PER_RUN_ON_TIGHT) return list;
  const offset = (await getMeta<number>(key)) ?? 0;
  await setMeta(key, offset + QUERIES_PER_RUN_ON_TIGHT);
  return Array.from({ length: QUERIES_PER_RUN_ON_TIGHT }, (_, i) => list[(offset + i) % list.length]);
}

const CONCURRENCY_PER_CONNECTOR = 2;
const ROUND_DELAY_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runJobs(jobs: Job[]): Promise<{ job: Job; mentions: RawMention[]; error?: unknown }[]> {
  const byConnector = new Map<string, Job[]>();
  for (const j of jobs) {
    if (!byConnector.has(j.connectorId)) byConnector.set(j.connectorId, []);
    byConnector.get(j.connectorId)!.push(j);
  }
  const perConnector = await Promise.all(
    [...byConnector.values()].map(async (group) => {
      const out: { job: Job; mentions: RawMention[]; error?: unknown }[] = [];
      for (let i = 0; i < group.length; i += CONCURRENCY_PER_CONNECTOR) {
        if (i > 0) await sleep(ROUND_DELAY_MS);
        const batch = group.slice(i, i + CONCURRENCY_PER_CONNECTOR);
        const settled = await Promise.allSettled(batch.map((j) => j.fetch()));
        settled.forEach((s, k) => {
          const job = batch[k];
          const label = `${job.connectorId}/${job.scope}${job.label ? ` "${job.label}"` : ''}`;
          if (s.status === 'fulfilled') console.log(`[ingest] ${label}: ${s.value.length} raw`);
          else console.error(`[ingest] ${label}: ERROR ${String((s.reason as Error)?.message ?? s.reason).slice(0, 120)}`);
          out.push(s.status === 'fulfilled'
            ? { job, mentions: s.value }
            : { job, mentions: [], error: s.reason });
        });
      }
      return out;
    }),
  );
  return perConnector.flat();
}

export async function ingestProject(projectOrId: typeof projects.$inferSelect | number) {
  const db = await getDb();
  let project: typeof projects.$inferSelect;
  if (typeof projectOrId === 'number') {
    const [found] = await db.select().from(projects).where(eq(projects.id, projectOrId));
    if (!found) return { inserted: 0, status: {} };
    project = found;
  } else {
    project = projectOrId;
  }
  const q: ListeningQuery = {
    anyTerms: project.keywords ?? [],
    allTerms: project.allTerms ?? [],
    excludeTerms: project.excludeTerms ?? [],
    languages: project.languages ?? [],
    countries: project.countries ?? [],
    talkwalkerProject: project.talkwalkerProject ?? undefined,
    talkwalkerTopics: project.talkwalkerTopics ?? [],
  };
  const status: SourceStatus = (await getMeta<SourceStatus>('source_status')) ?? {};
  let inserted = 0;

  const plan = project.queryPlan ? validatePlan(project.queryPlan).plan : null;
  const compiled = plan ? compilePlan(plan) : null;
  const searchPlan = project.mode === 'talkwalker' ? null : compiled;

  const lc = (s: string) => s.toLowerCase();
  const matchesBoolean = (m: RawMention, scope: Job['scope'], query?: CompiledQuery) => {
    if (scope === 'query' && query) return matchesQuery(query, `${m.title ?? ''} ${m.content}`);
    const text = lc(`${m.title ?? ''} ${m.content}`);
    if (scope === 'project' && q.allTerms.length && !q.allTerms.every((t) => text.includes(lc(t)))) return false;
    if (q.excludeTerms.some((t) => text.includes(lc(t)))) return false;
    return true;
  };

  setTelegramChannels(project.telegramChannels ?? []);
  setRssFeeds(project.rssFeeds ?? []);
  await hydrateConnectorCredentials();

  let enabled = CONNECTORS
    .filter((c) => c.enabled())
    .filter((c) => (project.mode === 'talkwalker' ? c.id === 'talkwalker' : c.id !== 'talkwalker'));

  if (project.mode === 'talkwalker') {
    const budget = talkwalkerDailyBudget();
    const spent = await talkwalkerCreditsSpentToday();
    if (budget > 0 && spent >= budget) {
      console.log(`[ingest] Talkwalker daily budget reached (${spent}/${budget}), skipping`);
      enabled = [];
      status.talkwalker = {
        ok: false, count: 0,
        error: `Talkwalker daily budget reached: ~${spent} credits / ${budget}`,
        at: new Date().toISOString(), lastOkAt: status.talkwalker?.lastOkAt,
      };
      await setMeta('source_status', status);
    }
  }

  const entities = await db.select().from(benchmarkEntities).where(eq(benchmarkEntities.projectId, project.id));

  const jobs: Job[] = [];
  if (searchPlan) {
    for (const c of enabled) {
      const queries = BATCH_FULLY.has(c.id) && c.id !== 'gdelt'
        ? searchPlan
        : await rotateQueries(searchPlan, `ingest_query_rotation_${project.id}_${c.id}`);
      for (const cq of queries) {
        const base: ListeningQuery = { ...q, anyTerms: cq.anchor, allTerms: [], excludeTerms: cq.exclude, groups: cq.groups };
        if (BATCH_FULLY.has(c.id)) {
          for (const batch of chunk(cq.anchor, CONNECTOR_TERM_CAP[c.id] ?? Infinity)) {
            jobs.push({ connectorId: c.id, scope: 'query', label: cq.name, query: cq, fetch: () => c.fetchMentions({ ...base, anyTerms: batch }) });
          }
        } else {
          const rotated = await rotateTerms(cq.anchor, `ingest_rotation_project_${project.id}_${c.id}_${cq.id}`);
          jobs.push({ connectorId: c.id, scope: 'query', label: cq.name, query: cq, fetch: () => c.fetchMentions({ ...base, anyTerms: rotated }) });
        }
      }
    }
  }
  for (const c of searchPlan ? [] : enabled) {
    if (BATCH_FULLY.has(c.id)) {
      for (const batch of chunk(q.anyTerms, CONNECTOR_TERM_CAP[c.id] ?? Infinity)) {
        jobs.push({ connectorId: c.id, scope: 'project', fetch: () => c.fetchMentions({ ...q, anyTerms: batch }) });
      }
    } else {
      const rotated = await rotateTerms(q.anyTerms, `ingest_rotation_project_${project.id}_${c.id}`);
      jobs.push({ connectorId: c.id, scope: 'project', fetch: () => c.fetchMentions({ ...q, anyTerms: rotated }) });
    }
  }
  for (const entity of searchPlan ? [] : entities) {
    if (entity.keywords.length === 0) continue;
    for (const c of enabled) {
      if (!ENTITY_SEARCH_CONNECTORS.has(c.id)) continue;
      for (const batch of chunk(entity.keywords, CONNECTOR_TERM_CAP[c.id] ?? Infinity)) {
        const entityQuery: ListeningQuery = { ...q, anyTerms: batch, allTerms: [] };
        jobs.push({ connectorId: c.id, scope: 'entity', label: entity.name, fetch: () => c.fetchMentions(entityQuery) });
      }
    }
  }

  const results = await runJobs(jobs);

  const agg = new Map<string, { ok: boolean; count: number; error?: string }>();
  for (const r of results) {
    const job = r.job;
    const prevAgg = agg.get(job.connectorId) ?? { ok: false, count: 0 };
    if (r.error !== undefined) {
      const err = r.error as { message?: string } | undefined;
      agg.set(job.connectorId, { ...prevAgg, error: String(err?.message ?? r.error) });
      continue;
    }
    const now = Date.now();
    const afterBoolean = r.mentions.filter((m) => matchesBoolean(m, job.scope, job.query));
    const afterDate = afterBoolean
      .filter((m) => !Number.isNaN(m.publishedAt.getTime())
        && m.publishedAt.getTime() < now + 3600_000
        && m.publishedAt.getTime() > now - 90 * 86400_000);

    const rows = afterDate
      .map((m) => ({
        projectId: project.id,
        source: m.source,
        kind: kindOf(m.source),
        externalId: m.externalId.slice(0, 500),
        url: m.url,
        title: m.title,
        content: m.content,
        author: m.author,
        authorHandle: m.authorHandle,
        community: m.community,
        publishedAt: m.publishedAt,
        language: m.language,
        country: toCountryCode(m.country) ?? countryFromUrl(m.url) ?? countryFromDomain(m.author),
        engagement: m.engagement,
        engagementScore: rawEngagementScore(m),
        reach: m.reach,
        queryIds: compiled ? queriesMatching(compiled, `${m.title ?? ''} ${m.content}`) : [],
      }));

    let count = 0;
    const unique = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.source}|${row.externalId}`;
      const prev = unique.get(key);
      unique.set(key, prev ? { ...prev, queryIds: [...new Set([...prev.queryIds, ...row.queryIds])] } : row);
    }
    const deduped = [...unique.values()];
    for (let j = 0; j < deduped.length; j += 100) {
      const chunkRows = deduped.slice(j, j + 100);
      if (chunkRows.length === 0) continue;
      if (compiled) {
        const res = await db.insert(mentions).values(chunkRows)
          .onConflictDoUpdate({
            target: [mentions.projectId, mentions.source, mentions.externalId],
            set: {
              queryIds: sql`(select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(${mentions.queryIds} || excluded.query_ids) as x)`,
            },
          })
          .returning({ inserted: sql<boolean>`(xmax = 0)` });
        count += res.filter((x) => x.inserted).length;
      } else {
        const res = await db.insert(mentions).values(chunkRows).onConflictDoNothing().returning({ id: mentions.id });
        count += res.length;
      }
    }
    inserted += count;
    agg.set(job.connectorId, { ok: true, count: prevAgg.count + count });
  }

  const talkwalkerJobs = results.filter((r) => r.job.connectorId === 'talkwalker');
  if (talkwalkerJobs.length) {
    const spent = talkwalkerJobs.reduce(
      (tot, r) => tot + TALKWALKER_COST_PER_CALL + (r.error === undefined ? r.mentions.length : 0),
      0,
    );
    await addTalkwalkerCredits(spent);
  }

  const nowIso = new Date().toISOString();
  for (const [connectorId, a] of agg) {
    const prev = status[connectorId];
    status[connectorId] = {
      ok: a.ok, count: a.count, error: a.ok ? undefined : a.error,
      at: nowIso, lastOkAt: a.ok ? nowIso : prev?.lastOkAt,
    };
  }

  await setMeta('source_status', status);
  await setMeta('last_ingest_at', new Date().toISOString());

  try {
    await backfillCountries(project.id);
  } catch (e) {
    console.warn('[ingest] country backfill failed:', (e as Error).message);
  }

  return { inserted, status };
}
