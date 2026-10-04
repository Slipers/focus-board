import type {
  AnyElement,
  ImageElement,
  NoteElement,
  PdfPageElement,
  ShapeElement,
  StrokeElement,
  TabletSettings,
  TextElement,
} from '../core/types';
import type { BoardStore } from '../core/store';
import { PDFDocument, degrees } from 'pdf-lib';
import { Scene } from '../render/scene';
import { base64ToBytes, bytesToBase64, pdfRaster, setPdfCacheHold } from './pdf';
import { elementBounds, rectsIntersect, unionRects } from '../core/geom';
import { BRUSHES, outlineOptionsFor } from '../core/brushes';
import { strokeOutline } from '../core/freehand';
import { FONTS, PAPERS, withAlpha } from '../core/palette';
import { LINE_HEIGHT, fitFontSize, layoutText } from '../core/text';

export interface ExportOptions {
  scale: number;
  padding: number;
  transparent: boolean;
  /** Limite l'export à ces éléments (sélection). */
  only?: AnyElement[];
}

const DEFAULTS: ExportOptions = { scale: 2, padding: 48, transparent: false };

function contentBox(elements: AnyElement[], padding: number) {
  const box = unionRects(elements.map(elementBounds));
  if (!box) return { x: -400, y: -300, w: 800, h: 600 };
  return { x: box.x - padding, y: box.y - padding, w: box.w + padding * 2, h: box.h + padding * 2 };
}

/* --------------------------------------------------------------- PNG */

export async function renderToCanvas(
  store: BoardStore,
  tablet: TabletSettings,
  options: Partial<ExportOptions> = {},
): Promise<HTMLCanvasElement> {
  const o = { ...DEFAULTS, ...options };
  const elements = (o.only ?? store.allSorted()).slice().sort((a, b) => a.z - b.z);
  const box = contentBox(elements, o.padding);

  // Garde-fou mémoire : au-delà, l'export échouerait silencieusement.
  const maxSide = 12000;
  const scale = Math.min(o.scale, maxSide / Math.max(box.w, box.h));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * scale));
  canvas.height = Math.max(1, Math.round(box.h * scale));
  const ctx = canvas.getContext('2d')!;

  const scene = new Scene();
  // Pendant l'export, la scène dessine toutes les pages d'un coup : aucune ne
  // doit être évincée du cache entre son rendu et son tracé.
  setPdfCacheHold(true);
  try {
    await scene.preload(elements, scale);
    scene.render(ctx, elements, {
      cam: { x: box.x, y: box.y, zoom: scale },
      vw: canvas.width,
      vh: canvas.height,
      paper: store.paper,
      background: store.background,
      tablet,
      forExport: true,
      transparent: o.transparent,
    });
  } finally {
    setPdfCacheHold(false);
  }
  return canvas;
}

export async function exportPNGBase64(
  store: BoardStore,
  tablet: TabletSettings,
  options: Partial<ExportOptions> = {},
): Promise<string> {
  const canvas = await renderToCanvas(store, tablet, options);
  return canvas.toDataURL('image/png').split(',')[1];
}

/** Vignette compacte pour la bibliothèque de tableaux. */
export async function makeThumbnail(store: BoardStore, tablet: TabletSettings): Promise<string | null> {
  if (store.size === 0) return null;
  const box = contentBox(store.allSorted(), 24);
  const scale = Math.min(0.6, 360 / Math.max(box.w, box.h, 1));
  const canvas = await renderToCanvas(store, tablet, { scale, padding: 24, transparent: false });
  return canvas.toDataURL('image/webp', 0.62);
}

/* --------------------------------------------------------------- PDF */

/** Résolution de la couche d'annotations stampée sur la page, en px par point. */
const PDF_ANNOTATION_SCALE = 3;

/**
 * Couche transparente de ce qui a été écrit sur une page, dans le repère de la
 * page elle-même : on la rend dans le monde, puis on applique l'inverse de la
 * transformation de la page (déplacement, redimensionnement, rotation).
 * `null` quand rien n'a été écrit dessus — la page reste alors intacte.
 */
