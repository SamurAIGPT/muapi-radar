import type { Connector, RawMention } from './types';
import { fetchJson, truncate } from './util';
import { cfg } from '@/lib/connector-config';
import { isMuapiConfigured, executeMuapiCapability, normalizeMuapiMention } from '@/lib/muapi-client';

type RedditPost = {
  data: {
    name: string; title: string; selftext: string; permalink: string;
    author: string; subreddit: string; created_utc: number;
    ups: number; num_comments: number; over_18: boolean;
  };
};

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  const id = cfg('REDDIT_CLIENT_ID');
  const secret = cfg('REDDIT_CLIENT_SECRET');
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.token;
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'MuapiRadar/1.0',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Reddit OAuth: HTTP ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

export const reddit: Connector = {
  id: 'reddit',
  label: 'Reddit',
  tier: 'freekey',
  enabled: () => isMuapiConfigured() || Boolean(cfg('REDDIT_CLIENT_ID') && cfg('REDDIT_CLIENT_SECRET')),
  disabledReason: 'Requires Muapi API Key or free Reddit Client ID & Secret in Settings',
  async fetchMentions(q) {
    const query = q.anyTerms.slice(0, 5).map((k) => `"${k.replace(/"/g, '')}"`).join(' OR ');
    if (!query) return [];

    // 1. Muapi social.search_posts with platform=reddit
    if (isMuapiConfigured()) {
      const muapiResult = await executeMuapiCapability<Record<string, unknown>[]>('/social-search-posts', {
        platform: 'reddit',
        query,
      });
      if (muapiResult && Array.isArray(muapiResult) && muapiResult.length > 0) {
        return muapiResult.map((item) => normalizeMuapiMention(item, 'reddit'));
      }
    }

    // 2. Direct Reddit OAuth
    const token = await getToken();
    const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
    const url = `${base}/search${token ? '' : '.json'}?q=${encodeURIComponent(query)}&sort=new&t=week&limit=100&raw_json=1`;
    const data = await fetchJson<{ data?: { children?: RedditPost[] } }>(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return (data.data?.children ?? [])
      .filter((p) => !p.data.over_18)
      .map((p) => ({
        source: 'reddit',
        externalId: p.data.name,
        url: `https://www.reddit.com${p.data.permalink}`,
        title: p.data.title,
        content: truncate(p.data.selftext || p.data.title, 1500),
        author: p.data.author,
        authorHandle: `u/${p.data.author}`,
        community: `r/${p.data.subreddit}`,
        publishedAt: new Date(p.data.created_utc * 1000),
        engagement: { likes: p.data.ups, comments: p.data.num_comments },
      } satisfies RawMention));
  },
};
