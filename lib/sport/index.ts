import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sportSources, sportMatches, stockPrices, mentions } from '@/lib/db/schema';
import { fetchTeamMatches, footballDataEnabled } from './football-data';
import { fetchDailyCloses, alphaVantageEnabled } from './alphavantage';

const TZ = 'UTC';
const todayKey = () => new Date().toISOString().slice(0, 10);

export async function ingestSport(projectId: number): Promise<{ tried: number; matches: number; prices: number }> {
  const db = await getDb();
  const sources = await db.select().from(sportSources).where(eq(sportSources.projectId, projectId));
  let matchCount = 0;
  let priceCount = 0;

  for (const src of sources) {
    try {
      const raw = await fetchTeamMatches(src.teamId);
      if (raw.length) {
        const rows = raw.map((m) => ({ projectId, sourceId: src.id, ...m }));
        for (let i = 0; i < rows.length; i += 100) {
          await db.insert(sportMatches).values(rows.slice(i, i + 100))
            .onConflictDoUpdate({
              target: [sportMatches.sourceId, sportMatches.externalId],
              set: {
                homeScore: sql`excluded.home_score`, awayScore: sql`excluded.away_score`,
                status: sql`excluded.status`, utcDate: sql`excluded.utc_date`, fetchedAt: new Date(),
              },
            });
        }
        matchCount += rows.length;
      }
    } catch (e) {
      console.error(`[sport] matches failed for source #${src.id} (team ${src.teamId}):`, e);
    }

    if (src.ticker) {
      const [already] = await db.select({ id: stockPrices.id }).from(stockPrices)
        .where(and(eq(stockPrices.ticker, src.ticker), eq(stockPrices.date, todayKey())));
      if (!already) {
        try {
          const closes = await fetchDailyCloses(src.ticker);
          if (closes.length) {
            const rows = closes.map((c) => ({ ticker: src.ticker!, date: c.date, close: c.close, changePct: c.changePct }));
            for (let i = 0; i < rows.length; i += 100) {
              await db.insert(stockPrices).values(rows.slice(i, i + 100)).onConflictDoNothing();
            }
            priceCount += rows.length;
          }
        } catch (e) {
          console.error(`[sport] stock prices failed for ticker ${src.ticker}:`, e);
        }
      }
    }
    await db.update(sportSources).set({ lastFetchedAt: new Date() }).where(eq(sportSources.id, src.id));
  }
  return { tried: sources.length, matches: matchCount, prices: priceCount };
}

export type SportSourceRow = {
  id: number; competition: string; teamId: string; teamName: string;
  ticker: string | null; lastFetchedAt: Date | null; totalMatches: number;
};
export type UpcomingMatch = {
  id: number; competition: string; homeTeam: string; awayTeam: string; utcDate: Date; teamName: string;
};
export type MatchAnalysis = {
  id: number; utcDate: Date; competition: string; teamName: string;
  opponent: string; isHome: boolean; homeScore: number; awayScore: number;
  result: 'W' | 'D' | 'L';
  sentimentBefore: number | null; sentimentAfter: number | null; sentimentShift: number | null;
  volumeAfter: number;
  stockBefore: number | null; stockAfter: number | null; stockShiftPct: number | null;
};
export type SeasonPoint = {
  date: string;
  form: number | null;
  sentiment: number | null;
  stockIndex: number | null;
  match: { result: 'W' | 'D' | 'L'; label: string } | null;
};
export type AnatomyPoint = { offset: number; win: number | null; loss: number | null; nWin: number; nLoss: number };
export type ScatterPoint = {
  id: number; goalDiff: number; sentimentShift: number;
  result: 'W' | 'D' | 'L'; label: string; date: string;
};
export type SportStats = {
  footballDataEnabled: boolean; alphaVantageEnabled: boolean;
  sources: SportSourceRow[];
  upcoming: UpcomingMatch[];
  recent: MatchAnalysis[];
  aggregate: { result: 'W' | 'D' | 'L'; n: number; avgSentimentShift: number | null; avgStockShiftPct: number | null; avgVolume: number }[];
  primaryTeam: string | null;
  timeline: SeasonPoint[];
  anatomy: AnatomyPoint[];
  scatter: ScatterPoint[];
  correlation: { r: number; n: number } | null;
  splits: { key: 'home' | 'away'; n: number; wins: number; avgSentimentShift: number | null }[];
};