async function annotationLayer(
  page: PdfPageElement,
  annotations: AnyElement[],
  store: BoardStore,
  tablet: TabletSettings,
): Promise<HTMLCanvasElement | null> {
  const aabb = elementBounds(page);
  const over = annotations.filter((el) => rectsIntersect(aabb, elementBounds(el)));
  if (!over.length) return null;

  const scale = PDF_ANNOTATION_SCALE * Math.max(page.pageW / page.w, page.pageH / page.h);
  const tmp = document.createElement('canvas');
  tmp.width = Math.max(1, Math.round(aabb.w * scale));
  tmp.height = Math.max(1, Math.round(aabb.h * scale));
  const scene = new Scene();
  await scene.preload(over, scale);
  scene.render(tmp.getContext('2d')!, over, {
    cam: { x: aabb.x, y: aabb.y, zoom: scale },
    vw: tmp.width,
    vh: tmp.height,
    paper: store.paper,
    background: store.background,
    tablet,
    forExport: true,
    transparent: true,
  });

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(page.pageW * PDF_ANNOTATION_SCALE));
  out.height = Math.max(1, Math.round(page.pageH * PDF_ANNOTATION_SCALE));
  const ctx = out.getContext('2d')!;
  const cx = page.x + page.w / 2;
  const cy = page.y + page.h / 2;
  ctx.scale(PDF_ANNOTATION_SCALE, PDF_ANNOTATION_SCALE); // points de la page -> pixels
  ctx.scale(page.pageW / page.w, page.pageH / page.h); //   repère local -> points
  ctx.translate(page.w / 2, page.h / 2); //                 centré -> local
  ctx.rotate(-page.angle); //                               monde centré -> centré
  ctx.translate(-cx, -cy); //                               monde -> monde centré
  ctx.translate(aabb.x, aabb.y);
  ctx.scale(1 / scale, 1 / scale);
  ctx.drawImage(tmp, 0, 0);
  return out;
}

/**
 * Pose de l'image sur la page selon la rotation déclarée du PDF : un scan
 * tourné à 90° a une boîte en largeur, mais s'affiche en hauteur.
 * `w`/`h` sont les dimensions non tournées de la page.
 */
function stampBox(rotation: number, w: number, h: number) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: w, y: 0, rotate: 90 };
    case 180:
      return { x: w, y: h, rotate: 180 };
    case 270:
      return { x: 0, y: h, rotate: 270 };
    default:
      return { x: 0, y: 0, rotate: 0 };
  }
}

/**
 * Exporte un PDF rempli : les pages d'origine, intactes et toujours
 * vectorielles, avec par-dessus ce qui a été écrit à la main.
 *
 * Sans page de PDF sur le tableau, le tableau lui-même part en une page.
 */
export async function exportFilledPdfBase64(store: BoardStore, tablet: TabletSettings): Promise<string> {
  const all = store.allSorted();
  const pages = all
    .filter((e): e is PdfPageElement => e.type === 'pdfPage')
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const out = await PDFDocument.create();

  if (!pages.length) {
    const canvas = await renderToCanvas(store, tablet, { scale: 2, padding: 40 });
    const png = await out.embedPng(canvas.toDataURL('image/png'));
    const sheet = out.addPage([canvas.width / 2, canvas.height / 2]);
    sheet.drawImage(png, { x: 0, y: 0, width: sheet.getWidth(), height: sheet.getHeight() });
    return bytesToBase64(await out.save());
  }

  const annotations = all.filter((e) => e.type !== 'pdfPage');
  const sources = new Map<string, PDFDocument>();
  setPdfCacheHold(true);
  try {
    for (const page of pages) {
      const asset = store.asset(page.asset);
      if (!asset) continue;
      let src = sources.get(page.asset);
      if (!src) {
        src = await PDFDocument.load(base64ToBytes(asset.data).buffer as ArrayBuffer);
        sources.set(page.asset, src);
      }
      const [copied] = await out.copyPages(src, [page.page - 1]);
      out.addPage(copied);

      const layer = await annotationLayer(page, annotations, store, tablet);
      if (!layer) continue;
      const png = await out.embedPng(layer.toDataURL('image/png'));
      const box = stampBox(copied.getRotation().angle, copied.getWidth(), copied.getHeight());
      copied.drawImage(png, {
        x: box.x,
        y: box.y,
        width: page.pageW,
        height: page.pageH,
        rotate: degrees(box.rotate),
      });
    }
  } finally {
    setPdfCacheHold(false);
  }
  return bytesToBase64(await out.save());
}

/** Nom de fichier proposé pour l'export PDF : celui du document importé. */
export function filledPdfName(store: BoardStore): string | null {
  const page = store.allSorted().find((e): e is PdfPageElement => e.type === 'pdfPage');
  return page ? page.label.replace(/\.pdf$/i, '') : null;
}

