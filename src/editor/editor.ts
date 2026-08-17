import type {
  AnyElement,
  AppSettings,
  BrushKind,
  DashKind,
  FontKind,
  ID,
  NoteElement,
  ShapeElement,
  ShapeKind,
  StrokeElement,
  TextElement,
  ToolId,
} from '../core/types';
import type { BoardStore } from '../core/store';
import { Scene } from '../render/scene';
import {
  CURSOR_FOR_HANDLE,
  drawOverlay,
  frameForSelection,
  handlesFor,
  hitHandle,
  pointInFrame,
  pruneLaser,
  type Frame,
  type HandleId,
  type LaserPoint,
  type LiveStroke,
  type SnapGuide,
} from '../render/overlay';
import {
  clamp,
  elementBounds,
  normalizeRect,
  screenToWorld,
  unionRects,
  type Rect,
} from '../core/geom';
import { elementsInLasso, elementsInRect, pickTopmost, segmentHitsElement } from '../core/hit';
import { cascadeAmount, simplifyStroke, streamlinePoint } from '../core/freehand';
import { BRUSHES } from '../core/brushes';
import { PAPERS, readableTextColor } from '../core/palette';
import {
  cloneWithOffset,
  makeImage,
  makeNote,
  makeShape,
  makeText,
  strokeFromWorldPoints,
  textHeightFor,
} from '../core/factory';
import { eraseFromStroke } from '../core/erase';
import { recognizeShape } from '../core/recognize';
import { InlineTextEditor } from './textedit';
import { applyMove, applyResize, applyRotate, computeSnap, type TransformSession } from './transform';

export const MIN_ZOOM = 0.04;
export const MAX_ZOOM = 16;

export interface StyleState {
  ink: string;
  brush: BrushKind;
  sizes: Record<BrushKind, number>;
  eraserSize: number;
  eraserMode: 'stroke' | 'point';
  shape: ShapeKind;
  shapeStroke: string;
  shapeFill: string;
  shapeStrokeWidth: number;
  dash: DashKind;
  noteColor: string;
  font: FontKind;
  fontSize: number;
  textColor: string;
}

export interface PointerInfo {
  type: string;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  buttons: number;
  coalesced: number;
}

const DRAW_TOOLS: ToolId[] = ['pen', 'marker', 'highlighter', 'pencil'];

type Action =
  | { kind: 'draw'; pointerId: number }
  | { kind: 'erase'; pointerId: number; lastX: number; lastY: number }
  | { kind: 'pan'; pointerId: number; startX: number; startY: number; camX: number; camY: number }
  | { kind: 'marquee'; pointerId: number; x0: number; y0: number; additive: boolean }
  | { kind: 'lasso'; pointerId: number; pts: number[]; additive: boolean }
  | { kind: 'transform'; pointerId: number; session: TransformSession; moved: boolean }
  | { kind: 'createShape'; pointerId: number; x0: number; y0: number; id: ID }
  | { kind: 'laser'; pointerId: number }
  | {
      kind: 'pinch';
      ids: [number, number];
      startDist: number;
      startZoom: number;
      worldMidX: number;
      worldMidY: number;
    };

type EditorEvent = 'change' | 'selection' | 'tool' | 'camera' | 'pointer' | 'penFallback';

export type PenPressureMode = 'unknown' | 'real' | 'synthetic';

export class Editor {
  readonly sceneCanvas: HTMLCanvasElement;
  readonly overlayCanvas: HTMLCanvasElement;
  readonly scene = new Scene();

  store: BoardStore;
  settings: AppSettings;
  tool: ToolId = 'pen';
  selection: ID[] = [];
  style: StyleState;
  lastPointer: PointerInfo | null = null;
  /** Statut de la détection de pression stylet, pour l'affichage diagnostic. */
  penPressureMode: PenPressureMode = 'unknown';

  private sctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private text: InlineTextEditor;
  private unsubscribeStore: (() => void) | null = null;

  private vw = 0;
  private vh = 0;
  private dpr = 1;
  private sceneRevision = -1;
  private lastCamKey = '';
  private frameQueued = false;
  private sceneDirty = true;

  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private action: Action | null = null;
  private live: LiveStroke | null = null;
  /** Les deux étages du filtre de lissage, et le dernier point brut reçu. */
  private smoothA: { x: number; y: number; p: number } | null = null;
  private smoothB: { x: number; y: number; p: number } | null = null;
  private lastRaw: { x: number; y: number; p: number } | null = null;
  private lastSampleTime = 0;
  private lastSpeed = 0;
  private penFlatStreak = 0;
  private laser: LaserPoint[] = [];
  private guides: SnapGuide[] = [];
  private marquee: Rect | null = null;
  private hover: { x: number; y: number } | null = null;
  private penSeenAt = 0;
  private spaceDown = false;
  private clipboard: AnyElement[] = [];

  private listeners: Record<EditorEvent, Set<() => void>> = {
    change: new Set(),
    selection: new Set(),
    tool: new Set(),
    camera: new Set(),
    pointer: new Set(),
    penFallback: new Set(),
  };

  constructor(private host: HTMLElement, store: BoardStore, settings: AppSettings) {
    this.store = store;
    this.settings = settings;
    this.style = defaultStyle(store);

    this.sceneCanvas = document.createElement('canvas');
    this.sceneCanvas.className = 'layer scene-layer';
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'layer overlay-layer';
    host.append(this.sceneCanvas, this.overlayCanvas);

    this.sctx = this.sceneCanvas.getContext('2d', { alpha: false })!;
    this.octx = this.overlayCanvas.getContext('2d')!;

    this.text = new InlineTextEditor(host, {
      onInput: (value) => this.onTextInput(value),
      onCommit: () => this.onTextCommit(),
    });

    this.scene.onAsset = () => this.invalidateScene();
    this.attachStore(store);
    this.bindEvents();
    this.resize();
  }

  /* --------------------------------------------------------- événements */

  on(event: EditorEvent, fn: () => void): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  private emit(event: EditorEvent) {
    for (const fn of this.listeners[event]) fn();
  }

  private attachStore(store: BoardStore) {
    this.unsubscribeStore?.();
    this.unsubscribeStore = store.onChange(() => {
      this.invalidateScene();
      this.emit('change');
    });
  }

