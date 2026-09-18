// Google Trends search interest retrieval with clean multi-term scaling
import { isMuapiConfigured, dispatchMuapiTask } from '@/lib/muapi-client';

const UA = 'MuapiRadar/1.0 (media listening & intelligence)';
const MAX_TERMS = 5;

export type SearchInterestPoint = { date: string; values: number[] };

async function getCookie(): Promise<string> {
  const res = await fetch('https://trends.google.com/?geo=US', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

function parseJsonp(text: string): any {
  return JSON.parse(text.replace(/^\)\]\}'[,]?\s*/, ''));
}

export async function fetchSearchInterest(terms: string[], days = '3-m'): Promise<SearchInterestPoint[]> {
  const capped = terms.slice(0, MAX_TERMS);
  if (capped.length === 0) return [];

  // If Muapi configured for SEO keyword trends, route via Muapi or fall back
  if (isMuapiConfigured()) {
    try {
      const resp = await dispatchMuapiTask<any>('/seo-keyword-trends', {
        keywords: capped,
        timeframe: days,
      });
      if (Array.isArray(resp.result?.timeline)) {
        return resp.result.timeline.map((item: any) => ({
          date: item.date,
          values: Array.isArray(item.values) ? item.values : [Number(item.value) || 0],
        }));
      }
    } catch (e) {
      console.warn('[search-interest] Muapi keyword trends fallback to direct Trends:', (e as Error).message);
    }
  }

  try {
    const cookie = await getCookie();
    const headers = { 'User-Agent': UA, Cookie: cookie };

    const exploreReq = {
      comparisonItem: capped.map((keyword) => ({ keyword, geo: '', time: `today ${days}` })),
      category: 0, property: '',
    };
    const exploreRes = await fetch(
      `https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(exploreReq))}`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (!exploreRes.ok) throw new Error(`Google Trends explore: HTTP ${exploreRes.status}`);
    const exploreData = parseJsonp(await exploreRes.text()) as {
      widgets?: { token: string; request: unknown }[];
    };
    const widget = exploreData.widgets?.[0];
    if (!widget) throw new Error('Google Trends: no widget in response');

    const dataRes = await fetch(
      `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${widget.token}`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (!dataRes.ok) throw new Error(`Google Trends widgetdata: HTTP ${dataRes.status}`);
    const data = parseJsonp(await dataRes.text()) as {
      default?: { timelineData?: { time: string; value: number[]; isPartial?: boolean }[] };
    };
    const points = data.default?.timelineData ?? [];

    return points
      .filter((p) => !p.isPartial)
      .map((p) => ({
        date: new Date(Number(p.time) * 1000).toISOString().slice(0, 10),
        values: p.value,
      }));
  } catch (err) {
    console.warn('[search-interest] Failed to fetch Google Trends:', (err as Error).message);
    return [];
  }
}
