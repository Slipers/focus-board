import type { FontKind, PaperKind } from './types';

export interface Swatch {
  name: string;
  value: string;
}

/** Encres choisies pour rester lisibles aussi bien sur papier clair que sombre. */
export const INK_COLORS: Swatch[] = [
  { name: 'Encre', value: '#12141a' },
  { name: 'Craie', value: '#f5f7fa' },
  { name: 'Ardoise', value: '#64748b' },
  { name: 'Rouge', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Ambre', value: '#f5b301' },
  { name: 'Vert', value: '#22c55e' },
  { name: 'Émeraude', value: '#0d9488' },
  { name: 'Bleu', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Violet', value: '#a855f7' },
  { name: 'Rose', value: '#ec4899' },
];

export const NOTE_COLORS: Swatch[] = [
  { name: 'Jaune', value: '#ffd965' },
  { name: 'Pêche', value: '#ffb27a' },
  { name: 'Rose', value: '#ff9ec4' },
  { name: 'Menthe', value: '#8ce0b8' },
  { name: 'Ciel', value: '#8fc8ff' },
  { name: 'Lavande', value: '#c1aaff' },
  { name: 'Sable', value: '#e7dcc4' },
  { name: 'Blanc', value: '#f4f5f7' },
];

export interface PaperTheme {
  bg: string;
  line: string;
  dot: string;
  dark: boolean;
  /** Couleur d'encre par défaut sur ce papier. */
  defaultInk: string;
}

export const PAPERS: Record<PaperKind, PaperTheme> = {
  white: { bg: '#ffffff', line: '#e3e7ee', dot: '#ccd3de', dark: false, defaultInk: '#12141a' },
  cream: { bg: '#f8f3e8', line: '#e6dcc7', dot: '#d8cbaf', dark: false, defaultInk: '#2b2419' },
  slate: { bg: '#191b21', line: '#262a33', dot: '#333846', dark: true, defaultInk: '#f5f7fa' },
  black: { bg: '#0a0a0c', line: '#191a1f', dot: '#23252c', dark: true, defaultInk: '#f5f7fa' },
};

export const FONTS: Record<FontKind, string> = {
  sans: '"Segoe UI Variable Display", "Segoe UI", Inter, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Code", Consolas, "SF Mono", monospace',
  hand: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive',
};

export const FONT_LABELS: Record<FontKind, string> = {
  sans: 'Sans',
  serif: 'Serif',
  mono: 'Mono',
  hand: 'Manuscrit',
};

/** Luminance perçue, pour choisir automatiquement une couleur de texte lisible. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readableTextColor(bg: string): string {
  return luminance(bg) > 0.55 ? '#1b1d23' : '#f7f8fa';
}

export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
