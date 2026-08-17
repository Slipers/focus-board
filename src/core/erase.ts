import type { StrokeElement } from './types';
import { worldToLocal } from './geom';

/**
 * Gomme ponctuelle : retire du tracé la portion couverte par le disque de la
 * gomme et renvoie les morceaux restants (coordonnées locales, à plat).
 *
 * - `null` : le trait n'est pas touché, il faut le laisser tel quel.
 * - `[]`   : tout le trait a été effacé.
 *
 * Les tracés sont simplifiés à l'enregistrement : une longue ligne droite ne
 * compte que deux points. Se contenter de filtrer les sommets ne couperait
 * donc rien au milieu — on densifie les segments au pas de la gomme avant de
 * décider.
 */
export function eraseFromStroke(
  el: StrokeElement,
  worldX: number,
  worldY: number,
  radius: number,
): number[][] | null {
  const c = worldToLocal(el, worldX, worldY);
  const reach = radius + el.size / 2;
  const reach2 = reach * reach;
  const pts = el.points;
  const n = pts.length / 3;
  if (n === 0) return null;

  const step = Math.max(1, reach / 3);
  const runs: number[][] = [];
  let current: number[] = [];
  let touched = false;

  const consider = (x: number, y: number, p: number) => {
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy <= reach2) {
      touched = true;
      if (current.length >= 6) runs.push(current);
      current = [];
    } else {
      current.push(x, y, p);
    }
  };

  consider(pts[0], pts[1], pts[2]);
  for (let i = 1; i < n; i++) {
    const x0 = pts[(i - 1) * 3];
    const y0 = pts[(i - 1) * 3 + 1];
    const p0 = pts[(i - 1) * 3 + 2];
    const x1 = pts[i * 3];
    const y1 = pts[i * 3 + 1];
    const p1 = pts[i * 3 + 2];

    const len = Math.hypot(x1 - x0, y1 - y0);
    const sub = Math.min(96, Math.floor(len / step));
    for (let k = 1; k <= sub; k++) {
      const t = k / (sub + 1);
      consider(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t);
    }
    consider(x1, y1, p1);
  }
  if (current.length >= 6) runs.push(current);

  if (!touched) return null;
  return runs;
}
