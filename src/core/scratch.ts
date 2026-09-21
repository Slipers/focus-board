import type { AnyElement } from './types';
import { elementBounds, inflate, localToWorld, rectContainsRect, type Rect } from './geom';
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
  /** Demi-tours francs (> 100°). */
  sharpTurns: number;
  /** Rotation cumulée du tracé, en radians. */
  turning: number;
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
    if (fromHorizontal <= 22 && chord * zoom >= 30) return { kind: 'strike', bounds, sharpTurns: 0, turning: 0 };
    return null;
  }

  /* --- gribouillis --- */
  // La forme du geste n'est ici qu'un premier filtre, volontairement large :
  // un vrai gribouillis humain est court, irrégulier, parfois bouclé. Ce qui
  // protège vraiment des faux positifs, c'est la vérification des cibles
  // (findScratchTargets) — un geste qui ne recouvre pas d'écriture reste un
  // trait, quelle que soit sa forme.
  const diag = Math.hypot(w, h);
  if (diag * zoom < 12) return null;
  // Un zigzag large aux allers-retours espacés — le geste naturel sur un long
  // mot — ne fait guère plus de 1,2 fois sa diagonale : ce seuil ne sert qu'à
  // écarter les traits quasi droits.
  const density = pathLen / diag;
  if (density < 1.1) return null;

  const minScreen = 10;
  const legsX = w * zoom >= minScreen ? countLegs(xs, w * 0.35) : 0;
  const legsY = h * zoom >= minScreen ? countLegs(ys, h * 0.35) : 0;
  const [legsLong, legsShort] = w >= h ? [legsX, legsY] : [legsY, legsX];
  const { sharpTurns, turning } = turnStats(xs, ys, Math.max(3 / zoom, Math.min(w, h) * 0.12));

  // Un simple aller-retour sur le mot suffit à dire « efface » ; en travers,
  // il faut monter et redescendre au moins deux fois.
  const zigzag = legsLong >= 2 || legsShort >= 4 || sharpTurns >= 3;
  const loops = turning >= 3 * Math.PI && density >= 1.6;
  return zigzag || loops ? { kind: 'zigzag', bounds, sharpTurns, turning } : null;
}

/**
 * Virages serrés (demi-tours de plus de 100°) et rotation cumulée du tracé,
 * mesurés sur un rééchantillonnage à pas constant : le bruit de la main,
 * plus fin que ce pas, n'ajoute pas de faux virages.
 */
function turnStats(xs: number[], ys: number[], step: number): { sharpTurns: number; turning: number } {
  const pts: Array<[number, number]> = [[xs[0], ys[0]]];
  let acc = 0;
  for (let i = 1; i < xs.length; i++) {
    acc += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    if (acc >= step) {
      pts.push([xs[i], ys[i]]);
      acc = 0;
    }
  }
  const heading = (a: [number, number], b: [number, number]) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const wrap = (a: number) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };

  let turning = 0;
  for (let i = 2; i < pts.length; i++) {
    turning += Math.abs(wrap(heading(pts[i - 1], pts[i]) - heading(pts[i - 2], pts[i - 1])));
  }

  let sharpTurns = 0;
  for (let i = 2; i < pts.length - 2; i++) {
    const turn = Math.abs(wrap(heading(pts[i], pts[i + 2]) - heading(pts[i - 2], pts[i])));
    if (turn > (100 * Math.PI) / 180) {
      sharpTurns++;
      i += 2; // un même sommet ne compte qu'une fois
    }
  }
  return { sharpTurns, turning };
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

const contains = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Contour de l'élément en repère local, sous forme de polylignes. */
function localOutline(el: AnyElement): Array<Array<[number, number]>> {
  const { w, h } = el;
  if (el.type === 'stroke') {
    const line: Array<[number, number]> = [];
    for (let i = 0; i < el.points.length; i += 3) line.push([el.points[i], el.points[i + 1]]);
    return [line];
  }
  if (el.type === 'shape') {
    switch (el.shape) {
      case 'line':
      case 'arrow': {
        const [ax, ay, bx, by] = el.pts ?? [0, 0, w, h];
        return [[[ax, ay], [bx, by]]];
      }
      case 'rect':
        return [[[0, 0], [w, 0], [w, h], [0, h], [0, 0]]];
      case 'diamond':
        return [[[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2], [w / 2, 0]]];
      case 'triangle':
        return [[[w / 2, 0], [w, h], [0, h], [w / 2, 0]]];
      default: {
        const ring: Array<[number, number]> = [];
        for (let i = 0; i <= 32; i++) {
          const a = (i / 32) * Math.PI * 2;
          ring.push([w / 2 + Math.cos(a) * (w / 2), h / 2 + Math.sin(a) * (h / 2)]);
        }
        return [ring];
      }
    }
  }
  return [];
}

/**
 * Part de l'encre de l'élément (en longueur) qui se trouve dans `zone`.
 * Un texte n'a pas de tracé : on prend la part de sa boîte d'encre recouverte.
 */
