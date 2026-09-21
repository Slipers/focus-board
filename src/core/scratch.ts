import type { AnyElement } from './types';
import { elementBounds, inflate, rectContainsRect, type Rect } from './geom';
import { segmentHitsElement } from './hit';
import { layoutText } from './text';

/**
 * Effacer en raturant, comme le « scratch to delete » de l'Apple Pencil.
 *
 * Deux gestes sont reconnus :
 *  - le gribouillis : un zigzag qui repasse plusieurs fois sur la même zone ;
 *  - la rature : une ligne droite quasi horizontale tracée au milieu d'un mot.
 *
 * L'ambiguïté est inhérente — un zigzag peut aussi être un dessin, une ligne
 * un trait de liaison — donc la reconnaissance est volontairement exigeante,
 * et un geste qui ne recouvre rien reste toujours un trait normal.
 */

export type ScratchKind = 'zigzag' | 'strike';

export interface ScratchGesture {
  kind: ScratchKind;
  bounds: Rect;
}

/**
 * Nombre d'allers-retours le long d'un axe, avec hystérésis : un changement de
 * sens ne compte que si le stylet repart d'au moins `threshold` dans l'autre
 * direction. Le tremblement de la main ne crée donc pas de faux allers-retours.
 */
export function countLegs(values: number[], threshold: number): number {
  if (values.length < 2 || threshold <= 0) return 0;
  let dir = 0;
  let turn = values[0];
  let ext = values[0];
  let legs = 0;
  for (const v of values) {
    if (dir === 0) {
      if (v - turn >= threshold) {
        dir = 1;
        ext = v;
      } else if (turn - v >= threshold) {
        dir = -1;
        ext = v;
      }
    } else if (dir === 1) {
      if (v > ext) ext = v;
      else if (ext - v >= threshold) {
        legs++;
        turn = ext;
        dir = -1;
        ext = v;
      }
    } else {
      if (v < ext) ext = v;
      else if (v - ext >= threshold) {
        legs++;
        turn = ext;
        dir = 1;
        ext = v;
      }
    }
  }
  if (dir !== 0) legs++;
  return legs;
}

