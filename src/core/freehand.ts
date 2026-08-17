/**
 * Génération du contour d'un trait à largeur variable.
 *
 * Le tracé est stocké comme une polyligne (x, y, pression). Au rendu on en
 * déduit un polygone plein : pour chaque point on décale de ±rayon le long de
 * la normale, on referme avec des bouchons arrondis, puis on adoucit le
 * contour. C'est ce qui donne l'attaque fine / le corps épais d'un vrai stylo
 * sur tablette, plutôt qu'un trait d'épaisseur constante.
 */

export interface OutlineOptions {
  /** Diamètre de référence, en px monde. */
  size: number;
  /** Part de la largeur pilotée par la pression (0 = largeur constante). */
  thinning: number;
  /** Largeur relative conservée à pression nulle (0..1). */
  minWidth: number;
  /** Gamma appliqué à la pression : <1 = plus réactif aux appuis légers. */
  curve: number;
  /** Longueur d'attaque effilée, en px monde. */
  taperStart: number;
  /** Longueur de sortie effilée, en px monde. */
  taperEnd: number;
  /** Irrégularité du bord (rendu crayon). */
  jitter: number;
}

export const DEFAULT_OUTLINE: OutlineOptions = {
  size: 6,
  thinning: 0.62,
  minWidth: 0.18,
  curve: 0.75,
  taperStart: 6,
  taperEnd: 12,
  jitter: 0,
};

