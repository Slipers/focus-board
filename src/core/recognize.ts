import type { ShapeKind, StrokeElement } from './types';
import { mixTuning } from './sensitivity';
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

interface ShapeTuning {
  /** Dimensions minimales du tracé, en px monde. */
  minDiag: number;
  minPerimeter: number;
  /** Écart entre les deux bouts, en part de la diagonale, pour dire « fermé ». */
  closure: number;
  /** Rectitude (corde / longueur) exigée pour une droite. */
  straight: number;
  /** Irrégularité du rayon tolérée pour une ellipse. */
  cv: number;
  /** Fenêtre du rayon normalisé moyen (1 = ellipse inscrite parfaite). */
  meanLow: number;
  meanHigh: number;
  /** Fenêtre du taux de remplissage de la boîte, par forme. */
  ellipseFillLow: number;
  ellipseFillHigh: number;
  triangleFillLow: number;
  triangleFillHigh: number;
  diamondFillLow: number;
  diamondFillHigh: number;
  /** Tolérance pour juger un sommet « au milieu d'un côté » (losange). */
  midTolerance: number;
  /** Remplissage minimal d'un rectangle, à 4 puis 5 sommets. */
  rectFill: number;
  rectFill5: number;
}

/** Curseur à 0 : seul un tracé déjà net devient une forme. */
const STRICT: ShapeTuning = {
  minDiag: 42,
  minPerimeter: 72,
  closure: 0.13,
  straight: 0.97,
  cv: 0.055,
  meanLow: 0.93,
  meanHigh: 1.05,
  ellipseFillLow: 0.73,
  ellipseFillHigh: 0.83,
  triangleFillLow: 0.37,
  triangleFillHigh: 0.57,
  diamondFillLow: 0.4,
  diamondFillHigh: 0.63,
  midTolerance: 0.1,
  rectFill: 0.86,
  rectFill5: 0.9,
};

/** Curseur à 0,5 : le réglage mesuré par défaut. */
const BALANCED: ShapeTuning = {
  minDiag: 30,
  minPerimeter: 50,
  closure: 0.2,
  straight: 0.94,
  cv: 0.08,
  meanLow: 0.9,
  meanHigh: 1.08,
  ellipseFillLow: 0.7,
  ellipseFillHigh: 0.86,
  triangleFillLow: 0.32,
  triangleFillHigh: 0.62,
  diamondFillLow: 0.35,
  diamondFillHigh: 0.68,
  midTolerance: 0.14,
  rectFill: 0.8,
  rectFill5: 0.85,
};

/** Curseur à 1 : un croquis approximatif est redressé. */
const LOOSE: ShapeTuning = {
  minDiag: 17,
  minPerimeter: 30,
  closure: 0.36,
  straight: 0.87,
  // L'irrégularité du rayon est ce qui sépare vraiment un cercle d'un
  // quadrilatère : un cercle tremblé reste sous 0,05, un rectangle bancal
  // monte à 0,12. Comme le test de l'ellipse passe avant celui du rectangle,
  // trop élargir ici transformerait les rectangles en cercles.
  cv: 0.105,
  meanLow: 0.86,
  meanHigh: 1.1,
  ellipseFillLow: 0.64,
  ellipseFillHigh: 0.92,
  triangleFillLow: 0.26,
  triangleFillHigh: 0.68,
  diamondFillLow: 0.29,
  diamondFillHigh: 0.74,
  midTolerance: 0.2,
  rectFill: 0.7,
  rectFill5: 0.76,
};

export const shapeTuning = (sensitivity: number): ShapeTuning =>
  mixTuning(sensitivity, STRICT, BALANCED, LOOSE);

/**
 * Reconnaissance de forme à main levée.
 *
 * Conservatrice par défaut : mieux vaut laisser le trait tel quel que de
 * transformer un croquis en rectangle contre l'intention de l'utilisateur.
 * `sensitivity` (0..1) déplace tous les seuils d'un bloc, de « seules les
 * formes déjà nettes » à « redresse même un croquis grossier ».
 * Renvoie null si aucune forme ne ressort nettement.
 */
export function recognizeShape(el: StrokeElement, sensitivity = 0.5): Recognition | null {
  const t = shapeTuning(sensitivity);
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
  if (diag < t.minDiag) return null;

  let perimeter = 0;
  for (let i = 1; i < n; i++) perimeter += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  if (perimeter < t.minPerimeter) return null;

  const gap = Math.hypot(xs[n - 1] - xs[0], ys[n - 1] - ys[0]);
  // Un tracé qui ne se referme pas franchement n'est probablement pas voulu
  // comme une forme fermée — mieux vaut le laisser tel quel.
  const closed = gap < diag * t.closure;

  /* --- tracé ouvert : droite ? --- */
  if (!closed) {
    const straightness = Math.hypot(xs[n - 1] - xs[0], ys[n - 1] - ys[0]) / perimeter;
    if (straightness > t.straight) {
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
    if (Math.hypot(lx - fx, ly - fy) < diag * t.closure) corners.pop();
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
  // Les seuils sont exigeants au milieu du curseur : un griffonnage fermé mais
  // irrégulier (contour non circulaire) ne doit pas passer pour un cercle.
  if (cv < t.cv && mean > t.meanLow && mean < t.meanHigh && fill < t.ellipseFillHigh && fill > t.ellipseFillLow) {
    return { shape: 'ellipse', x: minX, y: minY, w, h };
  }

  // Un triangle exige en plus une forme réellement pleine : trois sommets
  // après simplification peuvent aussi sortir d'un griffonnage étroit et tordu.
  const triangleFill = polygonArea(corners) / (w * h || 1);
  if (corners.length === 3 && triangleFill > t.triangleFillLow && triangleFill < t.triangleFillHigh) {
    return { shape: 'triangle', x: minX, y: minY, w, h };
  }
  if (corners.length === 4) {
    // Un quadrilatère dont les sommets tombent près des milieux des côtés est un losange.
    const nearMid = corners.filter(([px, py]) => {
      const dxMid = Math.abs(px - cx) < w * t.midTolerance;
      const dyMid = Math.abs(py - cy) < h * t.midTolerance;
      return dxMid || dyMid;
    }).length;
    if (nearMid >= 3 && fill > t.diamondFillLow && fill < t.diamondFillHigh) {
      return { shape: 'diamond', x: minX, y: minY, w, h };
    }
    if (fill > t.rectFill) return { shape: 'rect', x: minX, y: minY, w, h };
  }
  if (corners.length === 5 && fill > t.rectFill5) {
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
