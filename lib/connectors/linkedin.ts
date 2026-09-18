import type { Connector, RawMention } from './types';
import { truncate } from './util';
import { cfg } from '@/lib/connector-config';
import { isMuapiConfigured, executeMuapiCapability, normalizeMuapiMention } from '@/lib/muapi-client';

type LiPost = {
  id: string; commentary?: string; publishedAt?: number;
};

export const linkedin: Connector = {
  id: 'linkedin',
  label: 'LinkedIn (page)',
  tier: 'premium',
  enabled: () => isMuapiConfigured() || Boolean(cfg('LINKEDIN_ACCESS_TOKEN') && cfg('LINKEDIN_ORG_ID')),
  disabledReason: 'Requires Muapi API Key or LinkedIn Access Token and Organization ID in Settings',
  async fetchMentions(q) {
    // 1. Muapi social.read_posts with platform=linkedin
    if (isMuapiConfigured()) {
      const orgId = cfg('LINKEDIN_ORG_ID') || q.anyTerms[0] || 'company';
      const muapiResult = await executeMuapiCapability<Record<string, unknown>[]>('/social-read-posts', {
        platform: 'linkedin',
        username: orgId,
      });
      if (muapiResult && Array.isArray(muapiResult) && muapiResult.length > 0) {
        return muapiResult.map((item) => normalizeMuapiMention(item, 'linkedin'));
      }
      return [];
    }

    // 2. Direct LinkedIn Community Management API fallback
    const token = cfg('LINKEDIN_ACCESS_TOKEN');
    const orgId = cfg('LINKEDIN_ORG_ID');
    if (!token || !orgId) return [];
    const author = encodeURIComponent(`urn:li:organization:${orgId}`);
    const res = await fetch(
      `https://api.linkedin.com/rest/posts?author=${author}&q=author&count=30&sortBy=LAST_MODIFIED`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'LinkedIn-Version': '202409',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) throw new Error(`LinkedIn: HTTP ${res.status}`);
    const data = await res.json() as { elements?: LiPost[] };
    return (data.elements ?? []).map((p) => ({
      source: 'linkedin',
      externalId: p.id,
      url: `https://www.linkedin.com/feed/update/${p.id}`,
      content: truncate(p.commentary ?? '', 1200),
      community: 'company page',
      publishedAt: p.publishedAt ? new Date(p.publishedAt) : new Date(),
    } satisfies RawMention)).filter((m) => m.content);
  },
};