/** Le tracé est-il un geste de rature ? `world` est à plat [x, y, p, …]. */
export function detectScratchGesture(world: number[], zoom: number): ScratchGesture | null {
  const n = world.length / 3;
  if (n < 6) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let pathLen = 0;
  for (let i = 0; i < n; i++) {
    const x = world[i * 3];
    const y = world[i * 3 + 1];
    xs.push(x);
    ys.push(y);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    if (i > 0) pathLen += Math.hypot(x - xs[i - 1], y - ys[i - 1]);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const bounds: Rect = { x: minX, y: minY, w, h };
  if (pathLen * zoom < 24) return null;

  /* --- rature : une ligne droite, quasi horizontale --- */
  const dx = xs[n - 1] - xs[0];
  const dy = ys[n - 1] - ys[0];
  const chord = Math.hypot(dx, dy);
  if (chord / pathLen >= 0.92) {
    const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    const fromHorizontal = Math.min(angle, 180 - angle);
    if (fromHorizontal <= 22 && chord * zoom >= 30) return { kind: 'strike', bounds };
    return null;
  }

  /* --- gribouillis : le stylet repasse plusieurs fois sur la même zone --- */
  const diag = Math.hypot(w, h);
  if (diag === 0 || pathLen / diag < 2.6) return null;

  // Les allers-retours peuvent suivre l'axe long (on balaie le mot de gauche à
  // droite et retour) ou l'axe court (on monte et descend en avançant). Le
  // second ressemble davantage à de l'écriture (« MMM »), il en exige plus.
  const minScreen = 14;
  const legsX = w * zoom >= minScreen ? countLegs(xs, w * 0.5) : 0;
  const legsY = h * zoom >= minScreen ? countLegs(ys, h * 0.5) : 0;
  const [legsLong, legsShort] = w >= h ? [legsX, legsY] : [legsY, legsX];
  if (legsLong >= 4 || legsShort >= 6) return { kind: 'zigzag', bounds };
  return null;
}

/**
 * Boîte de l'encre réellement visible. Pour un bloc de texte, la boîte de
 * l'élément est bien plus large que ses mots : raturer « bonjour » ne doit pas
 * exiger de traverser 320 px de vide.
 */
export function inkBounds(el: AnyElement): Rect {
  if (el.type === 'text' && !el.angle) {
    const layout = layoutText(el.text || ' ', el.font, el.fontSize, el.w);
    const offset = el.align === 'center' ? (el.w - layout.width) / 2 : el.align === 'right' ? el.w - layout.width : 0;
    return { x: el.x + offset, y: el.y, w: Math.max(1, layout.width), h: Math.max(1, layout.height) };
  }
  return elementBounds(el);
}

function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function unionOf(rects: Rect[]): Rect {
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

/** Le geste touche-t-il réellement l'élément, et pas seulement sa boîte ? */
function gestureTouches(el: AnyElement, world: number[], radius: number): boolean {
  for (let i = 3; i < world.length; i += 3) {
    if (segmentHitsElement(el, world[i - 3], world[i - 2], world[i], world[i + 1], radius)) return true;
  }
  return false;
}

/**
 * Éléments à effacer sous le geste. Tableau vide = le geste n'a rien raturé,
 * il faut le garder comme un trait ordinaire.
 */
export function findScratchTargets(
  gesture: ScratchGesture,
  world: number[],
  elements: AnyElement[],
  zoom: number,
  gestureSize: number,
): AnyElement[] {
  const radius = gestureSize / 2 + 2 / zoom;
  const targets: AnyElement[] = [];

  if (gesture.kind === 'zigzag') {
    const zone = inflate(gesture.bounds, gestureSize);
    const zoneArea = Math.max(1e-6, zone.w * zone.h);
    const longIsX = gesture.bounds.w >= gesture.bounds.h;
    for (const el of elements) {
      if (el.locked) continue;
      if (el.type !== 'stroke' && el.type !== 'text' && el.type !== 'shape') continue;
      const b = inkBounds(el);
      const area = Math.max(1e-6, b.w * b.h);
      const inter = intersectionArea(zone, b);

      // Le geste tient tout entier dans un contour nettement plus grand :
      // c'est qu'on colorie l'intérieur d'une forme, pas qu'on la rature.
      if (inter / zoneArea >= 0.8 && area >= zoneArea * 1.6) continue;

      // Recouvert presque entièrement : effacé même si le zigzag passe entre
      // les jambages sans les toucher.
      if (inter / area >= 0.9) {
        targets.push(el);
        continue;
      }
      if (!gestureTouches(el, world, radius)) continue;

      // Sinon, le zigzag doit balayer l'élément sur toute sa longueur en
      // passant par son milieu. On raye un mot en travers de ses lettres,
      // rarement sur toute leur hauteur : exiger une surface couverte
      // laisserait les lettres hautes (l, d, t) debout.
      const [gs, ge, es, ee] = longIsX
        ? [zone.x, zone.x + zone.w, b.x, b.x + b.w]
        : [zone.y, zone.y + zone.h, b.y, b.y + b.h];
      const [cs, ce, fs, fe] = longIsX
        ? [zone.y, zone.y + zone.h, b.y, b.y + b.h]
        : [zone.x, zone.x + zone.w, b.x, b.x + b.w];
      const along = (Math.min(ge, ee) - Math.max(gs, es)) / Math.max(1e-6, ee - es);
      const midLo = fs + (fe - fs) * 0.3;
      const midHi = fs + (fe - fs) * 0.7;
      if (along >= 0.7 && ce >= midLo && cs <= midHi) targets.push(el);
    }
  } else {
    const n = world.length / 3;
    let x0 = world[0];
    let y0 = world[1];
    let x1 = world[(n - 1) * 3];
    let y1 = world[(n - 1) * 3 + 1];
    if (x1 < x0) [x0, y0, x1, y1] = [x1, y1, x0, y0];
    const span = Math.max(1e-6, x1 - x0);
    for (const el of elements) {
      if (el.locked) continue;
      if (el.type !== 'stroke' && el.type !== 'text') continue;
      const b = inkBounds(el);
      // Une ligne à peine épaisse n'est pas un mot : tracer une parallèle
      // tout contre ne doit pas l'effacer.
      if (b.h * zoom < 8) continue;
      const overlap = Math.min(x1, b.x + b.w) - Math.max(x0, b.x);
      if (overlap / b.w < 0.7) continue;
      const cx = Math.min(x1, Math.max(x0, b.x + b.w / 2));
      const yLine = y0 + ((cx - x0) / span) * (y1 - y0);
      const rel = (yLine - b.y) / b.h;
      // Au milieu du mot, pas dessous (soulignement) ni dessus.
      if (rel < 0.2 || rel > 0.8) continue;
      if (el.type === 'stroke' && !gestureTouches(el, world, radius)) continue;
      targets.push(el);
    }
    // Un trait de liaison qui traverse une étiquette la dépasse largement ;
    // une rature, elle, s'arrête à peu près où s'arrête le mot.
    if (targets.length) {
      const u = unionOf(targets.map(inkBounds));
      if (x1 - x0 > u.w * 1.5 + 30 / zoom) return [];
    }
  }

  if (!targets.length) return targets;

  // Les points des i et les accents flottent au-dessus du mot sans être
  // traversés par le geste : ils partent avec lui.
  const u = unionOf(targets.map(inkBounds));
  // Marge horizontale : la boîte d'une barre verticale (l, i) est large de
  // zéro, alors que son point, lui, a une vraie largeur.
  const zone: Rect = { x: u.x - u.h * 0.3, y: u.y - u.h * 0.6, w: u.w + u.h * 0.6, h: u.h * 2.2 };
  const chosen = new Set(targets.map((t) => t.id));
  for (const el of elements) {
    if (el.locked || el.type !== 'stroke' || chosen.has(el.id)) continue;
    const b = inkBounds(el);
    if (Math.max(b.w, b.h) <= u.h * 0.45 && rectContainsRect(zone, b)) {
      targets.push(el);
      chosen.add(el.id);
    }
  }
  return targets;
}
