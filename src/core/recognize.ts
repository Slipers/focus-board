import type { ShapeKind, StrokeElement } from './types';
import { simplifyStroke } from './freehand';

export interface Recognition {
  shape: ShapeKind;
  /** Boîte englobante monde de la forme reconnue. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pour line/arrow : extrémités en coordonnées locales de la boîte. */
  pts?: number[];
}

/**
 * Reconnaissance de forme à main levée.
 *
 * Volontairement conservatrice : mieux vaut laisser le trait tel quel que de
 * transformer un croquis en rectangle contre l'intention de l'utilisateur.
 * Renvoie null si aucune forme ne ressort nettement.
 */
export function recognizeShape(el: StrokeElement): Recognition | null {
  const n = el.points.length / 3;
  if (n < 6) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(el.points[i * 3] + el.x);
    ys.push(el.points[i * 3 + 1] + el.y);
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.hypot(w, h);
  if (diag < 30) return null;

  let perimeter = 0;
  for (let i = 1; i < n; i++) perimeter += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  if (perimeter < 50) return null;

  const gap = Math.hypot(xs[n - 1] - xs[0], ys[n - 1] - ys[0]);
  // Un tracé qui ne se referme pas franchement n'est probablement pas voulu
  // comme une forme fermée — mieux vaut le laisser tel quel.
  const closed = gap < diag * 0.2;

  /* --- tracé ouvert : droite ? --- */
  if (!closed) {
    const straightness = Math.hypot(xs[n - 1] - xs[0], ys[n - 1] - ys[0]) / perimeter;
    if (straightness > 0.94) {
      const bx = Math.min(xs[0], xs[n - 1]);
      const by = Math.min(ys[0], ys[n - 1]);
      return {
        shape: 'line',
        x: bx,
        y: by,
        w: Math.max(Math.abs(xs[n - 1] - xs[0]), 1),
        h: Math.max(Math.abs(ys[n - 1] - ys[0]), 1),
        pts: [xs[0] - bx, ys[0] - by, xs[n - 1] - bx, ys[n - 1] - by],
      };
    }
    return null;
  }

  /* --- sommets et taux de remplissage, communs aux deux tests --- */
  const flat: number[] = [];
  for (let i = 0; i < n; i++) flat.push(xs[i], ys[i], 1);
  const simplified = simplifyStroke(flat, perimeter * 0.035);
  const corners: Array<[number, number]> = [];
  for (let i = 0; i < simplified.length; i += 3) corners.push([simplified[i], simplified[i + 1]]);
  // Le point de fermeture double le premier sommet.
  if (corners.length > 1) {
    const [fx, fy] = corners[0];
    const [lx, ly] = corners[corners.length - 1];
    if (Math.hypot(lx - fx, ly - fy) < diag * 0.2) corners.pop();
  }

  const outline: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) outline.push([xs[i], ys[i]]);
  const fill = polygonArea(outline) / (w * h || 1);

  /* --- tracé fermé : ellipse ? --- */
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = w / 2 || 1;
  const ry = h / 2 || 1;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    // Rayon normalisé : 1 exactement sur une ellipse parfaite inscrite dans la boîte.
    const r = Math.hypot((xs[i] - cx) / rx, (ys[i] - cy) / ry);
    sum += r;
    sumSq += r * r;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const cv = Math.sqrt(Math.max(0, variance)) / (mean || 1);
  // Le seul critère du rayon confond un carré avec un cercle (rayon normalisé
  // 1 au milieu des côtés, 1,41 aux coins) : l'aire relative les sépare
  // nettement — π/4 ≈ 0,79 pour un disque contre ~1 pour un rectangle.
  // Les seuils sont volontairement stricts : un griffonnage fermé mais
  // irrégulier (contour non circulaire) ne doit jamais passer pour un cercle.
  if (cv < 0.08 && mean > 0.9 && mean < 1.08 && fill < 0.86 && fill > 0.7) {
    return { shape: 'ellipse', x: minX, y: minY, w, h };
  }

  // Un triangle exige en plus une forme réellement pleine : trois sommets
  // après simplification peuvent aussi sortir d'un griffonnage étroit et tordu.
  const triangleFill = polygonArea(corners) / (w * h || 1);
  if (corners.length === 3 && triangleFill > 0.32 && triangleFill < 0.62) {
    return { shape: 'triangle', x: minX, y: minY, w, h };
  }
  if (corners.length === 4) {
    // Un quadrilatère dont les sommets tombent près des milieux des côtés est un losange.
    const nearMid = corners.filter(([px, py]) => {
      const dxMid = Math.abs(px - cx) < w * 0.14;
      const dyMid = Math.abs(py - cy) < h * 0.14;
      return dxMid || dyMid;
    }).length;
    if (nearMid >= 3 && fill > 0.35 && fill < 0.68) return { shape: 'diamond', x: minX, y: minY, w, h };
    if (fill > 0.8) return { shape: 'rect', x: minX, y: minY, w, h };
  }
  if (corners.length === 5 && fill > 0.85) {
    return { shape: 'rect', x: minX, y: minY, w, h };
  }

  return null;
}

function polygonArea(pts: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return Math.abs(area / 2);
}
