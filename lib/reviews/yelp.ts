import { fetchJson } from '@/lib/connectors/util';
import { cfg } from '@/lib/connector-config';
import type { RawReview } from './types';

type YelpBusiness = {
  id: string; name: string; rating?: number; review_count?: number;
  location?: { display_address?: string[] };
};
type YelpReview = {
  id: string; url?: string; text?: string; rating?: number;
  time_created?: string; user?: { name?: string };
};

export function yelpEnabled(): boolean {
  return Boolean(cfg('YELP_API_KEY'));
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${cfg('YELP_API_KEY')}` };
}

export type YelpHit = { id: string; name: string; address: string; rating: number | null; reviewCount: number };

export async function searchYelpBusinesses(term: string, location: string): Promise<YelpHit[]> {
  const key = cfg('YELP_API_KEY');
  if (!key || term.trim().length < 2 || location.trim().length < 2) return [];
  const params = new URLSearchParams({ term, location, limit: '8' });
  const data = await fetchJson<{ businesses?: YelpBusiness[] }>(
    `https://api.yelp.com/v3/businesses/search?${params}`, { headers: authHeaders() },
  );
  return (data.businesses ?? []).map((b) => ({
    id: b.id, name: b.name,
    address: (b.location?.display_address ?? []).join(', '),
    rating: b.rating ?? null, reviewCount: b.review_count ?? 0,
  }));
}

export async function fetchYelpReviews(businessId: string): Promise<RawReview[]> {
  const key = cfg('YELP_API_KEY');
  if (!key) return [];
  const data = await fetchJson<{ reviews?: YelpReview[] }>(
    `https://api.yelp.com/v3/businesses/${encodeURIComponent(businessId)}/reviews?limit=20&sort_by=newest`,
    { headers: authHeaders() },
  );
  const reviews = data.reviews ?? [];
  return reviews
    .filter((r): r is YelpReview & { rating: number } => typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5)
    .map((r) => ({
      externalId: r.id,
      rating: Math.round(r.rating),
      content: r.text ?? '',
      author: r.user?.name,
      url: r.url,
      publishedAt: r.time_created ? new Date(r.time_created) : new Date(),
    } satisfies RawReview));
}
