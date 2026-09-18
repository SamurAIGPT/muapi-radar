import { collect, fetchJson, truncate } from './util';
import type { Connector, RawMention } from './types';

const FORMS = '8-K,10-K,10-Q,DEF 14A';
const UA = 'MuapiRadar admin@example.com';

type EdgarHit = {
  _id: string;
  _source: {
    ciks: string[]; adsh: string; form: string; file_date: string;
    display_names: string[]; file_description?: string;
  };
};

async function search(term: string): Promise<RawMention[]> {
  try {
    const params = new URLSearchParams({ q: `"${term}"`, forms: FORMS });
    const data = await fetchJson<{ hits?: { hits?: EdgarHit[] } }>(
      `https://efts.sec.gov/LATEST/search-index?${params}`,
      { headers: { 'User-Agent': UA } },
    );
    return (data.hits?.hits ?? []).map((h) => {
      const s = h._source;
      const cik = String(Number(s.ciks[0]));
      const accession = s.adsh.replace(/-/g, '');
      const filename = h._id.split(':')[1] ?? '';
      const company = (s.display_names[0] ?? 'Unknown filer').replace(/\s+\(CIK \d+\)\s*$/, '');
      const label = `${company} filed a ${s.form}${s.file_description ? `: ${s.file_description}` : ''}`;
      return {
        source: 'sec-edgar',
        externalId: h._id,
        url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/${filename}`,
        title: truncate(label, 300),
        content: truncate(label, 300),
        author: company,
        community: s.form,
        publishedAt: new Date(s.file_date),
        language: 'en',
      } satisfies RawMention;
    });
  } catch {
    return [];
  }
}

export const secEdgar: Connector = {
  id: 'sec-edgar',
  label: 'SEC EDGAR',
  tier: 'free',
  enabled: () => true,
  async fetchMentions(q) {
    const terms = q.anyTerms.slice(0, 3);
    if (terms.length === 0) return [];
    return collect(terms.map(search));
  },
};