/* --------------------------------------------------------------- SVG */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function transformFor(el: AnyElement): string {
  if (!el.angle) return `translate(${round(el.x)} ${round(el.y)})`;
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  return `translate(${round(cx)} ${round(cy)}) rotate(${round((el.angle * 180) / Math.PI)}) translate(${round(-el.w / 2)} ${round(-el.h / 2)})`;
}

const round = (n: number) => Math.round(n * 100) / 100;

function polygonToPath(poly: number[]): string {
  if (poly.length < 4) return '';
  let d = `M${round(poly[0])} ${round(poly[1])}`;
  for (let i = 2; i < poly.length; i += 2) d += `L${round(poly[i])} ${round(poly[i + 1])}`;
  return `${d}Z`;
}

function strokeToSvg(el: StrokeElement, tablet: TabletSettings): string {
  const poly = strokeOutline(el.points, outlineOptionsFor(el.brush, el.size, tablet));
  const d = polygonToPath(poly);
  if (!d) return '';
  const preset = BRUSHES[el.brush];
  const blend = preset.blend ? ' style="mix-blend-mode:multiply"' : '';
  return `<path d="${d}" fill="${el.color}" fill-rule="nonzero" fill-opacity="${round(el.opacity * preset.alpha)}"${blend}/>`;
}

function dashFor(el: ShapeElement): string {
  if (el.dash === 'dashed') return ` stroke-dasharray="${round(el.strokeWidth * 3)} ${round(el.strokeWidth * 2.2)}"`;
  if (el.dash === 'dotted') return ` stroke-dasharray="0.1 ${round(el.strokeWidth * 2.1)}" stroke-linecap="round"`;
  return '';
}

function textBlock(
  lines: string[],
  x: number,
  y: number,
  size: number,
  font: string,
  color: string,
  anchor: string,
): string {
  const spans = lines
    .map((line, i) => `<tspan x="${round(x)}" y="${round(y + i * size * LINE_HEIGHT + size * 0.82)}">${esc(line)}</tspan>`)
    .join('');
  return `<text font-family="${esc(font)}" font-size="${round(size)}" fill="${color}" text-anchor="${anchor}">${spans}</text>`;
}

function shapeToSvg(el: ShapeElement): string {
  const fill = el.fill === 'transparent' ? 'none' : el.fill;
  const common = `fill="${fill}" stroke="${el.stroke}" stroke-width="${round(el.strokeWidth)}" stroke-linejoin="round"${dashFor(el)}`;
  let body = '';
  switch (el.shape) {
    case 'rect': {
      const r = Math.max(0, Math.min(14, el.w / 6, el.h / 6));
      body = `<rect width="${round(el.w)}" height="${round(el.h)}" rx="${round(r)}" ${common}/>`;
      break;
    }
    case 'ellipse':
      body = `<ellipse cx="${round(el.w / 2)}" cy="${round(el.h / 2)}" rx="${round(el.w / 2)}" ry="${round(el.h / 2)}" ${common}/>`;
      break;
    case 'diamond':
      body = `<polygon points="${round(el.w / 2)},0 ${round(el.w)},${round(el.h / 2)} ${round(el.w / 2)},${round(el.h)} 0,${round(el.h / 2)}" ${common}/>`;
      break;
    case 'triangle':
      body = `<polygon points="${round(el.w / 2)},0 ${round(el.w)},${round(el.h)} 0,${round(el.h)}" ${common}/>`;
      break;
    case 'star': {
      const pts: string[] = [];
      const outer = Math.min(el.w, el.h) / 2;
      const inner = outer * 0.45;
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push(`${round(el.w / 2 + Math.cos(a) * r * (el.w / Math.min(el.w, el.h)))},${round(el.h / 2 + Math.sin(a) * r * (el.h / Math.min(el.w, el.h)))}`);
      }
      body = `<polygon points="${pts.join(' ')}" ${common}/>`;
      break;
    }
    case 'line':
    case 'arrow': {
      const [ax, ay, bx, by] = el.pts ?? [0, 0, el.w, el.h];
      body = `<line x1="${round(ax)}" y1="${round(ay)}" x2="${round(bx)}" y2="${round(by)}" fill="none" stroke="${el.stroke}" stroke-width="${round(el.strokeWidth)}" stroke-linecap="round"${dashFor(el)}/>`;
      if (el.shape === 'arrow') {
        const size = Math.max(9, el.strokeWidth * 3.4);
        const angle = Math.atan2(by - ay, bx - ax);
        const spread = 0.42;
        const p1 = `${round(bx - Math.cos(angle - spread) * size)},${round(by - Math.sin(angle - spread) * size)}`;
        const p2 = `${round(bx - Math.cos(angle) * size * 0.62)},${round(by - Math.sin(angle) * size * 0.62)}`;
        const p3 = `${round(bx - Math.cos(angle + spread) * size)},${round(by - Math.sin(angle + spread) * size)}`;
        body += `<polygon points="${round(bx)},${round(by)} ${p1} ${p2} ${p3}" fill="${el.stroke}"/>`;
      }
      break;
    }
  }
  if (el.text) {
    const pad = 12;
    const layout = layoutText(el.text, el.font, el.fontSize, Math.max(20, el.w - pad * 2));
    const y = el.h / 2 - layout.height / 2;
    body += textBlock(layout.lines, el.w / 2, y, el.fontSize, FONTS[el.font], el.textColor, 'middle');
  }
  return body;
}