const DAY_MS = 86400_000;
const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10);
const shiftKey = (key: string, n: number) => dayKeyOf(new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS));

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : num / den;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function nearestClose(closes: { date: string; close: number }[], dateKey: string, dir: 'before' | 'after'): number | null {
  const sorted = [...closes].sort((a, b) => a.date.localeCompare(b.date));
  if (dir === 'before') {
    const c = [...sorted].reverse().find((x) => x.date < dateKey);
    return c?.close ?? null;
  }
  const c = sorted.find((x) => x.date > dateKey);
  return c?.close ?? null;
}

export async function sportStats(projectId: number, days = 180): Promise<SportStats> {
  const db = await getDb();
  const since = new Date(Date.now() - days * DAY_MS);

  const sourceRows = await db.select({
    id: sportSources.id, competition: sportSources.competition, teamId: sportSources.teamId,
    teamName: sportSources.teamName, ticker: sportSources.ticker, lastFetchedAt: sportSources.lastFetchedAt,
    totalMatches: sql<number>`count(${sportMatches.id})`,
  }).from(sportSources)
    .leftJoin(sportMatches, eq(sportMatches.sourceId, sportSources.id))
    .where(eq(sportSources.projectId, projectId))
    .groupBy(sportSources.id);
  const sources: SportSourceRow[] = sourceRows.map((s) => ({ ...s, totalMatches: Number(s.totalMatches) }));

  const upcomingRows = await db.select({
    id: sportMatches.id, competition: sportMatches.competition, homeTeam: sportMatches.homeTeam,
    awayTeam: sportMatches.awayTeam, utcDate: sportMatches.utcDate, teamName: sportSources.teamName,
  }).from(sportMatches)
    .innerJoin(sportSources, eq(sportSources.id, sportMatches.sourceId))
    .where(and(eq(sportMatches.projectId, projectId), eq(sportMatches.status, 'SCHEDULED')))
    .orderBy(sportMatches.utcDate)
    .limit(5);

  const finishedRows = await db.select({
    id: sportMatches.id, sourceId: sportMatches.sourceId,
    utcDate: sportMatches.utcDate, competition: sportMatches.competition,
    homeTeam: sportMatches.homeTeam, awayTeam: sportMatches.awayTeam,
    homeScore: sportMatches.homeScore, awayScore: sportMatches.awayScore,
    teamName: sportSources.teamName, ticker: sportSources.ticker,
  }).from(sportMatches)
    .innerJoin(sportSources, eq(sportSources.id, sportMatches.sourceId))
    .where(and(
      eq(sportMatches.projectId, projectId), eq(sportMatches.status, 'FINISHED'),
      gte(sportMatches.utcDate, since),
    ))
    .orderBy(desc(sportMatches.utcDate))
    .limit(60);

  const dayExpr = sql<string>`to_char(${mentions.publishedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
  const dailyRows = await db.select({
    day: dayExpr,
    avg: sql<number>`avg(${mentions.sentimentScore})`,
    n: sql<number>`count(*)`,
  }).from(mentions)
    .where(and(
      eq(mentions.projectId, projectId),
      gte(mentions.publishedAt, since),
      sql`${mentions.sentimentScore} is not null`,
    ))
    .groupBy(dayExpr)
    .orderBy(dayExpr);
  const daily = new Map<string, { avg: number; n: number }>();
  for (const r of dailyRows) daily.set(String(r.day), { avg: Number(r.avg), n: Number(r.n) });

  const avgOverOffsets = (key: string, offsets: number[]): { avg: number | null; n: number } => {
    let sum = 0, n = 0;
    for (const o of offsets) {
      const d = daily.get(shiftKey(key, o));
      if (d) { sum += d.avg * d.n; n += d.n; }
    }
    return { avg: n ? sum / n : null, n };
  };
  const WEEK_BEFORE = [-7, -6, -5, -4, -3, -2, -1];

  const tickers = [...new Set(finishedRows.map((r) => r.ticker).filter((t): t is string => Boolean(t)))];
  const closesByTicker = new Map<string, { date: string; close: number }[]>();
  for (const t of tickers) {
    const rows = await db.select({ date: stockPrices.date, close: stockPrices.close })
      .from(stockPrices).where(eq(stockPrices.ticker, t));
    closesByTicker.set(t, rows.map((r) => ({ date: String(r.date), close: r.close })));
  }

  const recent: MatchAnalysis[] = [];
  for (const m of finishedRows) {
    if (m.homeScore === null || m.awayScore === null) continue;
    const isHome = m.homeTeam === m.teamName;
    const own = isHome ? m.homeScore : m.awayScore;
    const opp = isHome ? m.awayScore : m.homeScore;
    const result: MatchAnalysis['result'] = own > opp ? 'W' : own < opp ? 'L' : 'D';

    const matchDate = new Date(m.utcDate);
    const key = dayKeyOf(matchDate);
    const before = avgOverOffsets(key, WEEK_BEFORE);
    const after = avgOverOffsets(key, [0, 1]);
    const sentimentShift = before.avg !== null && after.avg !== null ? round2(after.avg - before.avg) : null;

    let stockBefore: number | null = null, stockAfter: number | null = null, stockShiftPct: number | null = null;
    if (m.ticker) {
      const dateKey = matchDate.toISOString().slice(0, 10);
      const closes = closesByTicker.get(m.ticker) ?? [];
      stockBefore = nearestClose(closes, dateKey, 'before');
      stockAfter = nearestClose(closes, dateKey, 'after');
      if (stockBefore !== null && stockAfter !== null && stockBefore > 0) {
        stockShiftPct = Math.round(((stockAfter - stockBefore) / stockBefore) * 10000) / 100;
      }
    }

    recent.push({
      id: m.id, utcDate: matchDate, competition: m.competition, teamName: m.teamName,
      opponent: isHome ? m.awayTeam : m.homeTeam, isHome, homeScore: m.homeScore, awayScore: m.awayScore,
      result, sentimentBefore: before.avg, sentimentAfter: after.avg, sentimentShift, volumeAfter: after.n,
      stockBefore, stockAfter, stockShiftPct,
    });
  }

  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

  const aggregate = (['W', 'D', 'L'] as const).map((result) => {
    const rows = recent.filter((r) => r.result === result);
    const sentiments = rows.map((r) => r.sentimentShift).filter((v): v is number => v !== null);
    const stocks = rows.map((r) => r.stockShiftPct).filter((v): v is number => v !== null);
    const s = mean(sentiments), k = mean(stocks), vol = mean(rows.map((r) => r.volumeAfter));
    return {
      result, n: rows.length,
      avgSentimentShift: s === null ? null : round2(s),
      avgStockShiftPct: k === null ? null : round2(k),
      avgVolume: vol === null ? 0 : Math.round(vol),
    };
  }).filter((a) => a.n > 0);

  const splits = (['home', 'away'] as const).map((key) => {
    const rows = recent.filter((r) => (key === 'home' ? r.isHome : !r.isHome));
    const s = mean(rows.map((r) => r.sentimentShift).filter((v): v is number => v !== null));
    return {
      key, n: rows.length, wins: rows.filter((r) => r.result === 'W').length,
      avgSentimentShift: s === null ? null : round2(s),
    };
  }).filter((s) => s.n > 0);

  const scatter: ScatterPoint[] = recent
    .filter((r) => r.sentimentShift !== null)
    .map((r) => {
      const own = r.isHome ? r.homeScore : r.awayScore;
      const opp = r.isHome ? r.awayScore : r.homeScore;
      return {
        id: r.id, goalDiff: own - opp, sentimentShift: r.sentimentShift as number,
        result: r.result, label: `${r.isHome ? 'vs' : '@'} ${r.opponent} ${own}–${opp}`,
        date: dayKeyOf(r.utcDate),
      };
    });
  const rVal = pearson(scatter.map((p) => p.goalDiff), scatter.map((p) => p.sentimentShift));
  const correlation = rVal === null ? null : { r: round2(rVal), n: scatter.length };

  const OFFSETS = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
  const buckets = new Map<number, { w: number[]; l: number[] }>();
  for (const o of OFFSETS) buckets.set(o, { w: [], l: [] });
  for (const m of recent) {
    if (m.result === 'D') continue;
    const key = dayKeyOf(m.utcDate);
    const baseline = avgOverOffsets(key, WEEK_BEFORE).avg;
    if (baseline === null) continue;
    for (const o of OFFSETS) {
      const d = daily.get(shiftKey(key, o));
      if (!d) continue;
      buckets.get(o)![m.result === 'W' ? 'w' : 'l'].push(d.avg - baseline);
    }
  }
  const anatomy: AnatomyPoint[] = OFFSETS.map((offset) => {
    const b = buckets.get(offset)!;
    const w = mean(b.w), l = mean(b.l);
    return {
      offset,
      win: w === null ? null : round2(w), loss: l === null ? null : round2(l),
      nWin: b.w.length, nLoss: b.l.length,
    };
  });

  const bySource = new Map<number, typeof finishedRows>();
  for (const m of finishedRows) {
    if (!bySource.has(m.sourceId)) bySource.set(m.sourceId, []);
    bySource.get(m.sourceId)!.push(m);
  }
  let primaryRows: typeof finishedRows = [];
  for (const rows of bySource.values()) if (rows.length > primaryRows.length) primaryRows = rows;
  const primaryTeam = primaryRows[0]?.teamName ?? null;

  const timeline: SeasonPoint[] = [];
  if (primaryRows.length > 0) {
    const asc = [...primaryRows].sort((a, b) => a.utcDate.getTime() - b.utcDate.getTime());
    const matchByDay = new Map<string, { result: 'W' | 'D' | 'L'; label: string; points: number }>();
    for (const m of asc) {
      if (m.homeScore === null || m.awayScore === null) continue;
      const isHome = m.homeTeam === m.teamName;
      const own = isHome ? m.homeScore : m.awayScore;
      const opp = isHome ? m.awayScore : m.homeScore;
      const result = own > opp ? 'W' : own < opp ? 'L' : 'D';
      matchByDay.set(dayKeyOf(m.utcDate), {
        result, points: result === 'W' ? 3 : result === 'D' ? 1 : 0,
        label: `${isHome ? 'vs' : '@'} ${isHome ? m.awayTeam : m.homeTeam} ${own}–${opp}`,
      });
    }

    const closes = primaryRows[0].ticker ? (closesByTicker.get(primaryRows[0].ticker) ?? []) : [];
    const closeByDay = new Map(closes.map((c) => [c.date, c.close]));
    const firstClose = [...closes].sort((a, b) => a.date.localeCompare(b.date))[0]?.close ?? null;

    const startKey = dayKeyOf(asc[0].utcDate);
    const endKey = dayKeyOf(new Date());
    let form = 0;
    let lastClose: number | null = null;
    let hasSeenMatch = false;
    for (let k = startKey; k <= endKey; k = shiftKey(k, 1)) {
      const m = matchByDay.get(k);
      if (m) { form += m.points; hasSeenMatch = true; }
      const c = closeByDay.get(k);
      if (c !== undefined) lastClose = c;
      const rolling = avgOverOffsets(k, [0, -1, -2, -3, -4, -5, -6]).avg;
      timeline.push({
        date: k,
        form: hasSeenMatch ? form : null,
        sentiment: rolling === null ? null : round2(rolling),
        stockIndex: lastClose !== null && firstClose ? round2((lastClose / firstClose) * 100) : null,
        match: m ? { result: m.result, label: m.label } : null,
      });
    }
  }

  return {
    footballDataEnabled: footballDataEnabled(), alphaVantageEnabled: alphaVantageEnabled(),
    sources, upcoming: upcomingRows, recent, aggregate,
    primaryTeam, timeline, anatomy, scatter, correlation, splits,
  };
}
