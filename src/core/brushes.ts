import type { BrushKind, TabletSettings } from './types';
import type { OutlineOptions } from './freehand';

export interface BrushPreset {
  label: string;
  /** Sensibilité à la pression (0 = largeur constante). */
  thinning: number;
  taperStart: number;
  taperEnd: number;
  jitter: number;
  alpha: number;
  /** Le surligneur se fond dans le papier au lieu de le recouvrir. */
  blend: boolean;
  sizes: number[];
  defaultSize: number;
}

export const BRUSHES: Record<BrushKind, BrushPreset> = {
  pen: {
    label: 'Stylo',
    thinning: 0.62,
    taperStart: 5,
    taperEnd: 14,
    jitter: 0,
    alpha: 1,
    blend: false,
    sizes: [2, 4, 6, 10, 16],
    defaultSize: 4,
  },
  marker: {
    label: 'Feutre',
    thinning: 0.22,
    taperStart: 2,
    taperEnd: 4,
    jitter: 0,
    alpha: 1,
    blend: false,
    sizes: [6, 10, 16, 24, 34],
    defaultSize: 10,
  },
  highlighter: {
    label: 'Surligneur',
    thinning: 0,
    taperStart: 0,
    taperEnd: 0,
    jitter: 0,
    alpha: 0.38,
    blend: true,
    sizes: [14, 22, 32, 46, 64],
    defaultSize: 22,
  },
  pencil: {
    label: 'Crayon',
    thinning: 0.55,
    taperStart: 3,
    taperEnd: 6,
    jitter: 0.34,
    alpha: 0.92,
    blend: false,
    sizes: [2, 3, 5, 8, 12],
    defaultSize: 3,
  },
};

export function outlineOptionsFor(brush: BrushKind, size: number, tablet: TabletSettings): OutlineOptions {
  const p = BRUSHES[brush];
  const scale = size / p.defaultSize;
  return {
    size,
    thinning: p.thinning,
    minWidth: tablet.minWidth,
    curve: tablet.pressureCurve,
    taperStart: p.taperStart * scale,
    taperEnd: p.taperEnd * scale,
    jitter: p.jitter,
  };
}
