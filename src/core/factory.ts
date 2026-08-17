import type {
  AlignKind,
  AnyElement,
  BrushKind,
  DashKind,
  FontKind,
  ImageElement,
  NoteElement,
  ShapeElement,
  ShapeKind,
  StrokeElement,
  TextElement,
} from './types';
import { uid } from './geom';
import { layoutText } from './text';

export interface StrokeSpec {
  brush: BrushKind;
  color: string;
  size: number;
  /** Points en coordonnées monde, à plat : [x, y, pression, …]. */
  world: number[];
  z: number;
}

/** Convertit un tracé capturé en coordonnées monde vers un élément à repère local. */
export function strokeFromWorldPoints(spec: StrokeSpec): StrokeElement | null {
  const n = spec.world.length / 3;
  if (n === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = spec.world[i * 3];
    const y = spec.world[i * 3 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const points = new Array<number>(spec.world.length);
  for (let i = 0; i < n; i++) {
    points[i * 3] = spec.world[i * 3] - minX;
    points[i * 3 + 1] = spec.world[i * 3 + 1] - minY;
    points[i * 3 + 2] = spec.world[i * 3 + 2];
  }

  return {
    id: uid(),
    type: 'stroke',
    x: minX,
    y: minY,
    w: Math.max(maxX - minX, 0.01),
    h: Math.max(maxY - minY, 0.01),
    angle: 0,
    z: spec.z,
    opacity: 1,
    brush: spec.brush,
    color: spec.color,
    size: spec.size,
    points,
  };
}

/** Remet à l'échelle les points d'un trait après redimensionnement de sa boîte. */
export function scaleStrokePoints(el: StrokeElement, sx: number, sy: number): number[] {
  const out = el.points.slice();
  for (let i = 0; i < out.length; i += 3) {
    out[i] *= sx;
    out[i + 1] *= sy;
  }
  return out;
}

export interface ShapeSpec {
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  fill: string;
  strokeWidth: number;
  dash: DashKind;
  z: number;
  pts?: number[];
  font?: FontKind;
  textColor?: string;
}

export function makeShape(s: ShapeSpec): ShapeElement {
  return {
    id: uid(),
    type: 'shape',
    x: s.x,
    y: s.y,
    w: Math.max(s.w, 1),
    h: Math.max(s.h, 1),
    angle: 0,
    z: s.z,
    opacity: 1,
    shape: s.shape,
    stroke: s.stroke,
    fill: s.fill,
    strokeWidth: s.strokeWidth,
    dash: s.dash,
    pts: s.pts,
    text: '',
    textColor: s.textColor ?? s.stroke,
    fontSize: 18,
    font: s.font ?? 'sans',
  };
}

export const NOTE_SIZE = 200;

export function makeNote(
  x: number,
  y: number,
  color: string,
  textColor: string,
  font: FontKind,
  z: number,
  size = NOTE_SIZE,
): NoteElement {
  return {
    id: uid(),
    type: 'note',
    x: x - size / 2,
    y: y - size / 2,
    w: size,
    h: size,
    angle: 0,
    z,
    opacity: 1,
    color,
    text: '',
    textColor,
    fontSize: 26,
    font,
    align: 'left',
  };
}

export function makeText(
  x: number,
  y: number,
  color: string,
  font: FontKind,
  fontSize: number,
  z: number,
  align: AlignKind = 'left',
): TextElement {
  return {
    id: uid(),
    type: 'text',
    x,
    y,
    w: 320,
    h: fontSize * 1.32,
    angle: 0,
    z,
    opacity: 1,
    text: '',
    color,
    fontSize,
    font,
    align,
  };
}

export function makeImage(
  src: string,
  naturalW: number,
  naturalH: number,
  cx: number,
  cy: number,
  z: number,
  maxSide = 520,
): ImageElement {
  const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
  const w = naturalW * scale;
  const h = naturalH * scale;
  return {
    id: uid(),
    type: 'image',
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    angle: 0,
    z,
    opacity: 1,
    src,
    naturalW,
    naturalH,
    radius: 8,
  };
}

/** Hauteur naturelle d'un bloc de texte, pour que la boîte suive la saisie. */
export function textHeightFor(el: TextElement): number {
  return Math.max(el.fontSize * 1.32, layoutText(el.text || ' ', el.font, el.fontSize, el.w).height);
}

export function cloneWithOffset(el: AnyElement, dx: number, dy: number, z: number): AnyElement {
  return { ...structuredClone(el), id: uid(), x: el.x + dx, y: el.y + dy, z };
}
