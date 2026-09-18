import type { Connector, RawMention } from './types';
import { collect, fetchJson, truncate } from './util';
import { cfg } from '@/lib/connector-config';
import { isMuapiConfigured, executeMuapiCapability, normalizeMuapiMention } from '@/lib/muapi-client';

const G = 'https://graph.facebook.com/v21.0';

type IgMedia = {
  id: string; caption?: string; permalink?: string; timestamp?: string;
  like_count?: number; comments_count?: number; username?: string;
};

async function hashtagMedia(tag: string): Promise<RawMention[]> {
  const token = cfg('META_ACCESS_TOKEN');
  const userId = cfg('INSTAGRAM_USER_ID');
  if (!token || !userId) return [];
  const search = await fetchJson<{ data?: { id: string }[] }>(
    `${G}/ig_hashtag_search?user_id=${userId}&q=${encodeURIComponent(tag)}&access_token=${token}`,
  );
  const hashtagId = search.data?.[0]?.id;
  if (!hashtagId) return [];
  const media = await fetchJson<{ data?: IgMedia[] }>(
    `${G}/${hashtagId}/recent_media?user_id=${userId}&fields=id,caption,permalink,timestamp,like_count,comments_count,username&limit=40&access_token=${token}`,
  );
  return (media.data ?? []).map((m) => ({
    source: 'instagram',
    externalId: m.id,
    url: m.permalink,
    content: truncate(m.caption ?? '', 1000),
    author: m.username,
    authorHandle: m.username ? `@${m.username}` : undefined,
    community: `#${tag}`,
    publishedAt: m.timestamp ? new Date(m.timestamp) : new Date(),
    engagement: { likes: m.like_count ?? 0, comments: m.comments_count ?? 0 },
  } satisfies RawMention)).filter((m) => m.content);
}

export const instagram: Connector = {
  id: 'instagram',
  label: 'Instagram',
  tier: 'premium',
  enabled: () => isMuapiConfigured() || Boolean(cfg('META_ACCESS_TOKEN') && cfg('INSTAGRAM_USER_ID')),
  disabledReason: 'Requires Muapi API Key or Meta Access Token and Instagram User ID in Settings',
  async fetchMentions(q) {
    const query = q.anyTerms.slice(0, 3).join(' OR ');
    if (!query) return [];

    // 1. Muapi social.search_posts with platform=instagram
    if (isMuapiConfigured()) {
      const muapiResult = await executeMuapiCapability<Record<string, unknown>[]>('/social-search-posts', {
        platform: 'instagram',
        query,
      });
      if (muapiResult && Array.isArray(muapiResult) && muapiResult.length > 0) {
        return muapiResult.map((item) => normalizeMuapiMention(item, 'instagram'));
      }
    }

    // 2. Direct Meta Graph API fallback
    const tags = [...new Set(
      q.anyTerms.map((k) => k.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()).filter((t) => t.length >= 3),
    )].slice(0, 3);
    return collect(tags.map(hashtagMedia));
  },
};
