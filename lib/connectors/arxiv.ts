import { XMLParser } from 'fast-xml-parser';
import type { Connector, RawMention } from './types';
import { fetchText, truncate } from './util';

type ArxivEntry = {
  id: string; title: string; summary: string; published: string;
  author?: { name: string } | { name: string }[];
  link?: { '@_href': string; '@_title'?: string } | { '@_href': string; '@_title'?: string }[];
};

function pickPdfLink(link: ArxivEntry['link'], fallbackId: string): string {
  const links = Array.isArray(link) ? link : link ? [link] : [];
  const abs = links.find((l) => !l['@_title']) ?? links[0];
  return abs?.['@_href'] ?? fallbackId;
}

function authorNames(author: ArxivEntry['author']): string | undefined {
  const list = Array.isArray(author) ? author : author ? [author] : [];
  return list.map((a) => a.name).filter(Boolean).join(', ') || undefined;
}

async function searchArxiv(term: string): Promise<RawMention[]> {
  try {
    const params = new URLSearchParams({
      search_query: `all:"${term}"`,
      sortBy: 'submittedDate', sortOrder: 'descending', max_results: '15',
    });
    const xml = await fetchText(`https://export.arxiv.org/api/query?${params}`);
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
    let entries: ArxivEntry[] = parsed?.feed?.entry ?? [];
    if (!Array.isArray(entries)) entries = [entries];

    const needle = term.toLowerCase();
    return entries
      .filter((e) => `${e.title} ${e.summary}`.toLowerCase().includes(needle))
      .map((e) => {
        const title = e.title.replace(/\s+/g, ' ').trim();
        const summary = e.summary.replace(/\s+/g, ' ').trim();
        return {
          source: 'arxiv',
          externalId: e.id,
          url: pickPdfLink(e.link, e.id).replace(/^http:/, 'https:'),
          title: truncate(title, 300),
          content: truncate(summary, 600),
          author: authorNames(e.author),
          publishedAt: new Date(e.published),
          language: 'en',
        } satisfies RawMention;
      });
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const arxiv: Connector = {
  id: 'arxiv',
  label: 'arXiv',
  tier: 'free',
  enabled: () => true,
  async fetchMentions(q) {
    const terms = q.anyTerms.slice(0, 3);
    if (terms.length === 0) return [];
    const out: RawMention[] = [];
    for (const term of terms) {
      try {
        out.push(...await searchArxiv(term));
      } catch (e) {
        console.error(`[arxiv] search failed for "${term}":`, e);
      }
      if (terms.indexOf(term) < terms.length - 1) await sleep(2000);
    }
    return out;
  },
};