  setStore(store: BoardStore) {
    this.text.close();
    this.store = store;
    this.selection = [];
    this.style = defaultStyle(store);
    this.attachStore(store);
    this.scene.invalidate();
    this.invalidateScene();
    this.emit('change');
    this.emit('selection');
  }

  setSettings(settings: AppSettings) {
    this.settings = settings;
    this.scene.invalidate();
    this.invalidateScene();
  }

  destroy() {
    this.unsubscribeStore?.();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('paste', this.onPaste);
  }

  /* ------------------------------------------------------------- rendu */

  private onResize = () => this.resize();

  private resize() {
    const rect = this.host.getBoundingClientRect();
    this.vw = Math.max(1, Math.round(rect.width));
    this.vh = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    for (const c of [this.sceneCanvas, this.overlayCanvas]) {
      c.width = Math.round(this.vw * this.dpr);
      c.height = Math.round(this.vh * this.dpr);
      c.style.width = `${this.vw}px`;
      c.style.height = `${this.vh}px`;
    }
    this.invalidateScene();
  }

  invalidateScene() {
    this.sceneDirty = true;
    this.schedule();
  }

  schedule() {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => this.renderFrame());
  }

  get viewportSize() {
    return { w: this.vw, h: this.vh };
  }

  private camKey() {
    const c = this.store.camera;
    return `${c.x.toFixed(3)}|${c.y.toFixed(3)}|${c.zoom.toFixed(4)}|${this.vw}x${this.vh}|${this.dpr}`;
  }

  private renderFrame() {
    this.frameQueued = false;
    const cam = this.store.camera;
    const key = this.camKey();

    const editing = this.text.activeId ? new Set([this.text.activeId]) : undefined;

    if (this.sceneDirty || key !== this.lastCamKey || this.sceneRevision !== this.store.revision) {
      this.scene.render(this.sctx, this.store.allSorted(), {
        cam,
        vw: this.vw,
        vh: this.vh,
        dpr: this.dpr,
        paper: this.store.paper,
        background: this.store.background,
        tablet: this.settings.tablet,
        editingText: editing,
      });
      this.sceneDirty = false;
      this.sceneRevision = this.store.revision;
      this.lastCamKey = key;
    }

    this.laser = pruneLaser(this.laser);
    const selected = this.selectedElements();
    drawOverlay(this.octx, {
      cam,
      vw: this.vw,
      vh: this.vh,
      dpr: this.dpr,
      tablet: this.settings.tablet,
      selection: this.text.activeId ? [] : selected,
      frame: this.text.activeId ? null : frameForSelection(selected),
      live: this.live,
      lasso: this.action?.kind === 'lasso' ? this.action.pts : null,
      marquee: this.marquee,
      guides: this.guides,
      laser: this.laser,
      ring: this.ringState(),
      paperDark: PAPERS[this.store.paper].dark,
    });

    if (this.laser.length) this.schedule();
  }

  private ringState() {
    if (this.tool === 'eraser' && this.hover) {
      return { x: this.hover.x, y: this.hover.y, r: this.style.eraserSize / 2, kind: 'eraser' as const };
    }
    if (
      this.settings.tablet.hoverCursor &&
      this.hover &&
      DRAW_TOOLS.includes(this.tool) &&
      performance.now() - this.penSeenAt < 1500 &&
      !this.action
    ) {
      return {
        x: this.hover.x,
        y: this.hover.y,
        r: Math.max(1.5, this.style.sizes[this.style.brush] / 2),
        kind: 'hover' as const,
      };
    }
    return null;
  }

  /* ------------------------------------------------------------ caméra */

  private cameraChanged() {
    this.invalidateScene();
    this.text.update(this.store.get(this.text.activeId ?? ''), this.store.camera);
    this.emit('camera');
  }

  zoomAt(screenX: number, screenY: number, factor: number) {
    const cam = this.store.camera;
    const before = screenToWorld(cam, screenX, screenY);
    cam.zoom = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    cam.x = before.x - screenX / cam.zoom;
    cam.y = before.y - screenY / cam.zoom;
    this.cameraChanged();
  }

  setZoom(zoom: number) {
    this.zoomAt(this.vw / 2, this.vh / 2, clamp(zoom, MIN_ZOOM, MAX_ZOOM) / this.store.camera.zoom);
  }

  zoomIn() {
    this.zoomAt(this.vw / 2, this.vh / 2, 1.25);
  }

  zoomOut() {
    this.zoomAt(this.vw / 2, this.vh / 2, 1 / 1.25);
  }

  zoomReset() {
    this.setZoom(1);
  }

  /** Cadre le contenu (ou la sélection) dans la vue. */
  zoomToFit(padding = 80) {
    const elements = this.selection.length > 1 ? this.selectedElements() : this.store.allSorted();
    const box = unionRects(elements.map(elementBounds));
    if (!box || box.w === 0 || box.h === 0) {
      this.setZoom(1);
      return;
    }
    const cam = this.store.camera;
    cam.zoom = clamp(
      Math.min((this.vw - padding * 2) / box.w, (this.vh - padding * 2) / box.h),
      MIN_ZOOM,
      2,
    );
    cam.x = box.x + box.w / 2 - this.vw / 2 / cam.zoom;
    cam.y = box.y + box.h / 2 - this.vh / 2 / cam.zoom;
    this.cameraChanged();
  }

  panBy(dxScreen: number, dyScreen: number) {
    const cam = this.store.camera;
    cam.x += dxScreen / cam.zoom;
    cam.y += dyScreen / cam.zoom;
    this.cameraChanged();
  }

  /* ------------------------------------------------------------ outils */

  setTool(tool: ToolId) {
    if (this.tool === tool) return;
    this.text.close();
    this.tool = tool;
    if (DRAW_TOOLS.includes(tool)) this.style.brush = tool as BrushKind;
    if (tool !== 'select' && tool !== 'lasso') this.setSelection([]);
    this.updateCursor();
    this.emit('tool');
    this.schedule();
  }

  setStyle(patch: Partial<StyleState>) {
    Object.assign(this.style, patch);
    this.emit('tool');
    this.schedule();
  }

  setBrushSize(size: number) {
    this.style.sizes[this.style.brush] = size;
    this.emit('tool');
    this.schedule();
  }

  private updateCursor() {
    const map: Partial<Record<ToolId, string>> = {
      select: 'default',
      lasso: 'crosshair',
      pan: 'grab',
      eraser: 'none',
      text: 'text',
      note: 'copy',
      shape: 'crosshair',
      laser: 'crosshair',
    };
    this.host.style.cursor = map[this.tool] ?? 'crosshair';
  }

  /* --------------------------------------------------------- sélection */

  selectedElements(): AnyElement[] {
    const out: AnyElement[] = [];
    for (const id of this.selection) {
      const el = this.store.get(id);
      if (el) out.push(el);
    }
    return out;
  }

  setSelection(ids: ID[]) {
    const next = ids.filter((id) => this.store.has(id));
    if (next.length === this.selection.length && next.every((id, i) => this.selection[i] === id)) return;
    this.selection = next;
    this.emit('selection');
    this.schedule();
  }

  selectAll() {
    this.setTool('select');
    this.setSelection(this.store.allSorted().filter((e) => !e.locked).map((e) => e.id));
  }

  applyToSelection(patch: Partial<AnyElement>, label = 'Style') {
    if (!this.selection.length) return;
    this.store.begin(this.selection);
    for (const id of this.selection) this.store.update(id, patch);
    this.store.commit(label, this.selection);
  }

  deleteSelection() {
    if (!this.selection.length) return;
    this.store.begin(this.selection);
    for (const id of this.selection) this.store.remove(id);
    this.store.commit('Supprimer', []);
    this.setSelection([]);
  }

  duplicateSelection(offset = 24) {
    const elements = this.selectedElements();
    if (!elements.length) return;
    this.store.begin(this.selection);
    const ids: ID[] = [];
    for (const el of elements) {
      const copy = cloneWithOffset(el, offset, offset, this.store.nextZ());
      this.store.add(copy);
      ids.push(copy.id);
    }
    this.store.commit('Dupliquer', ids);
    this.setSelection(ids);
  }

  bringToFront() {
    if (!this.selection.length) return;
    this.store.begin(this.selection);
    this.store.bringToFront(this.selection);
    this.store.commit('Premier plan', this.selection);
  }

  sendToBack() {
    if (!this.selection.length) return;
    this.store.begin(this.selection);
    this.store.sendToBack(this.selection);
    this.store.commit('Arrière-plan', this.selection);
  }

  /** Applique une couleur à la sélection, chaque type d'élément ayant sa propre notion de « couleur ». */
  applyColor(color: string) {
    const elements = this.selectedElements();
    if (!elements.length) return;
    this.store.begin(this.selection);
    for (const el of elements) {
      switch (el.type) {
        case 'stroke':
          this.store.update(el.id, { color });
          break;
        case 'shape':
          this.store.update(el.id, { stroke: color, textColor: color });
          break;
        case 'note':
          this.store.update(el.id, { color, textColor: readableTextColor(color) });
          break;
        case 'text':
          this.store.update(el.id, { color });
          break;
        case 'image':
          break;
      }
    }
    this.store.commit('Couleur', this.selection);
  }

  setPaper(paper: BoardStore['paper']) {
    this.store.paper = paper;
    const ink = PAPERS[paper].defaultInk;
    // L'encre par défaut suit le papier, sinon on écrit en noir sur fond noir.
    if (this.style.ink === PAPERS.white.defaultInk || this.style.ink === PAPERS.slate.defaultInk) {
      this.style.ink = ink;
      this.style.shapeStroke = ink;
      this.style.textColor = ink;
    }
    this.scene.invalidate();
    this.store.touch();
    this.emit('tool');
  }

  setBackground(background: BoardStore['background']) {
    this.store.background = background;
    this.store.touch();
  }

  nudge(dx: number, dy: number) {
    if (!this.selection.length) return;
    this.store.begin(this.selection);
    for (const id of this.selection) {
      const el = this.store.get(id)!;
      this.store.update(id, { x: el.x + dx, y: el.y + dy });
    }
    this.store.commit('Déplacer', this.selection);
  }

  undo() {
    this.text.close();
    const sel = this.store.undo();
    if (sel) this.setSelection(sel);
  }

  redo() {
    this.text.close();
    const sel = this.store.redo();
    if (sel) this.setSelection(sel);
  }

  /* -------------------------------------------------------- contenu */

  addNoteAt(worldX: number, worldY: number) {
    const note = makeNote(
      worldX,
      worldY,
      this.style.noteColor,
      readableTextColor(this.style.noteColor),
      this.style.font,
      this.store.nextZ(),
    );
    this.store.begin([]);
    this.store.add(note);
    this.store.commit('Nouvelle note', [note.id]);
    this.setTool('select');
    this.setSelection([note.id]);
    this.text.open(note, this.store.camera);
    this.schedule();
  }

  addTextAt(worldX: number, worldY: number) {
    const el = makeText(worldX, worldY, this.style.textColor, this.style.font, this.style.fontSize, this.store.nextZ());
    this.store.begin([]);
    this.store.add(el);
    this.store.commit('Nouveau texte', [el.id]);
    this.setTool('select');
    this.setSelection([el.id]);
    this.text.open(el, this.store.camera);
    this.schedule();
  }

  async addImageFile(file: File, worldX?: number, worldY?: number) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    await this.addImageData(dataUrl, worldX, worldY);
  }

  async addImageData(dataUrl: string, worldX?: number, worldY?: number) {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image illisible'));
      i.src = dataUrl;
    });
    const center = screenToWorld(this.store.camera, this.vw / 2, this.vh / 2);
    const el = makeImage(
      dataUrl,
      img.naturalWidth,
      img.naturalHeight,
      worldX ?? center.x,
      worldY ?? center.y,
      this.store.nextZ(),
    );
    this.store.begin([]);
    this.store.add(el);
    this.store.commit('Image', [el.id]);
    this.setTool('select');
    this.setSelection([el.id]);
  }

  /* ----------------------------------------------------- presse-papiers */

  copySelection() {
    const els = this.selectedElements();
    if (els.length) this.clipboard = els.map((e) => structuredClone(e));
  }

  cutSelection() {
    this.copySelection();
    this.deleteSelection();
  }

  pasteClipboard(worldX?: number, worldY?: number) {
    if (!this.clipboard.length) return;
    const box = unionRects(this.clipboard.map(elementBounds))!;
    const center = worldX !== undefined && worldY !== undefined
      ? { x: worldX, y: worldY }
      : screenToWorld(this.store.camera, this.vw / 2, this.vh / 2);
    const dx = center.x - (box.x + box.w / 2);
    const dy = center.y - (box.y + box.h / 2);

    this.store.begin(this.selection);
    const ids: ID[] = [];
    for (const el of this.clipboard) {
      const copy = cloneWithOffset(el, dx, dy, this.store.nextZ());
      this.store.add(copy);
      ids.push(copy.id);
    }
    this.store.commit('Coller', ids);
    this.setTool('select');
    this.setSelection(ids);
  }

  /* ------------------------------------------------------------ saisie */

  private bindEvents() {
    const c = this.overlayCanvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.schedule();
    });
    c.addEventListener('dblclick', this.onDoubleClick);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // Sans ça, Chromium démarre son propre auto-scroll (l'icône ronde) au clic
    // milieu, en plus de — et en désaccord avec — notre pan personnalisé.
    c.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    this.host.addEventListener('wheel', this.onWheel, { passive: false });
    this.host.addEventListener('dragover', (e) => e.preventDefault());
    this.host.addEventListener('drop', this.onDrop);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('paste', this.onPaste);
    new ResizeObserver(() => this.resize()).observe(this.host);
  }

  private toWorld(e: PointerEvent | WheelEvent | MouseEvent) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return screenToWorld(this.store.camera, e.clientX - rect.left, e.clientY - rect.top);
  }

  private toLocalScreen(e: PointerEvent | WheelEvent | MouseEvent) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /**
   * Distingue un stylet qui transmet une vraie pression d'un stylet dont le
   * pilote tourne en mode compatibilité (WinTab plutôt que Windows Ink) et ne
   * transmet rien.
   *
   * La spécification Pointer Events impose à Chromium de renvoyer exactement
   * `0.5` pour un pointeur actif dont le matériel ne fournit pas de pression —
   * c'est une valeur sentinelle, pas une mesure. Une vraie mesure de force,
   * même quantifiée par le capteur, ne retombe quasiment jamais bit à bit sur
   * cette valeur plusieurs échantillons de suite : dès qu'on en voit un seul
   * différent, la pression est réelle ; si les dix premiers valent tous
   * exactement 0,5, elle ne l'est pas.
   */
  private observePenPressure(pressure: number) {
    if (this.penPressureMode !== 'unknown') return;
    if (pressure === 0.5) {
      this.penFlatStreak++;
      if (this.penFlatStreak >= 10) {
        this.penPressureMode = 'synthetic';
        this.emit('penFallback');
      }
    } else {
      this.penPressureMode = 'real';
    }
  }

  /**
   * Pression exploitable quel que soit le périphérique.
   * Les souris, la plupart des écrans tactiles, et un stylet dont le pilote ne
   * transmet pas de vraie pression, ne rapportent rien d'utile : on synthétise
   * alors une pression à partir de la vitesse, ce qui donne des attaques et
   * des déliés proches d'un vrai stylet plutôt qu'un trait d'épaisseur figée.
   */
  private pressureFor(e: PointerEvent, worldX: number, worldY: number): number {
    if (e.pointerType === 'pen') {
      this.observePenPressure(e.pressure);
      if (this.penPressureMode !== 'synthetic') {
        let p = e.pressure;
        if (this.settings.tablet.useTilt) {
          const tilt = Math.min(1, Math.hypot(e.tiltX, e.tiltY) / 75);
          p = clamp(p * (1 + tilt * 0.4), 0, 1);
        }
        return clamp(p, 0.02, 1);
      }
    }
    const now = performance.now();
    if (this.lastRaw && this.lastSampleTime) {
      const dt = Math.max(1, now - this.lastSampleTime);
      const speed = Math.hypot(worldX - this.lastRaw.x, worldY - this.lastRaw.y) / dt;
      this.lastSpeed = this.lastSpeed * 0.7 + speed * 0.3;
      this.lastSampleTime = now;
      return clamp(0.95 - this.lastSpeed * 0.42, 0.32, 0.95);
    }
    this.lastSampleTime = now;
    return 0.7;
  }

  private recordPointerInfo(e: PointerEvent, coalesced: number) {
    this.lastPointer = {
      type: e.pointerType,
      pressure: e.pressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      twist: e.twist,
      buttons: e.buttons,
      coalesced,
    };
    this.emit('pointer');
  }

  /**
   * Tous les échantillons du geste. Les tablettes émettent souvent 200 Hz alors
   * que l'écran rafraîchit à 60 Hz : sans les événements fusionnés, on perdrait
   * les deux tiers du tracé.
   */
  private samples(e: PointerEvent): PointerEvent[] {
    const list = e.getCoalescedEvents?.() ?? [];
    return list.length ? list : [e];
  }

  private penIsActive() {
    return performance.now() - this.penSeenAt < 900;
  }

  /** Outil réellement appliqué, une fois pris en compte stylet, boutons et modificateurs. */
  private effectiveTool(e: PointerEvent): ToolId {
    const t = this.settings.tablet;
    if (this.spaceDown || e.button === 1) return 'pan';
    if (e.pointerType === 'pen') {
      // bit 5 = pointe gomme du stylet, bit 1 = bouton latéral
      if (t.penEraserTip && (e.buttons & 32) !== 0) return 'eraser';
      if ((e.buttons & 2) !== 0) {
        if (t.barrelButton === 'pan') return 'pan';
        if (t.barrelButton === 'erase') return 'eraser';
        if (t.barrelButton === 'select') return 'select';
      }
    }
    if (e.button === 2) return 'pan';
    if (e.pointerType === 'touch' && t.fingerPans && this.tool !== 'select' && this.tool !== 'lasso') {
      return 'pan';
    }
    return this.tool;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.penSeenAt = performance.now();
    if (e.pointerType === 'touch' && this.settings.tablet.palmRejection && this.penIsActive()) return;

    const p = this.toLocalScreen(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, type: e.pointerType });
    this.recordPointerInfo(e, 1);

    // Deux doigts : pincement pour zoomer, quel que soit l'outil actif.
    const touches = [...this.pointers.entries()].filter(([, v]) => v.type === 'touch');
    if (touches.length === 2) {
      this.cancelAction();
      const [[idA, a], [idB, b]] = touches;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const world = screenToWorld(this.store.camera, midX, midY);
      this.action = {
        kind: 'pinch',
        ids: [idA, idB],
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startZoom: this.store.camera.zoom,
        worldMidX: world.x,
        worldMidY: world.y,
      };
      return;
    }
    if (this.action) return;

    try {
      this.overlayCanvas.setPointerCapture(e.pointerId);
    } catch {
      /* le pointeur peut avoir déjà été relâché */
    }
    const world = this.toWorld(e);
    const tool = this.effectiveTool(e);

    if (this.text.activeId) this.text.close();

    switch (tool) {
      case 'pan':
        this.action = { kind: 'pan', pointerId: e.pointerId, startX: p.x, startY: p.y, camX: this.store.camera.x, camY: this.store.camera.y };
        this.host.style.cursor = 'grabbing';
        return;
      case 'pen':
      case 'marker':
      case 'highlighter':
      case 'pencil':
        this.startDraw(e, world, tool as BrushKind);
        return;
      case 'eraser':
        this.store.begin(this.selection);
        this.action = { kind: 'erase', pointerId: e.pointerId, lastX: world.x, lastY: world.y };
        this.eraseSegment(world.x, world.y, world.x, world.y);
        return;
      case 'laser':
        this.action = { kind: 'laser', pointerId: e.pointerId };
        this.laser.push({ x: world.x, y: world.y, t: performance.now() });
        this.schedule();
        return;
      case 'note':
        this.addNoteAt(world.x, world.y);
        return;
      case 'text':
        this.addTextAt(world.x, world.y);
        return;
      case 'shape':
        this.startShape(e, world);
        return;
      case 'lasso':
        this.action = { kind: 'lasso', pointerId: e.pointerId, pts: [world.x, world.y], additive: e.shiftKey };
        return;
      case 'select':
      default:
        this.startSelect(e, world);
    }
  };

  private startDraw(e: PointerEvent, world: { x: number; y: number }, brush: BrushKind) {
    this.lastRaw = null;
    this.lastSpeed = 0;
    this.lastSampleTime = 0;
    const pressure = this.pressureFor(e, world.x, world.y);
    const seed = { x: world.x, y: world.y, p: pressure };
    this.smoothA = { ...seed };
    this.smoothB = { ...seed };
    this.lastRaw = { ...seed };
    this.live = {
      brush,
      color: this.style.ink,
      size: this.style.sizes[brush],
      points: [world.x, world.y, pressure],
    };
    this.action = { kind: 'draw', pointerId: e.pointerId };
    this.schedule();
  }

  private startShape(e: PointerEvent, world: { x: number; y: number }) {
    const isLine = this.style.shape === 'line' || this.style.shape === 'arrow';
    const el = makeShape({
      shape: this.style.shape,
      x: world.x,
      y: world.y,
      w: 1,
      h: 1,
      stroke: this.style.shapeStroke,
      fill: this.style.shapeFill,
      strokeWidth: this.style.shapeStrokeWidth,
      dash: this.style.dash,
      z: this.store.nextZ(),
      pts: isLine ? [0, 0, 1, 1] : undefined,
      font: this.style.font,
      textColor: this.style.shapeStroke,
    });
    this.store.begin(this.selection);
    this.store.add(el);
    this.action = { kind: 'createShape', pointerId: e.pointerId, x0: world.x, y0: world.y, id: el.id };
  }

  private startSelect(e: PointerEvent, world: { x: number; y: number }) {
    const selected = this.selectedElements();
    const frame = frameForSelection(selected);

    if (frame) {
      const handle = hitHandle(handlesFor(frame, this.store.camera), this.store.camera, world.x, world.y);
      if (handle) {
        this.beginTransform(e, frame, handle === 'rotate' ? 'rotate' : 'resize', handle, world);
        return;
      }
    }

    const tolerance = 6 / this.store.camera.zoom;
    const hit = pickTopmost(this.store.allSorted(), world.x, world.y, tolerance);

    if (!hit) {
      // Une forme non remplie est « creuse » : cliquer en son milieu ne touche
      // aucun trait. Tant que le cadre de sélection couvre le point, on
      // déplace quand même, comme le ferait n'importe quel éditeur vectoriel.
      if (frame && !e.shiftKey && pointInFrame(frame, world.x, world.y)) {
        this.beginTransform(e, frame, 'move', null, world);
        return;
      }
      if (!e.shiftKey) this.setSelection([]);
      this.action = { kind: 'marquee', pointerId: e.pointerId, x0: world.x, y0: world.y, additive: e.shiftKey };
      return;
    }

    if (e.shiftKey) {
      const next = this.selection.includes(hit.id)
        ? this.selection.filter((id) => id !== hit.id)
        : [...this.selection, hit.id];
      this.setSelection(next);
      if (!next.length) return;
    } else if (!this.selection.includes(hit.id)) {
      this.setSelection([hit.id]);
    }

    const movingFrame = frameForSelection(this.selectedElements());
    if (movingFrame) this.beginTransform(e, movingFrame, 'move', null, world);
  }

  private beginTransform(
    e: PointerEvent,
    frame: Frame,
    kind: TransformSession['kind'],
    handle: HandleId | null,
    world: { x: number; y: number },
  ) {
    const originals = new Map<ID, AnyElement>();
    for (const el of this.selectedElements()) originals.set(el.id, structuredClone(el));
    this.store.begin(this.selection);
    this.action = {
      kind: 'transform',
      pointerId: e.pointerId,
      moved: false,
      session: { kind, handle, frame, originals, startX: world.x, startY: world.y },
    };
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.penSeenAt = performance.now();
    const p = this.toLocalScreen(e);
    const tracked = this.pointers.get(e.pointerId);
    if (tracked) {
      tracked.x = p.x;
      tracked.y = p.y;
    }

    const world = this.toWorld(e);
    this.hover = { x: world.x, y: world.y };

    if (!this.action) {
      this.updateHoverCursor(world);
      if (e.pointerType === 'pen' || this.tool === 'eraser') this.schedule();
      return;
    }

    const a = this.action;
    if (a.kind === 'pinch') {
      this.updatePinch(a);
      return;
    }
    if ('pointerId' in a && a.pointerId !== e.pointerId) return;

    switch (a.kind) {
      case 'draw': {
        const events = this.samples(e);
        this.recordPointerInfo(e, events.length);
        for (const ce of events) {
          const w = this.toWorld(ce);
          this.extendDraw(w.x, w.y, this.pressureFor(ce, w.x, w.y));
        }
        this.schedule();
        break;
      }
      case 'erase': {
        const events = this.samples(e);
        for (const ce of events) {
          const w = this.toWorld(ce);
          this.eraseSegment(a.lastX, a.lastY, w.x, w.y);
          a.lastX = w.x;
          a.lastY = w.y;
        }
        this.schedule();
        break;
      }
      case 'laser': {
        const events = this.samples(e);
        for (const ce of events) {
          const w = this.toWorld(ce);
          this.laser.push({ x: w.x, y: w.y, t: performance.now() });
        }
        if (this.laser.length > 600) this.laser.splice(0, this.laser.length - 600);
        this.schedule();
        break;
      }
      case 'pan': {
        const cam = this.store.camera;
        cam.x = a.camX - (p.x - a.startX) / cam.zoom;
        cam.y = a.camY - (p.y - a.startY) / cam.zoom;
        this.cameraChanged();
        break;
      }
      case 'marquee':
        this.marquee = normalizeRect(a.x0, a.y0, world.x, world.y);
        this.schedule();
        break;
      case 'lasso':
        a.pts.push(world.x, world.y);
        this.schedule();
        break;
      case 'createShape':
        this.updateShape(a, world, e.shiftKey, e.altKey);
        break;
      case 'transform':
        this.updateTransform(a, world, e);
        break;
    }
  };

  private updateHoverCursor(world: { x: number; y: number }) {
    if (this.tool !== 'select') return;
    const frame = frameForSelection(this.selectedElements());
    if (frame) {
      const handle = hitHandle(handlesFor(frame, this.store.camera), this.store.camera, world.x, world.y);
      if (handle) {
        this.host.style.cursor = CURSOR_FOR_HANDLE[handle];
        return;
      }
    }
    const hit = pickTopmost(this.store.allSorted(), world.x, world.y, 6 / this.store.camera.zoom);
    this.host.style.cursor = hit ? 'move' : 'default';
  }

  private updatePinch(a: Extract<Action, { kind: 'pinch' }>) {
    const a1 = this.pointers.get(a.ids[0]);
    const b1 = this.pointers.get(a.ids[1]);
    if (!a1 || !b1) return;
    const distNow = Math.hypot(a1.x - b1.x, a1.y - b1.y) || 1;
    const midX = (a1.x + b1.x) / 2;
    const midY = (a1.y + b1.y) / 2;
    const cam = this.store.camera;
    cam.zoom = clamp((a.startZoom * distNow) / a.startDist, MIN_ZOOM, MAX_ZOOM);
    cam.x = a.worldMidX - midX / cam.zoom;
    cam.y = a.worldMidY - midY / cam.zoom;
    this.cameraChanged();
  }

  /**
   * Ajoute un échantillon au tracé en cours.
   *
   * Le lissage est un filtre exponentiel en deux étages plutôt qu'un seul :
   * à retard équivalent, la cascade coupe bien plus franchement le tremblement
   * de la main, qui est une oscillation rapide de faible amplitude.
   */
  private extendDraw(x: number, y: number, pressure: number) {
    if (!this.live || !this.smoothA || !this.smoothB) return;
    this.lastRaw = { x, y, p: pressure };
    const amount = this.settings.tablet.smoothing ? cascadeAmount(this.settings.tablet.streamline) : 0;

    const [ax, ay, ap] = streamlinePoint(
      this.smoothA.x, this.smoothA.y, this.smoothA.p,
      x, y, pressure,
      amount,
    );
    this.smoothA = { x: ax, y: ay, p: ap };

    const [sx, sy, sp] = streamlinePoint(
      this.smoothB.x, this.smoothB.y, this.smoothB.p,
      ax, ay, ap,
      amount,
    );
    this.smoothB = { x: sx, y: sy, p: sp };

    const pts = this.live.points;
    const n = pts.length;
    const minStep = 0.7 / this.store.camera.zoom;
    if (n >= 3 && Math.hypot(sx - pts[n - 3], sy - pts[n - 2]) < minStep) {
      // Trop proche du point précédent : on met simplement la pression à jour.
      pts[n - 1] = sp;
      return;
    }
    pts.push(sx, sy, sp);
  }

  private updateShape(a: Extract<Action, { kind: 'createShape' }>, world: { x: number; y: number }, shift: boolean, alt: boolean) {
    const el = this.store.get(a.id) as ShapeElement | undefined;
    if (!el) return;
    const isLine = el.shape === 'line' || el.shape === 'arrow';

    let x1 = world.x;
    let y1 = world.y;
    if (shift) {
      if (isLine) {
        const dx = x1 - a.x0;
        const dy = y1 - a.y0;
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        x1 = a.x0 + Math.cos(angle) * len;
        y1 = a.y0 + Math.sin(angle) * len;
      } else {
        const side = Math.max(Math.abs(x1 - a.x0), Math.abs(y1 - a.y0));
        x1 = a.x0 + Math.sign(x1 - a.x0 || 1) * side;
        y1 = a.y0 + Math.sign(y1 - a.y0 || 1) * side;
      }
    }

    if (isLine) {
      const minX = Math.min(a.x0, x1);
      const minY = Math.min(a.y0, y1);
      this.store.update<ShapeElement>(a.id, {
        x: minX,
        y: minY,
        w: Math.max(Math.abs(x1 - a.x0), 1),
        h: Math.max(Math.abs(y1 - a.y0), 1),
        pts: [a.x0 - minX, a.y0 - minY, x1 - minX, y1 - minY],
      });
    } else {
      const rect = alt
        ? normalizeRect(a.x0 - (x1 - a.x0), a.y0 - (y1 - a.y0), x1, y1)
        : normalizeRect(a.x0, a.y0, x1, y1);
      this.store.update(a.id, { x: rect.x, y: rect.y, w: Math.max(rect.w, 1), h: Math.max(rect.h, 1) });
    }
    this.schedule();
  }

  private updateTransform(a: Extract<Action, { kind: 'transform' }>, world: { x: number; y: number }, e: PointerEvent) {
    const s = a.session;
    a.moved = true;
    this.guides = [];

    if (s.kind === 'move') {
      let dx = world.x - s.startX;
      let dy = world.y - s.startY;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (this.settings.snapToObjects && !e.altKey) {
        const box = unionRects([...s.originals.values()].map(elementBounds));
        if (box) {
          const moved: Rect = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
          const others = this.store.allSorted().filter((el) => !s.originals.has(el.id));
          const snap = computeSnap(moved, others, 7 / this.store.camera.zoom);
          dx += snap.dx;
          dy += snap.dy;
          this.guides = snap.guides;
        }
      }
      applyMove(this.store, s, dx, dy);
    } else if (s.kind === 'resize') {
      applyResize(this.store, s, world.x, world.y, { keepAspect: e.shiftKey, fromCenter: e.altKey });
    } else {
      applyRotate(this.store, s, world.x, world.y, e.shiftKey);
    }
    this.text.update(this.store.get(this.text.activeId ?? ''), this.store.camera);
    this.schedule();
  }

  private eraseSegment(ax: number, ay: number, bx: number, by: number) {
    const radius = this.style.eraserSize / 2;
    const pointMode = this.style.eraserMode === 'point';
    for (const el of [...this.store.allSorted()].reverse()) {
      if (el.locked) continue;
      if (!segmentHitsElement(el, ax, ay, bx, by, radius)) continue;

      if (!pointMode || el.type !== 'stroke') {
        this.store.remove(el.id);
        continue;
      }

      const stroke = el as StrokeElement;
      const runs = eraseFromStroke(stroke, bx, by, radius);
      if (!runs) continue;
      this.store.remove(stroke.id);
      for (const run of runs) {
        const world: number[] = [];
        for (let i = 0; i < run.length; i += 3) {
          world.push(run[i] + stroke.x, run[i + 1] + stroke.y, run[i + 2]);
        }
        const piece = strokeFromWorldPoints({
          brush: stroke.brush,
          color: stroke.color,
          size: stroke.size,
          // La densification faite par la gomme est réduite après coup.
          world: simplifyStroke(world, Math.max(0.35, stroke.size * 0.06)),
          z: stroke.z,
        });
        if (piece) this.store.add(piece);
      }
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    const a = this.action;
    if (!a) return;

    if (a.kind === 'pinch') {
      if (this.pointers.size < 2) this.action = null;
      return;
    }
    if (a.pointerId !== e.pointerId) return;

    switch (a.kind) {
      case 'draw':
        this.finishDraw();
        break;
      case 'erase':
        this.store.commit('Gommer', this.selection);
        break;
      case 'pan':
        this.updateCursor();
        break;
      case 'marquee': {
        if (this.marquee) {
          const found = elementsInRect(this.store.allSorted(), this.marquee, false).map((el) => el.id);
          this.setSelection(a.additive ? [...new Set([...this.selection, ...found])] : found);
        }
        this.marquee = null;
        break;
      }
      case 'lasso': {
        const found = elementsInLasso(this.store.allSorted(), a.pts).map((el) => el.id);
        this.setSelection(a.additive ? [...new Set([...this.selection, ...found])] : found);
        this.setTool('select');
        break;
      }
      case 'createShape': {
        const el = this.store.get(a.id);
        if (el && el.w < 4 && el.h < 4) {
          // Simple clic : on annule la forme dégénérée.
          this.store.abort();
        } else {
          this.store.commit('Forme', [a.id]);
          this.setTool('select');
          this.setSelection([a.id]);
        }
        break;
      }
      case 'transform':
        if (a.moved) this.store.commit(a.session.kind === 'move' ? 'Déplacer' : 'Transformer', this.selection);
        else this.store.abort();
        this.guides = [];
        break;
      case 'laser':
        break;
    }

    this.action = null;
    this.schedule();
  };

  private cancelAction() {
    if (!this.action) return;
    if (this.store.inTransaction) this.store.abort();
    this.live = null;
    this.marquee = null;
    this.guides = [];
    this.action = null;
    this.schedule();
  }

  private finishDraw() {
    // Le filtre retarde le tracé de quelques échantillons : on le laisse
    // converger vers la position réelle du stylet au lever, sinon le trait
    // s'arrête avant la pointe.
    if (this.live && this.lastRaw && this.settings.tablet.smoothing) {
      const end = this.lastRaw;
      for (let i = 0; i < 24; i++) this.extendDraw(end.x, end.y, end.p);
      // La convergence est géométrique : elle n'atteint jamais tout à fait la
      // cible. On pose le point final exactement où le stylet s'est levé.
      const pts = this.live.points;
      const n = pts.length;
      if (n >= 3 && Math.hypot(end.x - pts[n - 3], end.y - pts[n - 2]) > 0.4) {
        pts.push(end.x, end.y, pts[n - 1]);
      }
    }

    const live = this.live;
    this.live = null;
    this.smoothA = null;
    this.smoothB = null;
    this.lastRaw = null;
    if (!live) return;

    // Le filtre temps réel en cascade a déjà fait le travail pendant la
    // capture (voir extendDraw) ; une seconde passe ajoutait plus de
    // distorsion qu'elle n'en retirait une fois combinée à la simplification
    // ci-dessous, qui reste la seule étape de post-traitement.
    const simplified = simplifyStroke(live.points, Math.max(0.35, live.size * 0.06));
    const el = strokeFromWorldPoints({
      brush: live.brush,
      color: live.color,
      size: live.size,
      world: simplified,
      z: this.store.nextZ(),
    });
    if (!el) return;

    this.store.begin(this.selection);
    if (this.settings.inkToShape && (live.brush === 'pen' || live.brush === 'marker')) {
      const rec = recognizeShape(el);
      if (rec) {
        const shape = makeShape({
          shape: rec.shape,
          x: rec.x,
          y: rec.y,
          w: rec.w,
          h: rec.h,
          stroke: live.color,
          fill: 'transparent',
          strokeWidth: Math.max(1.5, live.size * 0.9),
          dash: 'solid',
          z: el.z,
          pts: rec.pts,
          font: this.style.font,
          textColor: live.color,
        });
        this.store.add(shape);
        this.store.commit('Forme reconnue', []);
        return;
      }
    }
    this.store.add(el);
    this.store.commit('Tracé', []);
  }

  /* ------------------------------------------------- double-clic, texte */

  private onDoubleClick = (e: MouseEvent) => {
    const world = this.toWorld(e);
    const hit = pickTopmost(this.store.allSorted(), world.x, world.y, 6 / this.store.camera.zoom);
    if (!hit) {
      if (this.tool === 'select') this.addTextAt(world.x, world.y);
      return;
    }
    if (hit.type === 'note' || hit.type === 'text' || hit.type === 'shape') {
      this.setTool('select');
      this.setSelection([hit.id]);
      this.store.begin([hit.id]);
      this.text.open(hit as NoteElement | TextElement | ShapeElement, this.store.camera, true);
      this.schedule();
    }
  };

  private onTextInput(value: string) {
    const id = this.text.activeId;
    if (!id) return;
    if (!this.store.inTransaction) this.store.begin([id]);
    const el = this.store.get(id);
    if (!el) return;
    if (el.type === 'text') {
      const updated = { ...el, text: value } as TextElement;
      this.store.update(id, { text: value, h: textHeightFor(updated) });
    } else {
      this.store.update(id, { text: value });
    }
    this.text.update(this.store.get(id), this.store.camera);
    this.schedule();
  }

  private onTextCommit() {
    if (this.store.inTransaction) this.store.commit('Texte', this.selection);
    this.invalidateScene();
  }

  /* ---------------------------------------------------------- molette */

  /**
   * La molette zoome par défaut, en continu et centré sur le curseur — un
   * cran de souris standard (deltaY ≈ ±100) ne doit produire qu'un léger
   * ajustement, jamais un saut. Ctrl/Cmd+molette (pincement de trackpad) suit
   * exactement le même calcul, donc aucun cas particulier n'est nécessaire.
   *
   * Maj+molette et un vrai balayage horizontal de trackpad continuent de
   * déplacer la vue : ce sont les seules façons de paner de côté à la molette
   * une fois que le défilement vertical sert au zoom.
   */
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.toLocalScreen(e);
    const cam = this.store.camera;

    if (e.shiftKey) {
      cam.x += (e.deltaY || e.deltaX) / cam.zoom;
      this.cameraChanged();
      return;
    }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
      cam.x += e.deltaX / cam.zoom;
      cam.y += e.deltaY / cam.zoom;
      this.cameraChanged();
      return;
    }

    const delta = clamp(e.deltaY, -240, 240);
    this.zoomAt(p.x, p.y, Math.exp(-delta * 0.001));
  };

  private onDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const world = this.toWorld(e as unknown as MouseEvent);
    void this.addImageFile(file, world.x, world.y);
  };

  private onPaste = (e: ClipboardEvent) => {
    if (isTypingTarget(e.target)) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        void this.addImageFile(file);
        return;
      }
    }
    const text = e.clipboardData?.getData('text/plain');
    if (text && this.clipboard.length === 0) {
      e.preventDefault();
      const center = screenToWorld(this.store.camera, this.vw / 2, this.vh / 2);
      const el = makeText(center.x, center.y, this.style.textColor, this.style.font, this.style.fontSize, this.store.nextZ());
      el.text = text;
      el.h = textHeightFor(el);
      this.store.begin([]);
      this.store.add(el);
      this.store.commit('Coller le texte', [el.id]);
      this.setSelection([el.id]);
      return;
    }
    if (this.clipboard.length) {
      e.preventDefault();
      this.pasteClipboard();
    }
  };

  /* --------------------------------------------------------- clavier */

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      this.spaceDown = false;
      this.updateCursor();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;

    if (e.code === 'Space' && !e.repeat) {
      this.spaceDown = true;
      this.host.style.cursor = 'grab';
      return;
    }

    if (mod) {
      switch (e.key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          if (e.shiftKey) this.redo();
          else this.undo();
          return;
        case 'y':
          e.preventDefault();
          this.redo();
          return;
        case 'a':
          e.preventDefault();
          this.selectAll();
          return;
        case 'd':
          e.preventDefault();
          this.duplicateSelection();
          return;
        case 'c':
          this.copySelection();
          return;
        case 'x':
          this.cutSelection();
          return;
        case ']':
          e.preventDefault();
          this.bringToFront();
          return;
        case '[':
          e.preventDefault();
          this.sendToBack();
          return;
      }
      return;
    }

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.deleteSelection();
        return;
      case 'Escape':
        this.cancelAction();
        this.setSelection([]);
        return;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!this.selection.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 20 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        this.nudge(dx, dy);
        return;
      }
      case 'Enter': {
        const el = this.selectedElements()[0];
        if (el && (el.type === 'note' || el.type === 'text' || el.type === 'shape')) {
          e.preventDefault();
          this.store.begin([el.id]);
          this.text.open(el, this.store.camera, true);
          this.schedule();
        }
        return;
      }
    }

    const shortcuts: Record<string, ToolId> = {
      v: 'select',
      l: 'lasso',
      b: 'pen',
      f: 'marker',
      h: 'highlighter',
      c: 'pencil',
      e: 'eraser',
      r: 'shape',
      n: 'note',
      t: 'text',
      x: 'laser',
    };
    const tool = shortcuts[e.key.toLowerCase()];
    if (tool) {
      this.setTool(tool);
      return;
    }
    if (e.key === '0') this.zoomReset();
    if (e.key === '1') this.zoomToFit();
    if (e.key === '+' || e.key === '=') this.zoomIn();
    if (e.key === '-') this.zoomOut();
  };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

function defaultStyle(store: BoardStore): StyleState {
  const paper = PAPERS[store.paper];
  return {
    ink: paper.defaultInk,
    brush: 'pen',
    sizes: {
      pen: BRUSHES.pen.defaultSize,
      marker: BRUSHES.marker.defaultSize,
      highlighter: BRUSHES.highlighter.defaultSize,
      pencil: BRUSHES.pencil.defaultSize,
    },
    eraserSize: 28,
    eraserMode: 'stroke',
    shape: 'rect',
    shapeStroke: paper.defaultInk,
    shapeFill: 'transparent',
    shapeStrokeWidth: 2.5,
    dash: 'solid',
    noteColor: '#ffd965',
    font: 'sans',
    fontSize: 24,
    textColor: paper.defaultInk,
  };
}

export type { DashKind, FontKind, ShapeKind };
