import { fetchJson } from '@/lib/connectors/util';
import { cfg } from '@/lib/connector-config';

export type DailyClose = { date: string; close: number; changePct: number | null };

export function alphaVantageEnabled(): boolean {
  return Boolean(cfg('ALPHA_VANTAGE_API_KEY'));
}

export async function fetchDailyCloses(ticker: string): Promise<DailyClose[]> {
  const key = cfg('ALPHA_VANTAGE_API_KEY');
  if (!key) return [];
  const params = new URLSearchParams({
    function: 'TIME_SERIES_DAILY', symbol: ticker, outputsize: 'compact', apikey: key,
  });
  const data = await fetchJson<Record<string, unknown>>(`https://www.alphavantage.co/query?${params}`);

  const series = data['Time Series (Daily)'] as Record<string, { '4. close'?: string }> | undefined;
  if (!series) return [];

  const rows = Object.entries(series)
    .map(([date, v]) => ({ date, close: Number(v['4. close']) }))
    .filter((r) => Number.isFinite(r.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  let prev: number | null = null;
  return rows.map((r) => {
    const changePct = prev !== null && prev > 0 ? Math.round(((r.close - prev) / prev) * 10000) / 100 : null;
    prev = r.close;
    return { date: r.date, close: r.close, changePct };
  });
}
