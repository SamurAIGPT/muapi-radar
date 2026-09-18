import { SOURCE_META } from '@/lib/connectors';

const KNOWN_CASING: Record<string, string> = {
  linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok',
  facebook: 'Facebook', instagram: 'Instagram', twitter: 'Twitter',
  x: 'X', ig: 'Instagram', fb: 'Facebook', lk: 'LinkedIn', yt: 'YouTube',
  tt: 'TikTok', whatsapp: 'WhatsApp', wechat: 'WeChat', vk: 'VK',
};

/** Convert slug to readable label: "instagram-feed" -> "Instagram Feed". */
export function prettySource(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => KNOWN_CASING[w.toLowerCase()] ?? (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function sourceLabel(id: string): string {
  return SOURCE_META[id]?.label ?? prettySource(id);
}

const FALLBACK_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767', '#008300'];

export function sourceColor(id: string): string {
  const known = SOURCE_META[id]?.color;
  if (known) return known;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}
