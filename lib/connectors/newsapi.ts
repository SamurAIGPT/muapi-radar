import type { Connector, RawMention } from './types';
import { fetchJson, truncate } from './util';
import { cfg } from '@/lib/connector-config';
import { isMuapiConfigured, executeMuapiCapability, normalizeMuapiMention } from '@/lib/muapi-client';

type Article = {
  title?: string; description?: string; url: string; publishedAt?: string;
  source?: { name?: string }; author?: string;
};

export const newsapi: Connector = {
  id: 'newsapi',
  label: 'NewsAPI (150k outlets)',
  tier: 'premium',
  enabled: () => isMuapiConfigured() || Boolean(cfg('NEWSAPI_KEY')),
  disabledReason: 'Requires Muapi API Key or NewsAPI key in Settings',
  async fetchMentions(q) {
    const parts: string[] = [];
    if (q.anyTerms.length) parts.push(`(${q.anyTerms.slice(0, 6).map((t) => `"${t}"`).join(' OR ')})`);
    parts.push(...q.allTerms.map((t) => `AND "${t}"`));
    parts.push(...q.excludeTerms.map((t) => `NOT "${t}"`));
    const query = parts.join(' ');
    if (!query) return [];

    // 1. Muapi reputation.news_search
    if (isMuapiConfigured()) {
      const muapiResult = await executeMuapiCapability<Record<string, unknown>[]>('/news-search', {
        query,
        languages: q.languages,
      });
      if (muapiResult && Array.isArray(muapiResult) && muapiResult.length > 0) {
        return muapiResult.map((item) => normalizeMuapiMention(item, 'newsapi'));
      }
      return [];
    }

    // 2. Direct NewsAPI fallback
    const key = cfg('NEWSAPI_KEY');
    if (!key) return [];
    const lang = q.languages[0] ?? 'en';
    const data = await fetchJson<{ articles?: Article[] }>(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=${lang}&sortBy=publishedAt&pageSize=100&apiKey=${key}`,
    );
    return (data.articles ?? []).map((a) => ({
      source: 'newsapi',
      externalId: a.url,
      url: a.url,
      title: truncate(a.title ?? '', 300),
      content: truncate(a.description ?? a.title ?? '', 800),
      author: a.source?.name,
      community: a.source?.name,
      publishedAt: a.publishedAt ? new Date(a.publishedAt) : new Date(),
      language: lang,
    } satisfies RawMention)).filter((m) => m.title);
  },
};
