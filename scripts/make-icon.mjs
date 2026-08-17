/**
 * Génère build/icon.png (512×512) sans dépendance : electron-builder en tire
 * lui-même le .ico dont l'installeur a besoin.
 *
 * Le motif est un trait d'encre à largeur variable — le même principe que le
 * moteur de rendu de l'app — posé sur un carré arrondi bleu.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 512;
const RADIUS = 112;

/* ------------------------------------------------------------ dessin */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Distance signée à un carré arrondi centré. Négatif = intérieur. */
function roundedRectSD(x, y, halfW, halfH, r) {
  const qx = Math.abs(x) - (halfW - r);
  const qy = Math.abs(y) - (halfH - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

function cubic(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

// Centreline du trait, avec un rayon qui enfle au milieu comme sous la pression.
const SAMPLES = [];
{
  const p0 = [118, 372];
  const p1 = [196, 108];
  const p2 = [330, 404];
  const p3 = [400, 146];
  const n = 220;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = cubic(t, p0, p1, p2, p3);
    const bulge = Math.sin(Math.PI * t) ** 0.7;
    SAMPLES.push([x, y, 7 + 27 * bulge]);
  }
}

/** Distance signée au trait : min sur les échantillons de (distance − rayon). */
function strokeSD(x, y) {
  let best = Infinity;
  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];
    const d = Math.hypot(x - s[0], y - s[1]) - s[2];
    if (d < best) best = d;
  }
  return best;
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
const half = SIZE / 2;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const px = x + 0.5;
    const py = y + 0.5;

    // Fond : dégradé diagonal, découpé par le carré arrondi.
    const g = clamp01((px + py) / (SIZE * 2));
    let r = Math.round(95 + (58 - 95) * g);
    let gr = Math.round(157 + (110 - 157) * g);
    let b = Math.round(255 + (224 - 255) * g);
    const bgAlpha = clamp01(0.5 - roundedRectSD(px - half, py - half, half, half, RADIUS));

    // Trait blanc par-dessus, anticrénelé sur un pixel.
    const inkAlpha = clamp01(0.5 - strokeSD(px, py)) * bgAlpha;
    r = Math.round(r + (255 - r) * inkAlpha);
    gr = Math.round(gr + (255 - gr) * inkAlpha);
    b = Math.round(b + (255 - b) * inkAlpha);

    const o = (y * SIZE + x) * 4;
    rgba[o] = r;
    rgba[o + 1] = gr;
    rgba[o + 2] = b;
    rgba[o + 3] = Math.round(bgAlpha * 255);
  }
}

/* --------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // profondeur
ihdr[9] = 6; // RGBA
// compression / filtre / entrelacement restent à 0

// Chaque ligne est préfixée de son octet de filtre (0 = aucun).
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync(path.join('build', 'icon.png'), png);
console.log(`build/icon.png écrit (${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)} Ko)`);
