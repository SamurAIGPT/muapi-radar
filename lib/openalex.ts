// Research evidence via OpenAlex (api.openalex.org) - 250M open academic works, free, keyless.
const API = 'https://api.openalex.org/works';

export type ResearchWork = {
  title: string; year: number | null; citations: number;
  url: string; institution: string | null; openAccess: boolean;
};
export type ResearchInstitution = { name: string; works: number };
export type ResearchEvidence = {
  query: string;
  status: 'ok' | 'empty' | 'unavailable';
  total: number;
  byYear: { year: number; n: number }[];
  growthPct: number | null;
  last3: number | null;
  prev3: number | null;
  topInstitutions: ResearchInstitution[];
  topWorks: ResearchWork[];
  byCountry: { code: string; name: string; works: number }[];
  recentWorks: ResearchWork[];
};

function politeParam(): string {
  const m = process.env.OPENALEX_MAILTO?.trim();
  return m ? `&mailto=${encodeURIComponent(m)}` : '';
}

async function fetchJson<T>(url: string): Promise<{ data: T | null; limited: boolean }> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'MuapiRadar/1.0 (media intelligence)' },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!res.ok) return { data: null, limited: res.status === 429 || res.status === 403 || res.status >= 500 };
    return { data: (await res.json()) as T, limited: false };
  } catch {
    return { data: null, limited: true };
  }
}

type GroupResp = { group_by?: { key: string; key_display_name: string; count: number }[] };
type WorksResp = {
  meta?: { count: number };
  results?: {
    title: string | null;
    publication_year: number | null;
    cited_by_count: number;
    doi: string | null;
    id: string;
    open_access?: { is_oa?: boolean };
    authorships?: { institutions?: { display_name: string }[] }[];
  }[];
};

export async function researchEvidence(
  terms: string[],
  opts: { cachedOnly?: boolean } = {},
): Promise<ResearchEvidence | null> {
  const clean = terms.filter(Boolean).map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  const primary = clean.slice(0, 2).join(' ');
  const fallback = clean[0];

  const { getMeta, setMeta } = await import('@/lib/db');
  const key = `openalex:v3:${primary.toLowerCase()}:${new Date().toISOString().slice(0, 10)}`;
  const cached = await getMeta<ResearchEvidence>(key);
  if (cached && cached.status === 'ok') return cached;
  if (opts.cachedOnly) return cached ?? null;

  const run = async (query: string) => {
    const f = `filter=title_and_abstract.search:${encodeURIComponent(query)}`;
    const p = politeParam();
    const since = new Date(Date.now() - 548 * 86400_000).toISOString().slice(0, 10);
    const [works, insts, years, countries, recent] = await Promise.all([
      fetchJson<WorksResp>(`${API}?${f}&per-page=8&sort=cited_by_count:desc${p}`),
      fetchJson<GroupResp>(`${API}?${f}&group_by=institutions.id&per-page=8${p}`),
      fetchJson<GroupResp>(`${API}?${f}&group_by=publication_year${p}`),
      fetchJson<GroupResp>(`${API}?${f}&group_by=authorships.institutions.country_code&per-page=12${p}`),
      fetchJson<WorksResp>(`${API}?${f},from_publication_date:${since},type:article,is_paratext:false&per-page=5&sort=cited_by_count:desc${p}`),
    ]);
    return { works, insts, years, countries, recent, query };
  };

  let r = await run(primary);
  if (!r.works.limited && (r.works.data?.meta?.count ?? 0) < 25 && fallback !== primary) {
    const alt = await run(fallback);
    if ((alt.works.data?.meta?.count ?? 0) > (r.works.data?.meta?.count ?? 0)) r = alt;
  }

  const { works, insts, years, countries, recent, query } = r;
  if (!works.data) {
    const out: ResearchEvidence = {
      query, status: works.limited ? 'unavailable' : 'empty',
      total: 0, byYear: [], growthPct: null, last3: null, prev3: null,
      topInstitutions: [], topWorks: [], byCountry: [], recentWorks: [],
    };
    return out;
  }

  const thisYear = new Date().getFullYear();
  const byYear = (years.data?.group_by ?? [])
    .map((g) => ({ year: Number(g.key), n: g.count }))
    .filter((row) => Number.isFinite(row.year) && row.year >= thisYear - 9 && row.year <= thisYear)
    .sort((a, b) => a.year - b.year);

  let growthPct: number | null = null;
  let last3: number | null = null;
  let prev3: number | null = null;
  const complete = byYear.filter((row) => row.year < thisYear);
  if (complete.length >= 6) {
    last3 = complete.slice(-3).reduce((s, row) => s + row.n, 0);
    prev3 = complete.slice(-6, -3).reduce((s, row) => s + row.n, 0);
    if (prev3 > 0) growthPct = Math.round(((last3 - prev3) / prev3) * 100);
  }

  type RawWork = NonNullable<WorksResp['results']>[number];
  const toWork = (w: RawWork): ResearchWork => ({
    title: (w.title ?? 'untitled').slice(0, 200),
    year: w.publication_year,
    citations: w.cited_by_count,
    url: w.doi ? `https://doi.org/${w.doi.replace(/^https?:\/\/doi\.org\//, '')}` : w.id,
    institution: w.authorships?.find((a) => a.institutions?.length)?.institutions?.[0]?.display_name ?? null,
    openAccess: Boolean(w.open_access?.is_oa),
  });

  const total = works.data.meta?.count ?? 0;
  const result: ResearchEvidence = {
    query,
    status: total === 0 ? 'empty' : 'ok',
    total,
    byYear,
    growthPct, last3, prev3,
    topInstitutions: (insts.data?.group_by ?? [])
      .filter((g) => g.key_display_name && g.key_display_name !== 'unknown')
      .slice(0, 8)
      .map((g) => ({ name: g.key_display_name, works: g.count })),
    topWorks: (works.data.results ?? []).slice(0, 8).map(toWork),
    byCountry: (countries.data?.group_by ?? [])
      .filter((g) => g.key && g.key !== 'unknown' && g.key_display_name)
      .slice(0, 10)
      .map((g) => ({ code: g.key.toUpperCase(), name: g.key_display_name, works: g.count })),
    recentWorks: (recent.data?.results ?? []).slice(0, 5).map(toWork),
  };

  if (result.status === 'ok') await setMeta(key, result);
  return result;
}

