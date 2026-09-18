// Article text extraction from web pages
const UA = 'Mozilla/5.0 (compatible; MuapiRadarBot/1.0; +https://github.com/muapi-radar)';
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 2_000_000;
const MAX_CHARS = 20_000;
const MIN_CHARS = 320;

export type ArticleFetch =
  | { ok: true; text: string; finalUrl: string }
  | { ok: false; reason: 'opaque_redirect' | 'too_short' | 'unreachable' | 'not_html' };

export const isOpaqueRedirect = (url: string): boolean => /(^|\/\/)news\.google\./i.test(url);

const STRIP = /<(script|style|noscript|svg|form|nav|header|footer|aside|figure|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

function decode(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
    egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì',
    hellip: '…', mdash: '—', ndash: '–', euro: '€', deg: '°',
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

const textOf = (html: string): string =>
  decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function mainText(html: string): string {
  const cleaned = html.replace(STRIP, ' ');

  const candidates: string[] = [];
  const containers = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of cleaned.matchAll(containers)) candidates.push(m[2]);
  for (const m of cleaned.matchAll(/<div\b[^>]*(?:articleBody|article-body|story-body|entry-content|post-content)[^>]*>([\s\S]*?)<\/div>/gi)) {
    candidates.push(m[1]);
  }
  candidates.push(cleaned);

  let best = '';
  for (const c of candidates) {
    const paras = [...c.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => textOf(m[1]))
      .filter((t) => t.length > 60);
    const joined = paras.join('\n\n');
    if (joined.length > best.length) best = joined;
  }
  return best.slice(0, MAX_CHARS);
}

async function get(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').includes('html')) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) return null;
    return { html: (await res.text()).slice(0, MAX_BYTES), finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchArticleText(url: string): Promise<ArticleFetch> {
  if (isOpaqueRedirect(url)) return { ok: false, reason: 'opaque_redirect' };

  const page = await get(url);
  if (!page) return { ok: false, reason: 'unreachable' };
  if (isOpaqueRedirect(page.finalUrl)) return { ok: false, reason: 'opaque_redirect' };

  const text = mainText(page.html);
  if (text.length < MIN_CHARS) return { ok: false, reason: 'too_short' };
  return { ok: true, text, finalUrl: page.finalUrl };
}

export async function fetchArticles(
  items: { id: number; url: string }[], concurrency = 4,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const hostBusy = new Set<string>();
  const queue = [...items];

  const worker = async () => {
    while (queue.length) {
      const idx = queue.findIndex((it) => {
        try { return !hostBusy.has(new URL(it.url).host); } catch { return false; }
      });
      if (idx === -1) { queue.shift(); continue; }
      const [job] = queue.splice(idx, 1);

      let host = '';
      try { host = new URL(job.url).host; } catch { continue; }
      hostBusy.add(host);
      try {
        const r = await fetchArticleText(job.url);
        if (r.ok) out.set(job.id, r.text);
      } finally {
        hostBusy.delete(host);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