/** Bruit déterministe : le même trait doit se redessiner à l'identique. */
function hashNoise(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

/**
 * Intensité à appliquer à chacun des deux étages du filtre temps réel pour
 * obtenir exactement le même retard qu'un étage unique réglé sur `streamline`.
 *
 * Un filtre exponentiel de coefficient α retarde le signal d'environ (1−α)/α
 * échantillons. En résolvant 2(1−α₂)/α₂ = streamline/(1−streamline) on obtient
 * α₂ = 2(1−s)/(2−s) : la cascade coupe le tremblement bien plus franchement
 * qu'un étage seul, sans que le trait traîne davantage derrière le stylet.
 */
export function cascadeAmount(streamline: number): number {
  const s = Math.min(0.92, Math.max(0, streamline));
  return 1 - (2 * (1 - s)) / (2 - s);
}

/**
 * Lissage exponentiel appliqué à la volée pendant la capture.
 * `amount` vaut 0 (aucun) à ~0.9 (très lissé).
 */
export function streamlinePoint(
  prevX: number, prevY: number, prevP: number,
  x: number, y: number, p: number,
  amount: number,
): [number, number, number] {
  const t = 1 - Math.min(0.92, Math.max(0, amount));
  return [prevX + (x - prevX) * t, prevY + (y - prevY) * t, prevP + (p - prevP) * Math.min(1, t * 1.6)];
}

/** Ramer–Douglas–Peucker sur une polyligne plate [x,y,p,…] : la pression suit le point conservé. */
export function simplifyStroke(pts: number[], epsilon: number): number[] {
  const n = pts.length / 3;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];

  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    const ax = pts[first * 3];
    const ay = pts[first * 3 + 1];
    const bx = pts[last * 3];
    const by = pts[last * 3 + 1];
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = first + 1; i < last; i++) {
      const px = pts[i * 3];
      const py = pts[i * 3 + 1];
      let d: number;
      if (len2 === 0) {
        d = Math.hypot(px - ax, py - ay);
      } else {
        let t = ((px - ax) * vx + (py - ay) * vy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
      }
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([first, maxIdx], [maxIdx, last]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  }
  return out;
}

interface Sample {
  x: number;
  y: number;
  r: number;
  /** Distance cumulée depuis le début du trait. */
  d: number;
}

function prepare(pts: number[], o: OutlineOptions): Sample[] {
  const n = pts.length / 3;
  const half = o.size / 2;
  const samples: Sample[] = [];
  let total = 0;
  let lastX = pts[0];
  let lastY = pts[1];

  for (let i = 0; i < n; i++) {
    const x = pts[i * 3];
    const y = pts[i * 3 + 1];
    const p = Math.min(1, Math.max(0, pts[i * 3 + 2]));
    const step = i === 0 ? 0 : Math.hypot(x - lastX, y - lastY);
    // Les points quasi confondus produisent des normales instables : on les fusionne.
    if (i > 0 && i < n - 1 && step < half * 0.06) continue;
    total += step;
    lastX = x;
    lastY = y;

    const shaped = Math.pow(p, o.curve);
    const factor = 1 - o.thinning + o.thinning * (o.minWidth + (1 - o.minWidth) * shaped);
    samples.push({ x, y, r: half * factor, d: total });
  }

  if (samples.length === 0) return samples;

  // Effilage des extrémités, appliqué après coup pour ne pas fausser la pression.
  const length = samples[samples.length - 1].d;
  for (const s of samples) {
    if (o.taperStart > 0) {
      const t = Math.min(1, s.d / Math.min(o.taperStart, Math.max(1, length)));
      s.r *= 0.25 + 0.75 * Math.sqrt(t);
    }
    if (o.taperEnd > 0) {
      const t = Math.min(1, (length - s.d) / Math.min(o.taperEnd, Math.max(1, length)));
      s.r *= 0.25 + 0.75 * Math.sqrt(t);
    }
    s.r = Math.max(0.35, s.r);
  }
  return samples;
}

function arcPoints(out: number[], cx: number, cy: number, r: number, from: number, to: number, steps = 8) {
  for (let i = 0; i <= steps; i++) {
    const a = from + (to - from) * (i / steps);
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

/** Un point isolé : un disque, pour que le simple « tap » du stylet laisse une trace. */
function dot(x: number, y: number, r: number): number[] {
  const out: number[] = [];
  arcPoints(out, x, y, r, 0, Math.PI * 2, 16);
  return out;
}

/**
 * Contour du trait, sous forme de polygone plat [x, y, …].
 * À remplir en `nonzero` : les auto-intersections des virages serrés ne
 * doivent pas creuser de trous.
 */
export function strokeOutline(pts: number[], opts: Partial<OutlineOptions> = {}): number[] {
  const o = { ...DEFAULT_OUTLINE, ...opts };
  if (pts.length < 3) return [];
  const samples = prepare(pts, o);
  if (samples.length === 0) return [];
  if (samples.length === 1) return dot(samples[0].x, samples[0].y, samples[0].r);

  const n = samples.length;
  const left: number[] = [];
  const right: number[] = [];

  for (let i = 0; i < n; i++) {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(n - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = -dy;
    const ny = dx;
    const s = samples[i];
    const r = o.jitter ? s.r * (1 + hashNoise(i) * o.jitter) : s.r;
    left.push(s.x + nx * r, s.y + ny * r);
    right.push(s.x - nx * r, s.y - ny * r);
  }

  const first = samples[0];
  const last = samples[n - 1];
  const startAngle = Math.atan2(samples[1].y - first.y, samples[1].x - first.x);
  const endAngle = Math.atan2(last.y - samples[n - 2].y, last.x - samples[n - 2].x);

  const poly: number[] = [];
  for (let i = 0; i < left.length; i += 2) poly.push(left[i], left[i + 1]);
  // Bouchon de fin : demi-tour autour du dernier point.
  arcPoints(poly, last.x, last.y, samples[n - 1].r, endAngle + Math.PI / 2, endAngle - Math.PI / 2);
  for (let i = right.length - 2; i >= 0; i -= 2) poly.push(right[i], right[i + 1]);
  // Bouchon de début.
  arcPoints(poly, first.x, first.y, samples[0].r, startAngle - Math.PI / 2, startAngle - (3 * Math.PI) / 2);

  return chaikin(poly);
}

/** Une passe de Chaikin sur le contour fermé : casse l'aspect facetté des virages. */
function chaikin(poly: number[]): number[] {
  const n = poly.length / 2;
  if (n < 4) return poly;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = poly[i * 2];
    const y0 = poly[i * 2 + 1];
    const j = (i + 1) % n;
    const x1 = poly[j * 2];
    const y1 = poly[j * 2 + 1];
    out.push(x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.25);
    out.push(x0 + (x1 - x0) * 0.75, y0 + (y1 - y0) * 0.75);
  }
  return out;
}

export function outlineToPath(poly: number[]): Path2D {
  const path = new Path2D();
  if (poly.length < 4) return path;
  path.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) path.lineTo(poly[i], poly[i + 1]);
  path.closePath();
  return path;
}