function inkInside(el: AnyElement, zone: Rect, zoom: number): number {
  if (el.type === 'text' || el.type === 'note' || el.type === 'image') {
    const b = inkBounds(el);
    const w = Math.min(zone.x + zone.w, b.x + b.w) - Math.max(zone.x, b.x);
    const h = Math.min(zone.y + zone.h, b.y + b.h) - Math.max(zone.y, b.y);
    return w > 0 && h > 0 ? (w * h) / Math.max(1e-6, b.w * b.h) : 0;
  }
  const step = 2 / zoom;
  const toWorld = (lx: number, ly: number) => (el.angle ? localToWorld(el, lx, ly) : { x: lx + el.x, y: ly + el.y });
  let total = 0;
  let covered = 0;
  for (const line of localOutline(el)) {
    if (line.length === 1) {
      const p = toWorld(line[0][0], line[0][1]);
      total += 1;
      if (contains(zone, p.x, p.y)) covered += 1;
      continue;
    }
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      const len = Math.hypot(bx - ax, by - ay);
      const k = Math.min(64, Math.max(1, Math.ceil(len / step)));
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k;
        const p = toWorld(ax + (bx - ax) * t, ay + (by - ay) * t);
        total += len / k;
        if (contains(zone, p.x, p.y)) covered += len / k;
      }
    }
  }
  return total > 0 ? covered / total : 0;
}

/** Part du geste (en longueur) qui passe à l'intérieur de `r`. */
function gestureFractionInside(world: number[], r: Rect): number {
  let total = 0;
  let inside = 0;
  for (let i = 3; i < world.length; i += 3) {
    const len = Math.hypot(world[i] - world[i - 3], world[i + 1] - world[i - 2]);
    total += len;
    if (contains(r, (world[i] + world[i - 3]) / 2, (world[i + 1] + world[i - 2]) / 2)) inside += len;
  }
  return total > 0 ? inside / total : 0;
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
  const radius = gestureSize / 2 + 3 / zoom;
  const targets: AnyElement[] = [];

  if (gesture.kind === 'zigzag') {
    const zone = inflate(gesture.bounds, Math.max(gestureSize, 4 / zoom));
    const longIsX = gesture.bounds.w >= gesture.bounds.h;
    const [zls, zle, zss, zse] = longIsX
      ? [zone.x, zone.x + zone.w, zone.y, zone.y + zone.h]
      : [zone.y, zone.y + zone.h, zone.x, zone.x + zone.w];
    const zoneShort = zse - zss;

    for (const el of elements) {
      if (el.locked) continue;
      if (el.type !== 'stroke' && el.type !== 'text' && el.type !== 'shape') continue;
      const b = inkBounds(el);
      // Comparaison de bornes plutôt que d'aires : une barre verticale a une
      // boîte de largeur nulle, donc une aire d'intersection toujours nulle.
      if (b.x > zone.x + zone.w || b.x + b.w < zone.x || b.y > zone.y + zone.h || b.y + b.h < zone.y) continue;

      // Premier critère : l'encre de l'élément est sous le gribouillis.
      // Colorier l'intérieur d'un contour laisse le contour dehors ; gribouiller
      // un mot, même écrit d'un seul trait, en recouvre l'essentiel.
      const inside = inkInside(el, zone, zoom);

      // Un point ou un accent entièrement recouvert part même si le zigzag
      // passe à côté sans le toucher. Réservé aux vraies petites marques : une
      // lettre entière que le geste ne touche pas n'est pas raturée — elle est
      // peut-être simplement entourée.
      if (inside >= 0.9 && Math.max(b.w, b.h) <= zoneShort * 0.2) {
        targets.push(el);
        continue;
      }
      if (!gestureTouches(el, world, radius)) continue;
      if (inside >= 0.5) {
        targets.push(el);
        continue;
      }

      // Une lettre haute (l, d, t) dont le gribouillis ne couvre que le milieu :
      // son encre dépasse en haut et en bas, mais le geste la traverse en
      // plein centre. Réservé aux éléments étroits devant le gribouillis — un
      // grand contour traversé n'est pas une lettre.
      const [els, ele, ess, ese] = longIsX ? [b.x, b.x + b.w, b.y, b.y + b.h] : [b.y, b.y + b.h, b.x, b.x + b.w];
      const narrow = ele - els <= (zle - zls) * 0.5;
      const along = (Math.min(zle, ele) - Math.max(zls, els)) / Math.max(1e-6, ele - els);
      const middle = zse >= ess + (ese - ess) * 0.3 && zss <= ess + (ese - ess) * 0.7;
      if (narrow && along >= 0.6 && middle) targets.push(el);
    }

    // Second critère : le gribouillis est sur ce qu'il efface. Entourer un mot
    // fait tourner le geste autour de lui, pas dessus — et un contour frôlé au
    // passage ne doit pas suffire à déclencher l'effacement.
    if (targets.length) {
      const u = unionOf(targets.map(inkBounds));
      // La marge suit aussi la grande dimension : une barre verticale seule a
      // une largeur nulle, et le gribouillis qui la raye déborde forcément.
      const pad = Math.max(Math.min(u.w, u.h) * 0.3, Math.min(Math.max(u.w, u.h) * 0.25, 12 / zoom), 6 / zoom);
      const onTarget = gestureFractionInside(world, inflate(u, pad));
      if (onTarget < 0.5) return [];

      // Entourer un mot de près : une ou deux boucles lisses qui le dépassent
      // de tous les côtés. Un cercle serré frôle les hampes et ressemble alors
      // géométriquement à un gribouillis bouclé ; ce qui le trahit, c'est qu'il
      // encadre l'écriture au lieu de la recouvrir.
      // Marge rapportée à la petite dimension : autour d'un long mot, un cercle
      // le serre de près sur les côtés, loin d'un pourcentage de sa largeur.
      const g = gesture.bounds;
      const m = Math.min(u.w, u.h) * 0.08;
      const encloses = g.x < u.x - m && g.x + g.w > u.x + u.w + m && g.y < u.y - m && g.y + g.h > u.y + u.h + m;
      const smoothLoop = gesture.turning >= 1.5 * Math.PI && gesture.turning <= 4.6 * Math.PI && gesture.sharpTurns <= 1;
      if (encloses && smoothLoop) return [];
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
