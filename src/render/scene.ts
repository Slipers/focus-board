import type {
  AnyElement,
  BackgroundKind,
  Camera,
  ID,
  ImageElement,
  NoteElement,
  PaperKind,
  ShapeElement,
  StrokeElement,
  TabletSettings,
  TextElement,
} from '../core/types';
import { BRUSHES, outlineOptionsFor } from '../core/brushes';
import { outlineToPath, strokeOutline } from '../core/freehand';
import { PAPERS, withAlpha } from '../core/palette';
import { paddedBounds, rectsIntersect, viewportWorldRect, type Rect } from '../core/geom';
import { fitFontSize, fontString, layoutText } from '../core/text';

export interface DrawOptions {
  cam: Camera;
  vw: number;
  vh: number;
  paper: PaperKind;
  background: BackgroundKind;
  tablet: TabletSettings;
  /** Éléments masqués intégralement. */
  hidden?: Set<ID>;
  /** Éléments dont le texte est en cours d'édition dans la superposition DOM. */
  editingText?: Set<ID>;
  /** Rendu pour export : pas de fond de grille, pas de culling. */
  forExport?: boolean;
  /** Laisse le fond transparent (export PNG détouré). */
  transparent?: boolean;
  /**
   * Rapport pixels physiques / pixels CSS. `vw` et `vh` sont toujours exprimés
   * en pixels CSS ; c'est ce facteur qui couvre la totalité du buffer sur un
   * écran à mise à l'échelle (125 %, 150 %, écran haute densité…).
   */
  dpr?: number;
}

/* ------------------------------------------------------------- formes */

export function buildShapePath(el: ShapeElement): Path2D {
  const { w, h } = el;
  const p = new Path2D();
  switch (el.shape) {
    case 'rect': {
      const r = Math.max(0, Math.min(14, w / 6, h / 6));
      p.roundRect(0, 0, w, h, r);
      break;
    }
    case 'ellipse':
      p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'diamond':
      p.moveTo(w / 2, 0);
      p.lineTo(w, h / 2);
      p.lineTo(w / 2, h);
      p.lineTo(0, h / 2);
      p.closePath();
      break;
    case 'triangle':
      p.moveTo(w / 2, 0);
      p.lineTo(w, h);
      p.lineTo(0, h);
      p.closePath();
      break;
    case 'star': {
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.45;
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = cx + Math.cos(a) * r * (w / Math.min(w, h));
        const y = cy + Math.sin(a) * r * (h / Math.min(w, h));
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      break;
    }
    case 'line':
    case 'arrow': {
      const [ax, ay, bx, by] = el.pts ?? [0, 0, w, h];
      p.moveTo(ax, ay);
      p.lineTo(bx, by);
      break;
    }
  }
  return p;
}

function arrowHeadPath(el: ShapeElement): Path2D {
  const [ax, ay, bx, by] = el.pts ?? [0, 0, el.w, el.h];
  const size = Math.max(9, el.strokeWidth * 3.4);
  const angle = Math.atan2(by - ay, bx - ax);
  const spread = 0.42;
  const p = new Path2D();
  p.moveTo(bx, by);
  p.lineTo(bx - Math.cos(angle - spread) * size, by - Math.sin(angle - spread) * size);
  p.lineTo(bx - Math.cos(angle) * size * 0.62, by - Math.sin(angle) * size * 0.62);
  p.lineTo(bx - Math.cos(angle + spread) * size, by - Math.sin(angle + spread) * size);
  p.closePath();
  return p;
}

function dashPattern(el: ShapeElement): number[] {
  const s = el.strokeWidth;
  if (el.dash === 'dashed') return [s * 3, s * 2.2];
  if (el.dash === 'dotted') return [0.1, s * 2.1];
  return [];
}

/* ------------------------------------------------------------ la scène */

export class Scene {
  private paths = new WeakMap<AnyElement, Path2D>();
  private images = new Map<string, HTMLImageElement | 'error'>();
  private pending = new Set<string>();
  /** Appelé quand une image finit de charger : le canvas doit se redessiner. */
  onAsset: (() => void) | null = null;

  /** À appeler quand les réglages tablette changent : les contours mis en cache deviennent faux. */
  invalidate() {
    this.paths = new WeakMap();
  }

  image(src: string): HTMLImageElement | null {
    const hit = this.images.get(src);
    if (hit && hit !== 'error') return hit;
    if (hit === 'error' || this.pending.has(src)) return null;
    this.pending.add(src);
    const img = new Image();
    img.onload = () => {
      this.images.set(src, img);
      this.pending.delete(src);
      this.onAsset?.();
    };
    img.onerror = () => {
      this.images.set(src, 'error');
      this.pending.delete(src);
    };
    img.src = src;
    return null;
  }

