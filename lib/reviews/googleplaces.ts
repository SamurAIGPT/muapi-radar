import { fetchJson } from '@/lib/connectors/util';
import { cfg } from '@/lib/connector-config';
import { isMuapiConfigured, dispatchMuapiTask } from '@/lib/muapi-client';
import type { RawReview } from './types';

type PlaceReview = {
  author_name?: string;
  rating?: number;
  text?: string;
  time?: number;
  relative_time_description?: string;
};

type PlaceDetailsResponse = {
  status: string;
  result?: { name?: string; reviews?: PlaceReview[] };
};

export function googlePlacesEnabled(): boolean {
  return Boolean(cfg('GOOGLE_PLACES_API_KEY') || isMuapiConfigured());
}

export async function fetchGooglePlacesReviews(placeId: string): Promise<RawReview[]> {
  // If Muapi configured and placeId contains url or keywords, or fallback to Google Places native API
  const key = cfg('GOOGLE_PLACES_API_KEY');
  if (key) {
    const url = `https://maps.googleapis.com/maps/api/place/details/json`
      + `?place_id=${encodeURIComponent(placeId)}&fields=name,reviews&key=${key}`;

    const data = await fetchJson<PlaceDetailsResponse>(url);
    if (data.status === 'OK') {
      const reviews = data.result?.reviews ?? [];
      return reviews
        .filter((r): r is PlaceReview & { rating: number } => typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5)
        .map((r) => {
          const time = r.time ?? Math.floor(Date.now() / 1000);
          return {
            externalId: `${time}-${(r.author_name ?? 'anon').slice(0, 40)}`,
            rating: Math.round(r.rating),
            content: r.text ?? '',
            author: r.author_name,
            publishedAt: new Date(time * 1000),
          } satisfies RawReview;
        });
    }
  }

  // Muapi async fallback
  if (isMuapiConfigured()) {
    try {
      const resp = await dispatchMuapiTask<any>('/maps-reviews', { place_id: placeId });
      const items = Array.isArray(resp.result?.reviews) ? resp.result.reviews : [];
      return items.map((r: any, idx: number) => ({
        externalId: r.id || `${placeId}-${idx}`,
        rating: Math.round(Number(r.rating) || 5),
        content: r.text || r.snippet || '',
        author: r.author || r.user,
        url: r.url,
        publishedAt: r.date ? new Date(r.date) : new Date(),
      }));
    } catch (e) {
      console.warn('[reviews] Google Maps via Muapi fallback failed:', (e as Error).message);
    }
  }

  return [];
}
