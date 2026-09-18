import type { Connector, RawMention } from './types';
import { booleanQuery } from './types';
import { truncate } from './util';
import { cfg } from '@/lib/connector-config';
import { isMuapiConfigured, executeMuapiCapability, normalizeMuapiMention } from '@/lib/muapi-client';

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
};

function parseTitle(raw: string): { author?: string; title: string } {
  const m = raw.match(/^(.{2,80}?) (?:on|su|auf|en|sur) LinkedIn[:：]\s*(.*)$/i);
  if (m) return { author: m[1].trim(), title: m[2].trim() || m[1].trim() };
  return { title: raw.replace(/\s*[|–-]\s*LinkedIn\s*$/i, '').trim() };
}

export const linkedinWeb: Connector = {
  id: 'linkedin_web',
  label: 'LinkedIn (web)',
  tier: 'freekey',
  enabled: () => isMuapiConfigured() || Boolean(cfg('TAVILY_API_KEY')),
  disabledReason: 'Requires Muapi API Key or free Tavily API key from app.tavily.com in Settings',
  async fetchMentions(q) {
    const query = booleanQuery(q);
    if (!query) return [];

    // 1. Muapi social.search_posts with platform=linkedin
    if (isMuapiConfigured()) {
      const muapiResult = await executeMuapiCapability<Record<string, unknown>[]>('/social-search-posts', {
        platform: 'linkedin',
        query,
      });
      if (muapiResult && Array.isArray(muapiResult) && muapiResult.length > 0) {
        return muapiResult.map((item) => normalizeMuapiMention(item, 'linkedin_web'));
      }
      return [];
    }

    // 2. Direct Tavily search index fallback
    const key = cfg('TAVILY_API_KEY');
    if (!key) return [];
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query,
        include_domains: ['linkedin.com'],
        time_range: 'week',
        max_results: 20,
        search_depth: 'basic',
      }),
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = await res.json() as { results?: TavilyResult[] };

    return (data.results ?? [])
      .filter((r) => {
        try {
          return Boolean(r.url) && new URL(r.url!).hostname.endsWith('linkedin.com');
        } catch {
          return false;
        }
      })
      .map((r) => {
        const { author, title } = parseTitle(r.title ?? '');
        const pub = r.published_date ? new Date(r.published_date) : null;
        return {
          source: 'linkedin_web',
          externalId: r.url!,
          url: r.url!,
          title: truncate(title, 300),
          content: truncate(r.content ?? title, 800),
          author,
          authorHandle: author,
          community: r.url!.includes('/pulse/') ? 'article' : 'post',
          publishedAt: pub && !Number.isNaN(pub.getTime()) ? pub : new Date(),
        } satisfies RawMention;
      })
      .filter((m) => m.content);
  },
};
