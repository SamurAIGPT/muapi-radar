import { collect, fetchJson, stripHtml, truncate } from './util';
import type { Connector, RawMention } from './types';
import { cfg } from '@/lib/connector-config';

const SITES: Record<string, string> = {
  stackoverflow: 'Stack Overflow',
  superuser: 'Super User',
  money: 'Money Stack Exchange',
  workplace: 'The Workplace Stack Exchange',
  travel: 'Travel Stack Exchange',
  parenting: 'Parenting Stack Exchange',
};

type SeItem = {
  question_id: number; title: string; link: string;
  tags?: string[]; score: number; answer_count: number; view_count: number;
  creation_date: number; owner?: { display_name?: string };
};

async function searchSite(term: string, site: string, label: string): Promise<RawMention[]> {
  try {
    const key = cfg('STACK_EXCHANGE_KEY');
    const params = new URLSearchParams({
      order: 'desc', sort: 'activity', intitle: term, site, pagesize: '20', filter: 'default',
      ...(key ? { key } : {}),
    });
    const data = await fetchJson<{ items?: SeItem[] }>(`https://api.stackexchange.com/2.3/search?${params}`);
    return (data.items ?? []).map((it) => {
      const title = stripHtml(it.title);
      return {
        source: 'stackexchange',
        externalId: String(it.question_id),
        url: it.link,
        title: truncate(title, 300),
        content: truncate(title, 300),
        author: it.owner?.display_name ? stripHtml(it.owner.display_name) : undefined,
        community: label,
        publishedAt: new Date(it.creation_date * 1000),
        language: 'en',
        engagement: { likes: it.score, comments: it.answer_count },
        reach: it.view_count,
      } satisfies RawMention;
    });
  } catch {
    return [];
  }
}

export const stackExchange: Connector = {
  id: 'stackexchange',
  label: 'Stack Exchange',
  tier: 'free',
  enabled: () => true,
  async fetchMentions(q) {
    const terms = q.anyTerms.slice(0, 3);
    if (terms.length === 0) return [];
    const jobs = terms.flatMap((t) => Object.entries(SITES).map(([site, label]) => searchSite(t, site, label)));
    return collect(jobs);
  },
};
