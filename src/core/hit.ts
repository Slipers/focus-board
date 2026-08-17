import type { AnyElement, ShapeElement, StrokeElement } from './types';
import { buildShapePath } from '../render/scene';
import {
  distToSegment,
  elementBounds,
  pointInPolygon,
  polygonBounds,
  rectContainsRect,
  rectsIntersect,
  segmentsIntersect,
  worldToLocal,
  type Rect,
} from './geom';

let probe: CanvasRenderingContext2D | null = null;
function probeCtx(): CanvasRenderingContext2D {
  if (!probe) probe = document.createElement('canvas').getContext('2d')!;
  return probe;
}

/** Test de survol d'un élément, `tolerance` exprimée en px monde. */
export function hitsElement(el: AnyElement, wx: number, wy: number, tolerance: number): boolean {
  const local = worldToLocal(el, wx, wy);

  switch (el.type) {
    case 'stroke':
      return hitsStroke(el, local.x, local.y, tolerance);
    case 'shape':
      return hitsShape(el, local.x, local.y, tolerance);
    default:
      return (
        local.x >= -tolerance &&
        local.y >= -tolerance &&
        local.x <= el.w + tolerance &&
        local.y <= el.h + tolerance
      );
  }
}

function hitsStroke(el: StrokeElement, lx: number, ly: number, tolerance: number): boolean {
  const pts = el.points;
  const n = pts.length / 3;
  const reach = el.size / 2 + tolerance;
  if (n === 1) return Math.hypot(lx - pts[0], ly - pts[1]) <= reach;
  for (let i = 0; i < n - 1; i++) {
    if (distToSegment(lx, ly, pts[i * 3], pts[i * 3 + 1], pts[(i + 1) * 3], pts[(i + 1) * 3 + 1]) <= reach) {
      return true;
    }
  }
  return false;
}

function hitsShape(el: ShapeElement, lx: number, ly: number, tolerance: number): boolean {
  if (el.shape === 'line' || el.shape === 'arrow') {
    const [ax, ay, bx, by] = el.pts ?? [0, 0, el.w, el.h];
    return distToSegment(lx, ly, ax, ay, bx, by) <= el.strokeWidth / 2 + tolerance + 3;
  }
  const ctx = probeCtx();
  const path = buildShapePath(el);
  if (el.fill !== 'transparent' && ctx.isPointInPath(path, lx, ly)) return true;
  if (el.text && lx >= 0 && ly >= 0 && lx <= el.w && ly <= el.h) return true;
  ctx.lineWidth = el.strokeWidth + tolerance * 2 + 6;
  return ctx.isPointInStroke(path, lx, ly);
}

/** Élément le plus en avant sous le curseur. */
export function pickTopmost(sorted: AnyElement[], wx: number, wy: number, tolerance: number): AnyElement | null {
  for (let i = sorted.length - 1; i >= 0; i--) {
    const el = sorted[i];
    if (el.locked) continue;
    if (hitsElement(el, wx, wy, tolerance)) return el;
  }
  return null;
}

/** Sélection rectangulaire. `strict` exige que l'élément soit entièrement contenu. */
export function elementsInRect(sorted: AnyElement[], rect: Rect, strict: boolean): AnyElement[] {
  const out: AnyElement[] = [];
  for (const el of sorted) {
    if (el.locked) continue;
    const b = elementBounds(el);
    if (strict ? rectContainsRect(rect, b) : rectsIntersect(rect, b)) out.push(el);
  }
  return out;
}

/** Sélection au lasso : un élément est pris si son centre ou une extrémité tombe dans le polygone. */
export function elementsInLasso(sorted: AnyElement[], poly: number[]): AnyElement[] {
  const pb = polygonBounds(poly);
  const out: AnyElement[] = [];
  for (const el of sorted) {
    if (el.locked) continue;
    const b = elementBounds(el);
    if (!rectsIntersect(pb, b)) continue;
    if (pointInPolygon(poly, b.x + b.w / 2, b.y + b.h / 2)) {
      out.push(el);
      continue;
    }
    const corners = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ];
    if (corners.every(([x, y]) => pointInPolygon(poly, x, y))) out.push(el);
  }
  return out;
}

/**
 * Le segment de gomme traverse-t-il l'élément ?
 * Utilisé par la gomme « au trait », qui efface un tracé entier d'un geste.
 */
export function segmentHitsElement(
  el: AnyElement,
  ax: number, ay: number, bx: number, by: number,
  radius: number,
): boolean {
  const b = elementBounds(el);
  const seg: Rect = {
    x: Math.min(ax, bx) - radius,
    y: Math.min(ay, by) - radius,
    w: Math.abs(bx - ax) + radius * 2,
    h: Math.abs(by - ay) + radius * 2,
  };
  if (!rectsIntersect(seg, b)) return false;

  // Échantillonnage le long du segment : suffisant et bien plus simple qu'une
  // intersection exacte contre chaque primitive.
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len / Math.max(2, radius * 0.6)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (hitsElement(el, ax + (bx - ax) * t, ay + (by - ay) * t, radius)) return true;
  }
  return false;
}

/** Intersection segment/segment en coordonnées locales d'un trait, pour la découpe fine. */
export function strokeSegmentCrossings(
  el: StrokeElement,
  ax: number, ay: number, bx: number, by: number,
): number[] {
  const hits: number[] = [];
  const pts = el.points;
  const n = pts.length / 3;
  for (let i = 0; i < n - 1; i++) {
    if (segmentsIntersect(ax, ay, bx, by, pts[i * 3], pts[i * 3 + 1], pts[(i + 1) * 3], pts[(i + 1) * 3 + 1])) {
      hits.push(i);
    }
  }
  return hits;
}