  /** Attend le chargement de toutes les images : indispensable avant un export. */
  async preload(elements: AnyElement[]): Promise<void> {
    const sources = elements.filter((e): e is ImageElement => e.type === 'image').map((e) => e.src);
    await Promise.all(
      sources.map(
        (src) =>
          new Promise<void>((resolve) => {
            if (this.image(src)) return resolve();
            const img = new Image();
            img.onload = () => {
              this.images.set(src, img);
              resolve();
            };
            img.onerror = () => {
              this.images.set(src, 'error');
              resolve();
            };
            img.src = src;
          }),
      ),
    );
  }

  render(ctx: CanvasRenderingContext2D, elements: AnyElement[], o: DrawOptions) {
    const paper = PAPERS[o.paper];
    const d = o.dpr ?? 1;
    ctx.save();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (o.transparent) {
      ctx.clearRect(0, 0, o.vw, o.vh);
    } else {
      ctx.fillStyle = paper.bg;
      ctx.fillRect(0, 0, o.vw, o.vh);
    }
    if (!o.forExport) drawBackground(ctx, o);

    const s = o.cam.zoom * d;
    ctx.setTransform(s, 0, 0, s, -o.cam.x * s, -o.cam.y * s);

    const view: Rect = viewportWorldRect(o.cam, o.vw, o.vh);
    for (const el of elements) {
      if (o.hidden?.has(el.id)) continue;
      if (!o.forExport && !rectsIntersect(view, paddedBounds(el))) continue;
      this.drawElement(ctx, el, o);
    }
    ctx.restore();
  }

