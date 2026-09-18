import { collect, fetchJson, truncate } from './util';
import type { Connector, RawMention } from './types';
import { cfg } from '@/lib/connector-config';

type GhUser = { login: string; type: string };
type GhIssue = {
  id: number; html_url: string; title: string; body?: string | null;
  user: GhUser; repository_url: string; created_at: string; comments: number;
  reactions?: { total_count?: number };
};

async function search(term: string, token?: string): Promise<RawMention[]> {
  try {
    const params = new URLSearchParams({
      q: `${term} in:title`, sort: 'created', order: 'desc', per_page: '30',
    });
    const data = await fetchJson<{ items?: GhIssue[] }>(
      `https://api.github.com/search/issues?${params}`,
      { headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) } },
    );
    return (data.items ?? [])
      .filter((it) => it.user?.type !== 'Bot')
      .map((it) => {
        const repo = it.repository_url.split('/repos/')[1] ?? 'github';
        return {
          source: 'github',
          externalId: String(it.id),
          url: it.html_url,
          title: truncate(it.title, 300),
          content: truncate(it.body?.trim() || it.title, 1500),
          author: it.user?.login,
          community: repo,
          publishedAt: new Date(it.created_at),
          language: 'en',
          engagement: { likes: it.reactions?.total_count ?? 0, comments: it.comments },
        } satisfies RawMention;
      });
  } catch {
    return [];
  }
}

export const github: Connector = {
  id: 'github',
  label: 'GitHub',
  tier: 'free',
  enabled: () => true,
  async fetchMentions(q) {
    const token = cfg('GITHUB_TOKEN');
    const terms = q.anyTerms.slice(0, 2);
    if (terms.length === 0) return [];
    return collect(terms.map((t) => search(t, token)));
  },
};
