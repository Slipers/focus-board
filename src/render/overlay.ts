import type { AnyElement, BrushKind, Camera, TabletSettings } from '../core/types';
import { BRUSHES, outlineOptionsFor } from '../core/brushes';
import { outlineToPath, strokeOutline } from '../core/freehand';
import { elementBounds, unionRects, worldToScreen } from '../core/geom';

export const ACCENT = '#4c8dff';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'pointA' | 'pointB';

export interface Frame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

export interface Handle {
  id: HandleId;
  x: number;
  y: number;
}

const HANDLE_HIT = 11;
const ROTATE_OFFSET = 26;

export function frameForSelection(elements: AnyElement[]): Frame | null {
  if (elements.length === 0) return null;
  if (elements.length === 1) {
    const el = elements[0];
    return { cx: el.x + el.w / 2, cy: el.y + el.h / 2, w: el.w, h: el.h, angle: el.angle };
  }
  const box = unionRects(elements.map(elementBounds));
  if (!box) return null;
  return { cx: box.x + box.w / 2, cy: box.y + box.h / 2, w: box.w, h: box.h, angle: 0 };
}

/** Point du repère du cadre (origine au centre) vers le monde. */
export function frameToWorld(f: Frame, lx: number, ly: number) {
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  return { x: f.cx + lx * c - ly * s, y: f.cy + lx * s + ly * c };
}

export function frameCorners(f: Frame) {
  return [
    frameToWorld(f, -f.w / 2, -f.h / 2),
    frameToWorld(f, f.w / 2, -f.h / 2),
    frameToWorld(f, f.w / 2, f.h / 2),
    frameToWorld(f, -f.w / 2, f.h / 2),
  ];
}

/** Le point tombe-t-il dans le cadre de sélection (rotation comprise) ? */
export function pointInFrame(f: Frame, wx: number, wy: number): boolean {
  const c = Math.cos(-f.angle);
  const s = Math.sin(-f.angle);
  const dx = wx - f.cx;
  const dy = wy - f.cy;
  return Math.abs(dx * c - dy * s) <= f.w / 2 && Math.abs(dx * s + dy * c) <= f.h / 2;
}

export function handlesFor(f: Frame, cam: Camera): Handle[] {
  const hw = f.w / 2;
  const hh = f.h / 2;
  const spec: Array<[HandleId, number, number]> = [
    ['nw', -hw, -hh],
    ['n', 0, -hh],
    ['ne', hw, -hh],
    ['e', hw, 0],
    ['se', hw, hh],
    ['s', 0, hh],
    ['sw', -hw, hh],
    ['w', -hw, 0],
  ];
  const out: Handle[] = spec.map(([id, lx, ly]) => {
    const p = frameToWorld(f, lx, ly);
    return { id, x: p.x, y: p.y };
  });
  const rot = frameToWorld(f, 0, -hh - ROTATE_OFFSET / cam.zoom);
  out.push({ id: 'rotate', x: rot.x, y: rot.y });
  return out;
}

export function hitHandle(handles: Handle[], cam: Camera, wx: number, wy: number): HandleId | null {
  const p = worldToScreen(cam, wx, wy);
  for (const h of handles) {
    const s = worldToScreen(cam, h.x, h.y);
    if (Math.hypot(s.x - p.x, s.y - p.y) <= HANDLE_HIT) return h.id;
  }
  return null;
}

export const CURSOR_FOR_HANDLE: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  rotate: 'grab',
  pointA: 'move',
  pointB: 'move',
};

/* ------------------------------------------------------------- dessin */

export interface LiveStroke {
  brush: BrushKind;
  color: string;
  size: number;
  /** Points monde à plat : [x, y, pression, …]. */
  points: number[];
}

export interface LaserPoint {
  x: number;
  y: number;
  t: number;
}

export interface SnapGuide {
  /** Ligne verticale (x) ou horizontale (y) en coordonnées monde. */
  x?: number;
  y?: number;
}

export interface OverlayState {
  cam: Camera;
  /** Dimensions du viewport en pixels CSS. */
  vw: number;
  vh: number;
  /** Rapport pixels physiques / pixels CSS de l'écran. */
  dpr: number;
  tablet: TabletSettings;
  selection: AnyElement[];
  frame: Frame | null;
  live: LiveStroke | null;
  lasso: number[] | null;
  marquee: { x: number; y: number; w: number; h: number } | null;
  guides: SnapGuide[];
  laser: LaserPoint[];
  /** Curseur circulaire (gomme, ou aperçu de la pointe en survol). */
  ring: { x: number; y: number; r: number; kind: 'eraser' | 'hover' } | null;
  paperDark: boolean;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, s: OverlayState) {
  const d = s.dpr;
  // Tout le reste de ce module raisonne en pixels CSS : la mise à l'échelle de
  // l'écran est absorbée une bonne fois ici.
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, s.vw, s.vh);

  ctx.save();
  const w = s.cam.zoom * d;
  ctx.setTransform(w, 0, 0, w, -s.cam.x * w, -s.cam.y * w);

  if (s.live) {
    const preset = BRUSHES[s.live.brush];
    const path = outlineToPath(
      strokeOutline(s.live.points, outlineOptionsFor(s.live.brush, s.live.size, s.tablet)),
    );
    ctx.globalAlpha = preset.alpha;
    if (preset.blend) ctx.globalCompositeOperation = s.paperDark ? 'lighten' : 'multiply';
    ctx.fillStyle = s.live.color;
    ctx.fill(path, 'nonzero');
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  drawLaser(ctx, s);
  drawGuides(ctx, s);
  drawSelectionFrame(ctx, s);
  drawMarquee(ctx, s);
  drawLasso(ctx, s);
  drawRing(ctx, s);
}

