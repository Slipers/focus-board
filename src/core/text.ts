import type { FontKind } from './types';
import { FONTS } from './palette';

export const LINE_HEIGHT = 1.32;

export interface TextLayout {
  lines: string[];
  width: number;
  height: number;
  lineHeight: number;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d')!;
  }
  return measureCtx;
}

export function fontString(font: FontKind, size: number, weight = 400): string {
  return `${weight} ${size}px ${FONTS[font]}`;
}

const cache = new Map<string, TextLayout>();

/** Découpe le texte en lignes tenant dans `maxWidth`. Résultat mémoïsé. */
export function layoutText(text: string, font: FontKind, size: number, maxWidth: number): TextLayout {
  const key = `${font}|${size}|${Math.round(maxWidth)}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const c = ctx();
  c.font = fontString(font, size);
  const lines: string[] = [];
  let widest = 0;

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (c.measureText(candidate).width <= maxWidth || line === '') {
        // Un mot seul plus large que la boîte doit être coupé caractère par caractère.
        if (line === '' && c.measureText(word).width > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (c.measureText(chunk + ch).width > maxWidth && chunk) {
              lines.push(chunk);
              widest = Math.max(widest, c.measureText(chunk).width);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        } else {
          line = candidate;
        }
      } else {
        const trimmed = line.replace(/\s+$/, '');
        lines.push(trimmed);
        widest = Math.max(widest, c.measureText(trimmed).width);
        line = word.trimStart();
      }
    }
    lines.push(line);
    widest = Math.max(widest, c.measureText(line).width);
  }

  const layout: TextLayout = {
    lines,
    width: Math.min(maxWidth, Math.ceil(widest)),
    height: Math.ceil(lines.length * size * LINE_HEIGHT),
    lineHeight: size * LINE_HEIGHT,
  };
  if (cache.size > 4000) cache.clear();
  cache.set(key, layout);
  return layout;
}

export function measureLineWidth(text: string, font: FontKind, size: number): number {
  const c = ctx();
  c.font = fontString(font, size);
  return c.measureText(text).width;
}

/** Plus grande taille de police tenant dans la boîte (notes autocollantes). */
export function fitFontSize(text: string, font: FontKind, boxW: number, boxH: number, max: number, min = 10): number {
  for (let size = max; size > min; size -= 2) {
    const l = layoutText(text || ' ', font, size, boxW);
    if (l.height <= boxH) return size;
  }
  return min;
}
