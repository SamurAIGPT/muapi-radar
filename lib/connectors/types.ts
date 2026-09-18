import type { Engagement } from '@/lib/db/schema';

export interface ListeningQuery {
  anyTerms: string[];
  allTerms: string[];
  excludeTerms: string[];
  groups?: string[][];
  languages: string[];
  countries: string[];
  talkwalkerProject?: string;
  talkwalkerTopics?: string[];
}

export interface RawMention {
  source: string;
  externalId: string;
  url?: string;
  title?: string;
  content: string;
  author?: string;
  authorHandle?: string;
  community?: string;
  publishedAt: Date;
  language?: string;
  country?: string;
  engagement?: Engagement;
  reach?: number;
}

export interface Connector {
  id: string;
  label: string;
  tier: 'free' | 'freekey' | 'premium';
  enabled: () => boolean;
  disabledReason?: string;
  fetchMentions(q: ListeningQuery): Promise<RawMention[]>;
}

const quote = (t: string) => (t.includes(' ') ? `"${t.replace(/"/g, '')}"` : t.replace(/"/g, ''));

export function booleanQuery(q: ListeningQuery): string {
  const parts: string[] = [];
  if (q.anyTerms.length) parts.push(`(${q.anyTerms.map(quote).join(' OR ')})`);
  for (const g of q.groups ?? []) {
    if (g.length) parts.push(g.length === 1 ? quote(g[0]) : `(${g.map(quote).join(' OR ')})`);
  }
  parts.push(...q.allTerms.map(quote));
  parts.push(...q.excludeTerms.map((t) => `-${quote(t)}`));
  return parts.join(' ');
}