export type TopicResearch = {
  topic: string;
  ok: boolean;
  works: number;
  growthPct: number | null;
};

export async function topicResearchTrends(
  topics: string[],
  opts: { cachedOnly?: boolean } = {},
): Promise<TopicResearch[]> {
  const list = topics.filter(Boolean).slice(0, 6);
  if (list.length === 0) return [];

  const { getMeta, setMeta } = await import('@/lib/db');
  const key = `openalex:topics:v2:${list.join('|').toLowerCase()}:${new Date().toISOString().slice(0, 10)}`;
  const cached = await getMeta<TopicResearch[]>(key);
  if (cached?.length && cached.every((r) => r.ok)) return cached;
  if (opts.cachedOnly) return cached ?? [];

  const thisYear = new Date().getFullYear();
  const out = await Promise.all(list.map(async (topic) => {
    const phrase = encodeURIComponent(`"${topic.replace(/"/g, '')}"`);
    const { data } = await fetchJson<GroupResp>(
      `${API}?search=${phrase}&group_by=publication_year${politeParam()}`,
    );
    if (!data?.group_by) return { topic, ok: false, works: 0, growthPct: null };
    const years = new Map(
      data.group_by
        .filter((g) => /^\d{4}$/.test(g.key))
        .map((g) => [Number(g.key), g.count] as const),
    );
    const works = [...years.values()].reduce((s, n) => s + n, 0);
    const sum = (from: number, to: number) => {
      let t = 0;
      for (let y = from; y <= to; y++) t += years.get(y) ?? 0;
      return t;
    };
    const recent = sum(thisYear - 2, thisYear - 1);
    const prior = sum(thisYear - 4, thisYear - 3);
    const growthPct = prior >= 5 ? Math.round(((recent - prior) / prior) * 100) : null;
    return { topic, ok: true, works, growthPct };
  }));

  if (out.every((r) => r.ok)) await setMeta(key, out);
  return out;
}
