import type { AnyElement, Camera, ID, NoteElement, ShapeElement, TextElement } from '../core/types';
import { FONTS } from '../core/palette';
import { LINE_HEIGHT, fitFontSize, layoutText } from '../core/text';
import { worldToScreen } from '../core/geom';

type Editable = NoteElement | TextElement | ShapeElement;

export interface InlineEditorHooks {
  onInput: (text: string) => void;
  onCommit: () => void;
}

/**
 * Éditeur de texte en superposition.
 *
 * Un vrai `<textarea>` posé au-dessus du canvas : on hérite gratuitement du
 * curseur système, de la sélection, du correcteur orthographique, du clavier
 * virtuel et de la saisie manuscrite Windows Ink.
 */
export class InlineTextEditor {
  private area: HTMLTextAreaElement;
  private target: Editable | null = null;
  private cam: Camera | null = null;

  constructor(host: HTMLElement, private hooks: InlineEditorHooks) {
    this.area = document.createElement('textarea');
    this.area.className = 'inline-text';
    this.area.spellcheck = true;
    this.area.hidden = true;
    this.area.addEventListener('input', () => {
      this.hooks.onInput(this.area.value);
      this.reflow();
    });
    this.area.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.area.addEventListener('wheel', (e) => e.stopPropagation());
    this.area.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        this.close();
      }
    });
    this.area.addEventListener('blur', () => this.close());
    host.appendChild(this.area);
  }

  get activeId(): ID | null {
    return this.target?.id ?? null;
  }

  open(el: Editable, cam: Camera, selectAll = false) {
    this.target = el;
    this.cam = cam;
    this.area.value = el.type === 'shape' ? el.text : el.text;
    this.area.hidden = false;
    this.reflow();
    this.area.focus({ preventScroll: true });
    if (selectAll) this.area.select();
    else this.area.setSelectionRange(this.area.value.length, this.area.value.length);
  }

  /** Suit l'élément quand il change (frappe, zoom, déplacement de la vue). */
  update(el: AnyElement | undefined, cam: Camera) {
    if (!this.target || !el) return;
    this.target = el as Editable;
    this.cam = cam;
    this.reflow();
  }

  close() {
    if (!this.target) return;
    this.target = null;
    this.area.hidden = true;
    this.area.value = '';
    this.hooks.onCommit();
  }

  private reflow() {
    const el = this.target;
    const cam = this.cam;
    if (!el || !cam) return;
    const z = cam.zoom;
    const center = worldToScreen(cam, el.x + el.w / 2, el.y + el.h / 2);
    const s = this.area.style;

    s.left = `${center.x}px`;
    s.top = `${center.y}px`;
    s.width = `${el.w * z}px`;
    s.height = `${el.h * z}px`;
    s.transform = `translate(-50%, -50%) rotate(${el.angle}rad)`;
    s.lineHeight = String(LINE_HEIGHT);
    s.fontFamily = FONTS[el.font];

    if (el.type === 'note') {
      const pad = Math.max(10, Math.min(el.w, el.h) * 0.1);
      const boxW = el.w - pad * 2;
      const boxH = el.h - pad * 2;
      const size = fitFontSize(this.area.value || el.text, el.font, boxW, boxH, el.fontSize);
      const layout = layoutText(this.area.value || ' ', el.font, size, boxW);
      s.fontSize = `${size * z}px`;
      s.color = el.textColor;
      s.textAlign = el.align;
      s.padding = `${(pad + Math.max(0, (boxH - layout.height) / 2)) * z}px ${pad * z}px`;
    } else if (el.type === 'shape') {
      const pad = 12;
      const layout = layoutText(this.area.value || ' ', el.font, el.fontSize, Math.max(20, el.w - pad * 2));
      s.fontSize = `${el.fontSize * z}px`;
      s.color = el.textColor;
      s.textAlign = 'center';
      s.padding = `${Math.max(0, (el.h - layout.height) / 2) * z}px ${pad * z}px`;
    } else {
      s.fontSize = `${el.fontSize * z}px`;
      s.color = el.color;
      s.textAlign = el.align;
      s.padding = '0';
    }
  }
}
