import type { AnyElement, Camera, ID } from './types';

export interface Vec {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function uid(len = 12): ID {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

/* ------------------------------------------------------------- caméra */

export function screenToWorld(cam: Camera, sx: number, sy: number): Vec {
  return { x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): Vec {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

export function viewportWorldRect(cam: Camera, vw: number, vh: number): Rect {
  return { x: cam.x, y: cam.y, w: vw / cam.zoom, h: vh / cam.zoom };
}

/* -------------------------------------------------------- rectangles */

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function pointInRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/* ------------------------------------------------- repère des éléments */

export function elementCenter(el: AnyElement): Vec {
  return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
}

/** Convertit un point monde vers le repère local (non tourné) de l'élément. */
export function worldToLocal(el: AnyElement, wx: number, wy: number): Vec {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const dx = wx - cx;
  const dy = wy - cy;
  const c = Math.cos(-el.angle);
  const s = Math.sin(-el.angle);
  return { x: dx * c - dy * s + el.w / 2, y: dx * s + dy * c + el.h / 2 };
}

export function localToWorld(el: AnyElement, lx: number, ly: number): Vec {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const dx = lx - el.w / 2;
  const dy = ly - el.h / 2;
  const c = Math.cos(el.angle);
  const s = Math.sin(el.angle);
  return { x: dx * c - dy * s + cx, y: dx * s + dy * c + cy };
}

export function elementCorners(el: AnyElement): Vec[] {
  return [
    localToWorld(el, 0, 0),
    localToWorld(el, el.w, 0),
    localToWorld(el, el.w, el.h),
    localToWorld(el, 0, el.h),
  ];
}

/** Boîte englobante alignée aux axes, rotation comprise. */
export function elementBounds(el: AnyElement): Rect {
  if (!el.angle) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const pts = elementCorners(el);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Marge de rendu : un trait épais déborde de sa boîte de points. */
export function paddedBounds(el: AnyElement): Rect {
  const pad = el.type === 'stroke' ? el.size * 1.5 + 4 : el.type === 'shape' ? el.strokeWidth * 2 + 24 : 8;
  return inflate(elementBounds(el), pad);
}

/* --------------------------------------------------------- primitives */

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Test pair-impair sur un polygone donné en coordonnées plates [x,y,…]. */
export function pointInPolygon(poly: number[], x: number, y: number): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2];
    const yi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonBounds(poly: number[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    minX = Math.min(minX, poly[i]);
    maxX = Math.max(maxX, poly[i]);
    minY = Math.min(minY, poly[i + 1]);
    maxY = Math.max(maxY, poly[i + 1]);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rotateAngle(cx: number, cy: number, x: number, y: number): number {
  return Math.atan2(y - cy, x - cx);
}

export const SNAP_ANGLE = Math.PI / 12; // 15°
export function snapAngle(a: number): number {
  return Math.round(a / SNAP_ANGLE) * SNAP_ANGLE;
}