function noteToSvg(el: NoteElement): string {
  let body = `<rect width="${round(el.w)}" height="${round(el.h)}" rx="6" fill="${el.color}"/>`;
  if (el.text) {
    const pad = Math.max(10, Math.min(el.w, el.h) * 0.1);
    const boxW = el.w - pad * 2;
    const boxH = el.h - pad * 2;
    const size = fitFontSize(el.text, el.font, boxW, boxH, el.fontSize);
    const layout = layoutText(el.text, el.font, size, boxW);
    const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
    const x = el.align === 'center' ? el.w / 2 : el.align === 'right' ? el.w - pad : pad;
    const y = pad + Math.max(0, (boxH - layout.height) / 2);
    body += textBlock(layout.lines, x, y, size, FONTS[el.font], el.textColor, anchor);
  }
  return body;
}

function textToSvg(el: TextElement): string {
  const layout = layoutText(el.text, el.font, el.fontSize, el.w);
  const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
  const x = el.align === 'center' ? el.w / 2 : el.align === 'right' ? el.w : 0;
  return textBlock(layout.lines, x, 0, el.fontSize, FONTS[el.font], el.color, anchor);
}

function imageToSvg(el: ImageElement): string {
  return `<image href="${esc(el.src)}" width="${round(el.w)}" height="${round(el.h)}" preserveAspectRatio="none"/>`;
}

/** Une page de PDF part en image : le SVG n'a pas de quoi porter du PDF. */
function pdfPageToSvg(el: PdfPageElement): string {
  const sheet = `<rect width="${round(el.w)}" height="${round(el.h)}" fill="#ffffff"/>`;
  const raster = pdfRaster(el, 2);
  if (!raster) return sheet;
  return `${sheet}<image href="${raster.toDataURL('image/png')}" width="${round(el.w)}" height="${round(el.h)}" preserveAspectRatio="none"/>`;
}

export async function exportSVG(
  store: BoardStore,
  tablet: TabletSettings,
  options: Partial<ExportOptions> = {},
): Promise<string> {
  const o = { ...DEFAULTS, ...options };
  const elements = (o.only ?? store.allSorted()).slice().sort((a, b) => a.z - b.z);
  const box = contentBox(elements, o.padding);
  const paper = PAPERS[store.paper];
  setPdfCacheHold(true);
  try {
    await new Scene().preload(elements, 2);
  } finally {
    setPdfCacheHold(false);
  }

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(box.w)}" height="${round(box.h)}" viewBox="${round(box.x)} ${round(box.y)} ${round(box.w)} ${round(box.h)}">`,
  );
  if (!o.transparent) {
    parts.push(`<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.w)}" height="${round(box.h)}" fill="${paper.bg}"/>`);
  }

  for (const el of elements) {
    let body = '';
    switch (el.type) {
      case 'stroke':
        body = strokeToSvg(el as StrokeElement, tablet);
        break;
      case 'shape':
        body = shapeToSvg(el as ShapeElement);
        break;
      case 'note':
        body = noteToSvg(el as NoteElement);
        break;
      case 'text':
        body = textToSvg(el as TextElement);
        break;
      case 'image':
        body = imageToSvg(el as ImageElement);
        break;
      case 'pdfPage':
        body = pdfPageToSvg(el as PdfPageElement);
        break;
    }
    if (!body) continue;
    const opacity = el.opacity < 1 && el.type !== 'stroke' ? ` opacity="${round(el.opacity)}"` : '';
    parts.push(`<g transform="${transformFor(el)}"${opacity}>${body}</g>`);
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/** Fond légèrement teinté utilisé par la bibliothèque quand aucune vignette n'existe. */
export function placeholderTint(paperDark: boolean): string {
  return withAlpha(paperDark ? '#ffffff' : '#000000', 0.05);
}
