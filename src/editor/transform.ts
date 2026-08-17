import type { AnyElement, ID, ShapeElement, StrokeElement, TextElement } from '../core/types';
import type { BoardStore } from '../core/store';
import type { Frame, HandleId } from '../render/overlay';
import { elementBounds, snapAngle, type Rect } from '../core/geom';
import { scaleStrokePoints } from '../core/factory';
import type { SnapGuide } from '../render/overlay';

export interface TransformSession {
  kind: 'move' | 'resize' | 'rotate';
  handle: HandleId | null;
  frame: Frame;
  originals: Map<ID, AnyElement>;
  startX: number;
  startY: number;
}

const MIN_SIZE = 2;

function toFrameLocal(f: Frame, x: number, y: number) {
  const c = Math.cos(-f.angle);
  const s = Math.sin(-f.angle);
  const dx = x - f.cx;
  const dy = y - f.cy;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

function toWorld(f: Frame, lx: number, ly: number) {
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  return { x: f.cx + lx * c - ly * s, y: f.cy + lx * s + ly * c };
}

/* ------------------------------------------------------------ déplacer */

export function applyMove(store: BoardStore, session: TransformSession, dx: number, dy: number) {
  for (const [id, orig] of session.originals) {
    store.update(id, { x: orig.x + dx, y: orig.y + dy });
  }
}

/* -------------------------------------------------------- redimension */

const AXIS: Record<string, { x: boolean; y: boolean }> = {
  nw: { x: true, y: true },
  ne: { x: true, y: true },
  se: { x: true, y: true },
  sw: { x: true, y: true },
  n: { x: false, y: true },
  s: { x: false, y: true },
  e: { x: true, y: false },
  w: { x: true, y: false },
};

export function applyResize(
  store: BoardStore,
  session: TransformSession,
  worldX: number,
  worldY: number,
  opts: { keepAspect: boolean; fromCenter: boolean },
) {
  const f = session.frame;
  const handle = session.handle!;
  const axis = AXIS[handle];
  if (!axis) return;

  const p = toFrameLocal(f, worldX, worldY);
  const hw = f.w / 2;
  const hh = f.h / 2;

  const left = handle.includes('w');
  const right = handle.includes('e');
  const top = handle.includes('n');
  const bottom = handle.includes('s');

  let x0 = -hw;
  let x1 = hw;
  let y0 = -hh;
  let y1 = hh;

  if (axis.x) {
    if (left) x0 = Math.min(p.x, x1 - MIN_SIZE);
    if (right) x1 = Math.max(p.x, x0 + MIN_SIZE);
  }
  if (axis.y) {
    if (top) y0 = Math.min(p.y, y1 - MIN_SIZE);
    if (bottom) y1 = Math.max(p.y, y0 + MIN_SIZE);
  }

  if (opts.fromCenter) {
    if (axis.x) {
      const half = Math.max(MIN_SIZE / 2, Math.abs(p.x));
      x0 = -half;
      x1 = half;
    }
    if (axis.y) {
      const half = Math.max(MIN_SIZE / 2, Math.abs(p.y));
      y0 = -half;
      y1 = half;
    }
  }

  let sx = (x1 - x0) / f.w;
  let sy = (y1 - y0) / f.h;

  if (opts.keepAspect && axis.x && axis.y) {
    const s = Math.max(sx, sy);
    // On recale le bord mobile pour conserver le coin opposé fixe.
    if (left) x0 = x1 - f.w * s;
    else x1 = x0 + f.w * s;
    if (top) y0 = y1 - f.h * s;
    else y1 = y0 + f.h * s;
    sx = s;
    sy = s;
  }

  const newCenterLocal = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };

  for (const [id, orig] of session.originals) {
    // Le centre de l'élément est exprimé dans le repère du cadre (origine =
    // ancien centre), mis à l'échelle, puis recalé sur le nouveau centre.
    const oc = toFrameLocal(f, orig.x + orig.w / 2, orig.y + orig.h / 2);
    const moved = toWorld(f, oc.x * sx + newCenterLocal.x, oc.y * sy + newCenterLocal.y);
    const cx = moved.x;
    const cy = moved.y;

    const w = Math.max(MIN_SIZE, orig.w * sx);
    const h = Math.max(MIN_SIZE, orig.h * sy);
    const patch: Partial<AnyElement> = { x: cx - w / 2, y: cy - h / 2, w, h };

    if (orig.type === 'stroke') {
      (patch as Partial<StrokeElement>).points = scaleStrokePoints(orig as StrokeElement, sx, sy);
      (patch as Partial<StrokeElement>).size = Math.max(0.5, (orig as StrokeElement).size * Math.sqrt(Math.abs(sx * sy)));
    } else if (orig.type === 'shape' && (orig as ShapeElement).pts) {
      const pts = (orig as ShapeElement).pts!;
      (patch as Partial<ShapeElement>).pts = [pts[0] * sx, pts[1] * sy, pts[2] * sx, pts[3] * sy];
    } else if (orig.type === 'text') {
      const t = orig as TextElement;
      const uniform = Math.abs(sx - sy) < 0.001;
      if (uniform) (patch as Partial<TextElement>).fontSize = Math.max(6, t.fontSize * sx);
      else patch.h = orig.h; // redimension horizontale : le texte se recompose, la hauteur suit
    }

    store.update(id, patch);
  }
}

