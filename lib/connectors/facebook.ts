import type { Connector, RawMention } from './types';
import { fetchJson, stripHtml, truncate } from './util';
import { cfg } from '@/lib/connector-config';
import { isMuapiConfigured, executeMuapiCapability, normalizeMuapiMention } from '@/lib/muapi-client';

const G = 'https://graph.facebook.com/v21.0';

type FbPost = {
  id: string; message?: string; permalink_url?: string; created_time?: string;
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
};

async function pagePosts(pageId: string): Promise<RawMention[]> {
  const token = cfg('META_ACCESS_TOKEN');
  if (!token) return [];
  const data = await fetchJson<{ data?: FbPost[] }>(
    `${G}/${pageId.trim()}/posts?fields=message,permalink_url,created_time,shares,reactions.summary(true),comments.summary(true)&limit=30&access_token=${token}`,
  );
  return (data.data ?? []).map((p) => ({
    source: 'facebook',
    externalId: p.id,
    url: p.permalink_url,
    content: truncate(stripHtml(p.message ?? ''), 1200),
    community: `page ${pageId.trim()}`,
    publishedAt: p.created_time ? new Date(p.created_time) : new Date(),
    engagement: {
      likes: p.reactions?.summary?.total_count ?? 0,
      comments: p.comments?.summary?.total_count ?? 0,
      shares: p.shares?.count ?? 0,
    },
  } satisfies RawMention)).filter((m) => m.content);
}

export const facebook: Connector = {
  id: 'facebook',
  label: 'Facebook',
  tier: 'premium',
  enabled: () => isMuapiConfigured() || Boolean(cfg('META_ACCESS_TOKEN') && cfg('FACEBOOK_PAGE_ID')),
  disabledReason: 'Requires Muapi API Key or Meta Access Token and Facebook Page ID in Settings',
  async fetchMentions(q) {
    // 1. Muapi social.read_posts with platform=facebook
    if (isMuapiConfigured()) {
      const pageId = cfg('FACEBOOK_PAGE_ID') || q.anyTerms[0] || 'brand';
      const muapiResult = await executeMuapiCapability<Record<string, unknown>[]>('/social-read-posts', {
        platform: 'facebook',
        username: pageId,
      });
      if (muapiResult && Array.isArray(muapiResult) && muapiResult.length > 0) {
        return muapiResult.map((item) => normalizeMuapiMention(item, 'facebook'));
      }
      return [];
    }

    // 2. Direct Graph API fallback
    const pages = (cfg('FACEBOOK_PAGE_ID') ?? '').split(',').filter(Boolean).slice(0, 5);
    const results = await Promise.allSettled(pages.map(pagePosts));
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  },
};
