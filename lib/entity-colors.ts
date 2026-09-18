export const ENTITY_COLORS = [
  '#3987e5', '#d95926', '#199e70', '#c98500',
  '#d55181', '#008300', '#9085e9', '#e66767',
];

export const OVERFLOW_COLOR = '#64748b';

export const entityColor = (i: number): string => ENTITY_COLORS[i] ?? OVERFLOW_COLOR;

export type PaletteId = 'categorical' | 'sequential' | 'diverging';

export const PALETTES: Record<PaletteId, {
  label: string; use: string; colors: string[];
}> = {
  categorical: {
    label: 'Identity',
    use: 'Distinct series: channels, people, themes. Color denotes who, not how much.',
    colors: ENTITY_COLORS,
  },
  sequential: {
    label: 'Intensity',
    use: 'A single increasing magnitude: rankings, volume. From light to dark.',
    colors: ['#c6e0f9', '#a3cbf4', '#7fb5ef', '#5c9fea', '#3987e5', '#2e6bb0'],
  },
  diverging: {
    label: 'Polarity',
    use: 'Values with opposing directions around zero: sentiment, deltas.',
    colors: ['#d24b3f', '#e0836f', '#94a3b8', '#5bb98c', '#199e70'],
  },
};

export function paletteColor(palette: PaletteId, i: number, total = 1): string {
  const c = PALETTES[palette].colors;
  if (palette === 'categorical') return c[i] ?? OVERFLOW_COLOR;
  if (total <= 1) return c[Math.floor(c.length / 2)];
  const pos = Math.round((i / (total - 1)) * (c.length - 1));
  return c[Math.min(c.length - 1, Math.max(0, pos))];
}