/* ------------------------------------------------------------- pivoter */

export function applyRotate(
  store: BoardStore,
  session: TransformSession,
  worldX: number,
  worldY: number,
  snap: boolean,
) {
  const f = session.frame;
  const start = Math.atan2(session.startY - f.cy, session.startX - f.cx);
  let delta = Math.atan2(worldY - f.cy, worldX - f.cx) - start;
  if (snap) delta = snapAngle(f.angle + delta) - f.angle;

  const c = Math.cos(delta);
  const s = Math.sin(delta);
  for (const [id, orig] of session.originals) {
    const ox = orig.x + orig.w / 2 - f.cx;
    const oy = orig.y + orig.h / 2 - f.cy;
    const nx = f.cx + ox * c - oy * s;
    const ny = f.cy + ox * s + oy * c;
    store.update(id, { x: nx - orig.w / 2, y: ny - orig.h / 2, angle: orig.angle + delta });
  }
}

/* ------------------------------------------------------------- magnétisme */

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/**
 * Aligne la boîte déplacée sur les bords et centres des autres éléments.
 * Le seuil est exprimé en px écran pour rester constant quel que soit le zoom.
 */
export function computeSnap(
  moving: Rect,
  others: AnyElement[],
  thresholdWorld: number,
): SnapResult {
  const targetsX: number[] = [];
  const targetsY: number[] = [];
  for (const el of others) {
    const b = elementBounds(el);
    targetsX.push(b.x, b.x + b.w / 2, b.x + b.w);
    targetsY.push(b.y, b.y + b.h / 2, b.y + b.h);
  }

  const sourcesX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const sourcesY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  let bestDx = 0;
  let bestDistX = thresholdWorld;
  let guideX: number | undefined;
  for (const s of sourcesX) {
    for (const t of targetsX) {
      const d = Math.abs(t - s);
      if (d < bestDistX) {
        bestDistX = d;
        bestDx = t - s;
        guideX = t;
      }
    }
  }

  let bestDy = 0;
  let bestDistY = thresholdWorld;
  let guideY: number | undefined;
  for (const s of sourcesY) {
    for (const t of targetsY) {
      const d = Math.abs(t - s);
      if (d < bestDistY) {
        bestDistY = d;
        bestDy = t - s;
        guideY = t;
      }
    }
  }

  const guides: SnapGuide[] = [];
  if (guideX !== undefined) guides.push({ x: guideX });
  if (guideY !== undefined) guides.push({ y: guideY });
  return { dx: bestDx, dy: bestDy, guides };
}