  drawElement(ctx: CanvasRenderingContext2D, el: AnyElement, o: DrawOptions) {
    const suppressText = o.editingText?.has(el.id) ?? false;
    if (suppressText && el.type === 'text') return;
    ctx.save();
    ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
    if (el.angle) ctx.rotate(el.angle);
    ctx.translate(-el.w / 2, -el.h / 2);
    ctx.globalAlpha = el.opacity;

    switch (el.type) {
      case 'stroke':
        this.drawStroke(ctx, el, o);
        break;
      case 'shape':
        this.drawShape(ctx, el, suppressText);
        break;
      case 'note':
        this.drawNote(ctx, el, suppressText);
        break;
      case 'text':
        this.drawText(ctx, el);
        break;
      case 'image':
        this.drawImage(ctx, el);
        break;
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawStroke(ctx: CanvasRenderingContext2D, el: StrokeElement, o: DrawOptions) {
    let path = this.paths.get(el);
    if (!path) {
      path = outlineToPath(strokeOutline(el.points, outlineOptionsFor(el.brush, el.size, o.tablet)));
      this.paths.set(el, path);
    }
    const preset = BRUSHES[el.brush];
    ctx.globalAlpha = el.opacity * preset.alpha;
    if (preset.blend) {
      // Le surligneur doit teinter le papier, pas le masquer — le sens de la
      // fusion s'inverse selon que le papier est clair ou sombre.
      ctx.globalCompositeOperation = PAPERS[o.paper].dark ? 'lighten' : 'multiply';
    }
    ctx.fillStyle = el.color;
    ctx.fill(path, 'nonzero');
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawShape(ctx: CanvasRenderingContext2D, el: ShapeElement, suppressText = false) {
    const path = buildShapePath(el);
    const isOpen = el.shape === 'line' || el.shape === 'arrow';

    if (!isOpen && el.fill !== 'transparent') {
      ctx.fillStyle = el.fill;
      ctx.fill(path);
    }
    if (el.strokeWidth > 0) {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = el.dash === 'dotted' ? 'round' : 'butt';
      ctx.setLineDash(dashPattern(el));
      ctx.stroke(path);
      ctx.setLineDash([]);
      if (el.shape === 'arrow') {
        ctx.fillStyle = el.stroke;
        ctx.fill(arrowHeadPath(el));
      }
    }

    if (el.text && !suppressText) {
      const pad = 12;
      const maxW = Math.max(20, el.w - pad * 2);
      const layout = layoutText(el.text, el.font, el.fontSize, maxW);
      ctx.fillStyle = el.textColor;
      ctx.font = fontString(el.font, el.fontSize);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const startY = el.h / 2 - ((layout.lines.length - 1) * layout.lineHeight) / 2;
      layout.lines.forEach((line, i) => ctx.fillText(line, el.w / 2, startY + i * layout.lineHeight));
    }
  }

  private drawNote(ctx: CanvasRenderingContext2D, el: NoteElement, suppressText = false) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    const path = new Path2D();
    path.roundRect(0, 0, el.w, el.h, 6);
    ctx.fillStyle = el.color;
    ctx.fill(path);
    ctx.restore();

    // Léger dégradé pour éviter l'aplat plastique.
    const grad = ctx.createLinearGradient(0, 0, 0, el.h);
    grad.addColorStop(0, withAlpha('#ffffff', 0.16));
    grad.addColorStop(1, withAlpha('#000000', 0.06));
    const gp = new Path2D();
    gp.roundRect(0, 0, el.w, el.h, 6);
    ctx.fillStyle = grad;
    ctx.fill(gp);

    if (!el.text || suppressText) return;
    const pad = Math.max(10, Math.min(el.w, el.h) * 0.1);
    const boxW = el.w - pad * 2;
    const boxH = el.h - pad * 2;
    const size = fitFontSize(el.text, el.font, boxW, boxH, el.fontSize);
    const layout = layoutText(el.text, el.font, size, boxW);
    ctx.fillStyle = el.textColor;
    ctx.font = fontString(el.font, size);
    ctx.textAlign = el.align;
    ctx.textBaseline = 'top';
    const x = el.align === 'center' ? el.w / 2 : el.align === 'right' ? el.w - pad : pad;
    const y = pad + Math.max(0, (boxH - layout.height) / 2);
    layout.lines.forEach((line, i) => ctx.fillText(line, x, y + i * layout.lineHeight));
  }

  private drawText(ctx: CanvasRenderingContext2D, el: TextElement) {
    const layout = layoutText(el.text, el.font, el.fontSize, el.w);
    ctx.fillStyle = el.color;
    ctx.font = fontString(el.font, el.fontSize);
    ctx.textAlign = el.align;
    ctx.textBaseline = 'top';
    const x = el.align === 'center' ? el.w / 2 : el.align === 'right' ? el.w : 0;
    layout.lines.forEach((line, i) => ctx.fillText(line, x, i * layout.lineHeight));
  }

  private drawImage(ctx: CanvasRenderingContext2D, el: ImageElement) {
    const img = this.image(el.src);
    const clip = new Path2D();
    clip.roundRect(0, 0, el.w, el.h, el.radius);
    if (!img) {
      ctx.fillStyle = 'rgba(128,128,128,0.18)';
      ctx.fill(clip);
      return;
    }
    ctx.save();
    ctx.clip(clip);
    ctx.drawImage(img, 0, 0, el.w, el.h);
    ctx.restore();
  }
}

/* ---------------------------------------------------------- arrière-plan */

/**
 * Le fond est tracé en espace écran : l'épaisseur des lignes reste d'un pixel
 * quel que soit le zoom, et le pas se subdivise pour rester lisible.
 */
export function drawBackground(ctx: CanvasRenderingContext2D, o: DrawOptions) {
  if (o.background === 'blank') return;
  const paper = PAPERS[o.paper];
  const { zoom } = o.cam;

  let spacing = 40;
  while (spacing * zoom < 16) spacing *= 2;
  while (spacing * zoom > 130) spacing /= 2;
  const step = spacing * zoom;

  const sx = (x: number) => (x - o.cam.x) * zoom;
  const sy = (y: number) => (y - o.cam.y) * zoom;
  const startX = Math.floor(o.cam.x / spacing) * spacing;
  const startY = Math.floor(o.cam.y / spacing) * spacing;

  // Le repère est en pixels CSS : on cale les lignes sur la grille de pixels
  // physiques, sinon elles bavent dès que Windows applique une mise à l'échelle.
  const d = o.dpr ?? 1;
  const snap = (v: number) => (Math.round(v * d) + 0.5) / d;

  ctx.save();
  ctx.lineWidth = 1 / d;

  if (o.background === 'dots') {
    ctx.fillStyle = paper.dot;
    const r = step > 60 ? 1.6 : 1.1;
    for (let x = startX; sx(x) <= o.vw; x += spacing) {
      for (let y = startY; sy(y) <= o.vh; y += spacing) {
        ctx.beginPath();
        ctx.arc(snap(sx(x)), snap(sy(y)), r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }

  if (o.background === 'iso') {
    ctx.strokeStyle = paper.line;
    ctx.beginPath();
    for (let x = startX; sx(x) <= o.vw; x += spacing) {
      const px = snap(sx(x));
      ctx.moveTo(px, 0);
      ctx.lineTo(px, o.vh);
    }
    for (const slope of [Math.tan(Math.PI / 6), -Math.tan(Math.PI / 6)]) {
      const cStep = step * Math.hypot(1, slope);
      const cMin = Math.min(0 - slope * 0, o.vh - slope * o.vw) - cStep;
      const cMax = Math.max(o.vh - slope * 0, 0 - slope * o.vw) + cStep;
      const phase = ((-o.cam.y * zoom + slope * o.cam.x * zoom) % cStep + cStep) % cStep;
      for (let c = Math.floor(cMin / cStep) * cStep + phase; c <= cMax; c += cStep) {
        ctx.moveTo(0, c);
        ctx.lineTo(o.vw, slope * o.vw + c);
      }
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.strokeStyle = paper.line;
  ctx.beginPath();
  for (let y = startY; sy(y) <= o.vh; y += spacing) {
    const py = snap(sy(y));
    ctx.moveTo(0, py);
    ctx.lineTo(o.vw, py);
  }
  if (o.background === 'grid') {
    for (let x = startX; sx(x) <= o.vw; x += spacing) {
      const px = snap(sx(x));
      ctx.moveTo(px, 0);
      ctx.lineTo(px, o.vh);
    }
  }
  ctx.stroke();
  ctx.restore();
}
