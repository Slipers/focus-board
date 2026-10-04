import type { ID, PdfPageElement } from '../core/types';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

/**
 * Lecture et rendu des PDF importés.
 *
 * Un PDF n'est pas converti en images à l'import : ses octets sont gardés une
 * seule fois dans le tableau, et chaque page est rastérisée à la demande, à la
 * résolution du zoom courant. C'est ce qui permet d'écrire sur un formulaire
 * zoomé à 300 % sans que le fond devienne flou, tout en gardant des fichiers
 * de tableau légers.
 */

/** Résolutions auxquelles une page est rastérisée, en pixels par point PDF. */
const SCALES = [0.5, 0.75, 1, 1.5, 2, 3];
/** Au-delà, un seul canvas de page coûterait plus de 50 Mo. */
const MAX_PIXELS = 12e6;
/** Nombre de rendus gardés en mémoire, du plus récemment utilisé au plus ancien. */
const MAX_RASTERS = 8;

/** Pendant un export, aucun rendu n'est évincé : la scène les dessine tous d'un coup. */
let holdAll = false;
export function setPdfCacheHold(hold: boolean) {
  holdAll = hold;
}

let workerReady = false;
function setupWorker() {
  if (workerReady) return;
  // Le worker n'est créé qu'au premier PDF : un tableau sans PDF ne paie pas
  // le coût d'un thread et de son mégaoctet de code.
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

const assets = new Map<ID, string>();
const documents = new Map<ID, Promise<PDFDocumentProxy>>();
const rasters = new Map<string, HTMLCanvasElement>();
const pending = new Set<string>();
let onRaster: (() => void) | null = null;

/** Appelé quand une page finit d'être rastérisée : le canvas doit se redessiner. */
export function setPdfRasterListener(fn: (() => void) | null) {
  onRaster = fn;
}

export function registerPdfAsset(id: ID, base64: string) {
  assets.set(id, base64);
}

export function pdfAssetData(id: ID): string | null {
  return assets.get(id) ?? null;
}

/** Vide les caches : à appeler au changement de tableau. */
export function clearPdfCache() {
  for (const doc of documents.values()) void doc.then((d) => d.destroy()).catch(() => {});
  assets.clear();
  documents.clear();
  rasters.clear();
  pending.clear();
}

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Par tranches : `String.fromCharCode(...bytes)` dépasse la taille maximale
  // de la pile d'appels dès quelques centaines de kilo-octets.
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function document_(assetId: ID): Promise<PDFDocumentProxy> {
  let doc = documents.get(assetId);
  if (!doc) {
    const base64 = assets.get(assetId);
    if (!base64) return Promise.reject(new Error('PDF introuvable dans ce tableau'));
    setupWorker();
    doc = pdfjs.getDocument({
      data: base64ToBytes(base64),
      // Les polices standard (Helvetica, Times…) ne sont pas incluses dans la
      // plupart des formulaires : sans ces fichiers, leur texte disparaîtrait.
      standardFontDataUrl: './standard_fonts/',
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
    documents.set(assetId, doc);
    doc.catch(() => documents.delete(assetId));
  }
  return doc;
}

export interface PdfPageSize {
  width: number;
  height: number;
}

/** Taille de chaque page, en points PDF. */
export async function readPdfPages(assetId: ID, base64: string): Promise<PdfPageSize[]> {
  registerPdfAsset(assetId, base64);
  const doc = await document_(assetId);
  const out: PdfPageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const v = page.getViewport({ scale: 1 });
    out.push({ width: v.width, height: v.height });
    page.cleanup();
  }
  return out;
}

const key = (assetId: ID, page: number, scale: number) => `${assetId}:${page}:${scale}`;

/** Résolution retenue pour un besoin donné : le palier juste au-dessus. */
function bucketFor(el: PdfPageElement, needed: number): number {
  const capped = Math.min(needed, Math.sqrt(MAX_PIXELS / Math.max(1, el.pageW * el.pageH)));
  return SCALES.find((s) => s >= capped) ?? SCALES[SCALES.length - 1];
}

/**
 * Rendu de la page prêt à dessiner, ou le meilleur rendu déjà disponible en
 * attendant. `needed` est exprimé en pixels écran par point PDF.
 */
export function pdfRaster(el: PdfPageElement, needed: number): HTMLCanvasElement | null {
  const scale = bucketFor(el, needed);
  const k = key(el.asset, el.page, scale);
  const hit = rasters.get(k);
  if (hit) {
    // Remise en tête de la liste des rendus récents.
    rasters.delete(k);
    rasters.set(k, hit);
    return hit;
  }
  void renderRaster(el, scale, k);
  return bestAvailable(el);
}

/** À défaut du bon palier, le rendu le plus fin déjà en mémoire pour cette page. */
function bestAvailable(el: PdfPageElement): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  for (const scale of SCALES) {
    const hit = rasters.get(key(el.asset, el.page, scale));
    if (hit) best = hit;
  }
  return best;
}

async function renderRaster(el: PdfPageElement, scale: number, k: string): Promise<HTMLCanvasElement | null> {
  if (pending.has(k)) return null;
  pending.add(k);
  try {
    const doc = await document_(el.asset);
    const page = await doc.getPage(el.page);
    const viewport = page.getViewport({ scale });
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
    page.cleanup();
    rasters.set(k, canvas);
    while (!holdAll && rasters.size > MAX_RASTERS) {
      const oldest = rasters.keys().next().value;
      if (oldest === undefined) break;
      rasters.delete(oldest);
    }
    onRaster?.();
    return canvas;
  } catch (err) {
    // La page garde alors sa feuille blanche : mieux vaut écrire dessus que
    // de perdre le tableau, mais la cause doit rester visible.
    console.error('Rendu de la page PDF impossible', err);
    return null;
  } finally {
    pending.delete(k);
  }
}

/** Attend le rendu de toutes les pages : indispensable avant un export. */
export async function preloadPdfPages(els: PdfPageElement[], needed = 2): Promise<void> {
  for (const el of els) {
    const scale = bucketFor(el, needed);
    const k = key(el.asset, el.page, scale);
    if (!rasters.has(k)) await renderRaster(el, scale, k);
  }
}