function drawSelectionFrame(ctx: CanvasRenderingContext2D, s: OverlayState) {
  if (!s.frame || s.selection.length === 0) return;
  const f = s.frame;

  // Contour léger sur chaque élément d'une sélection multiple.
  if (s.selection.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(76,141,255,0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const el of s.selection) {
      const b = elementBounds(el);
      const p0 = worldToScreen(s.cam, b.x, b.y);
      ctx.strokeRect(p0.x, p0.y, b.w * s.cam.zoom, b.h * s.cam.zoom);
    }
    ctx.restore();
  }

  const corners = frameCorners(f).map((p) => worldToScreen(s.cam, p.x, p.y));
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();

  const handles = handlesFor(f, s.cam);
  const rotate = handles.find((h) => h.id === 'rotate')!;
  const top = worldToScreen(s.cam, frameToWorld(f, 0, -f.h / 2).x, frameToWorld(f, 0, -f.h / 2).y);
  const rs = worldToScreen(s.cam, rotate.x, rotate.y);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(rs.x, rs.y);
  ctx.stroke();

  for (const h of handles) {
    const p = worldToScreen(s.cam, h.x, h.y);
    ctx.beginPath();
    if (h.id === 'rotate') {
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    } else {
      ctx.rect(p.x - 5, p.y - 5, 10, 10);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

function drawMarquee(ctx: CanvasRenderingContext2D, s: OverlayState) {
  if (!s.marquee) return;
  const p = worldToScreen(s.cam, s.marquee.x, s.marquee.y);
  ctx.save();
  ctx.fillStyle = 'rgba(76,141,255,0.12)';
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1;
  ctx.fillRect(p.x, p.y, s.marquee.w * s.cam.zoom, s.marquee.h * s.cam.zoom);
  ctx.strokeRect(p.x, p.y, s.marquee.w * s.cam.zoom, s.marquee.h * s.cam.zoom);
  ctx.restore();
}

function drawLasso(ctx: CanvasRenderingContext2D, s: OverlayState) {
  if (!s.lasso || s.lasso.length < 4) return;
  ctx.save();
  ctx.beginPath();
  const first = worldToScreen(s.cam, s.lasso[0], s.lasso[1]);
  ctx.moveTo(first.x, first.y);
  for (let i = 2; i < s.lasso.length; i += 2) {
    const p = worldToScreen(s.cam, s.lasso[i], s.lasso[i + 1]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(76,141,255,0.10)';
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.restore();
}

function drawGuides(ctx: CanvasRenderingContext2D, s: OverlayState) {
  if (!s.guides.length) return;
  ctx.save();
  ctx.strokeStyle = '#ff4d8d';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  for (const g of s.guides) {
    if (g.x !== undefined) {
      const p = worldToScreen(s.cam, g.x, 0);
      ctx.moveTo(Math.round(p.x) + 0.5, 0);
      ctx.lineTo(Math.round(p.x) + 0.5, s.vh);
    }
    if (g.y !== undefined) {
      const p = worldToScreen(s.cam, 0, g.y);
      ctx.moveTo(0, Math.round(p.y) + 0.5);
      ctx.lineTo(s.vw, Math.round(p.y) + 0.5);
    }
  }
  ctx.stroke();
  ctx.restore();
}

const LASER_LIFETIME = 900;

function drawLaser(ctx: CanvasRenderingContext2D, s: OverlayState) {
  if (s.laser.length < 2) return;
  const now = performance.now();
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < s.laser.length; i++) {
    const a = s.laser[i - 1];
    const b = s.laser[i];
    const age = (now - b.t) / LASER_LIFETIME;
    if (age >= 1) continue;
    const alpha = Math.pow(1 - age, 1.6);
    const pa = worldToScreen(s.cam, a.x, a.y);
    const pb = worldToScreen(s.cam, b.x, b.y);
    ctx.strokeStyle = `rgba(255, 62, 92, ${alpha * 0.9})`;
    ctx.lineWidth = 5;
    ctx.shadowColor = `rgba(255, 62, 92, ${alpha})`;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRing(ctx: CanvasRenderingContext2D, s: OverlayState) {
  if (!s.ring) return;
  const p = worldToScreen(s.cam, s.ring.x, s.ring.y);
  const r = Math.max(4, s.ring.r * s.cam.zoom);
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  if (s.ring.kind === 'eraser') {
    ctx.fillStyle = s.paperDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
    ctx.fill();
    ctx.strokeStyle = s.paperDark ? 'rgba(255,255,255,0.75)' : 'rgba(30,30,35,0.65)';
    ctx.lineWidth = 1.5;
  } else {
    ctx.strokeStyle = s.paperDark ? 'rgba(255,255,255,0.55)' : 'rgba(20,20,25,0.45)';
    ctx.lineWidth = 1;
  }
  ctx.stroke();
  ctx.restore();
}

export function pruneLaser(points: LaserPoint[]): LaserPoint[] {
  const now = performance.now();
  return points.filter((p) => now - p.t < LASER_LIFETIME);
}
