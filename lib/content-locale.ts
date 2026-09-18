import { getMeta, setMeta } from '@/lib/db';

export type ContentLocale = 'en' | 'it';

const NAMES: Record<ContentLocale, string> = { en: 'English', it: 'Italian' };

export async function getContentLocale(): Promise<ContentLocale> {
  const v = await getMeta<string>('content_locale');
  return v === 'it' ? 'it' : 'en';
}

export async function setContentLocale(locale: ContentLocale): Promise<void> {
  await setMeta('content_locale', locale === 'it' ? 'it' : 'en');
}

export function localeDirective(locale: ContentLocale): string {
  if (locale === 'en') return '';
  return `\n\nIMPORTANT: Write every human-readable text value — titles, descriptions, summaries, explanations, narratives, answers — in ${NAMES[locale]}. Keep all JSON keys and controlled enum/category values (sentiment labels, stance, quadrant names, risk levels, etc.) exactly in English.`;
}
