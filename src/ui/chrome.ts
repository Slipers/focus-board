import type { BackgroundKind, BrushKind, DashKind, FontKind, PaperKind, ShapeKind, ToolId } from '../core/types';
import type { Editor } from '../editor/editor';
import { BRUSHES } from '../core/brushes';
import { FONT_LABELS, INK_COLORS, NOTE_COLORS, PAPERS } from '../core/palette';
import { BACKGROUND_ICONS, ICONS, SHAPE_ICONS } from './icons';
import { clear, dismissOnOutside, h, iconButton } from './dom';

export interface AppBridge {
  newBoard(): void;
  openLibrary(): void;
  openSettings(): void;
  openShortcuts(): void;
  renameBoard(name: string): void;
  exportPNG(selectionOnly: boolean, transparent: boolean): void;
  exportSVG(): void;
  exportJSON(): void;
  importBoard(): void;
  toggleTheme(): void;
  currentTheme(): 'light' | 'dark';
}

interface ToolSpec {
  id: ToolId;
  icon: string;
  label: string;
}

const TOOL_GROUPS: ToolSpec[][] = [
  [
    { id: 'select', icon: ICONS.select, label: 'Sélection · V' },
    { id: 'lasso', icon: ICONS.lasso, label: 'Lasso · L' },
    { id: 'pan', icon: ICONS.hand, label: 'Main · Espace' },
  ],
  [
    { id: 'pen', icon: ICONS.pen, label: 'Stylo · B' },
    { id: 'marker', icon: ICONS.marker, label: 'Feutre · F' },
    { id: 'highlighter', icon: ICONS.highlighter, label: 'Surligneur · H' },
    { id: 'pencil', icon: ICONS.pencil, label: 'Crayon · C' },
    { id: 'eraser', icon: ICONS.eraser, label: 'Gomme · E' },
  ],
  [
    { id: 'shape', icon: ICONS.shape, label: 'Forme · R' },
    { id: 'note', icon: ICONS.note, label: 'Note · N' },
    { id: 'text', icon: ICONS.text, label: 'Texte · T' },
    { id: 'image', icon: ICONS.image, label: 'Image' },
    { id: 'laser', icon: ICONS.laser, label: 'Pointeur laser · X' },
  ],
];

const BACKGROUNDS: Array<{ id: BackgroundKind; label: string }> = [
  { id: 'blank', label: 'Uni' },
  { id: 'grid', label: 'Quadrillage' },
  { id: 'dots', label: 'Points' },
  { id: 'lines', label: 'Lignes' },
  { id: 'iso', label: 'Isométrique' },
];

const PAPER_LABELS: Array<{ id: PaperKind; label: string }> = [
  { id: 'white', label: 'Blanc' },
  { id: 'cream', label: 'Crème' },
  { id: 'slate', label: 'Ardoise' },
  { id: 'black', label: 'Noir' },
];

export class Chrome {
  private toolButtons = new Map<ToolId, HTMLButtonElement>();
  private stylePanel = h('div', { class: 'style-panel' });
  private zoomLabel = h('button', { class: 'zoom-label', title: 'Taille réelle · Ctrl+0' });
  private nameInput = h('input', { class: 'board-name', attrs: { spellcheck: 'false' } });
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;

  constructor(private root: HTMLElement, private editor: Editor, private app: AppBridge) {
    this.build();
    editor.on('tool', () => this.refresh());
    editor.on('selection', () => this.refresh());
    editor.on('change', () => this.refreshHistory());
    editor.on('camera', () => this.refreshZoom());
    this.refresh();
  }

  /* ------------------------------------------------------------ layout */

  private build() {
    this.root.prepend(this.buildTopbar());
    this.root.append(this.buildToolbar(), this.stylePanel, this.buildZoomBar());
  }

  private buildTopbar(): HTMLElement {
    this.nameInput.addEventListener('change', () => this.app.renameBoard(this.nameInput.value.trim() || 'Sans titre'));
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.nameInput.blur();
    });

    this.undoBtn = iconButton(ICONS.undo, 'Annuler · Ctrl+Z', () => this.editor.undo());
    this.redoBtn = iconButton(ICONS.redo, 'Rétablir · Ctrl+Maj+Z', () => this.editor.redo());

    const bgBtn = iconButton(ICONS.grid, 'Fond du tableau', () => this.openBackgroundPopover(bgBtn));
    const exportBtn = iconButton(ICONS.download, 'Exporter', () => this.openExportPopover(exportBtn));

    return h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'topbar-left' },
        h('div', { class: 'brand', text: 'FocUs' }),
        this.nameInput,
      ),
      h(
        'div',
        { class: 'topbar-right' },
        this.undoBtn,
        this.redoBtn,
        h('span', { class: 'divider' }),
        iconButton(ICONS.plus, 'Nouveau tableau · Ctrl+N', () => this.app.newBoard()),
        iconButton(ICONS.library, 'Bibliothèque · Ctrl+O', () => this.app.openLibrary()),
        h('span', { class: 'divider' }),
        bgBtn,
        exportBtn,
        h('span', { class: 'divider' }),
        iconButton(ICONS.keyboard, 'Raccourcis · F1', () => this.app.openShortcuts()),
        iconButton(
          this.app.currentTheme() === 'dark' ? ICONS.sun : ICONS.moon,
          'Thème clair / sombre · Ctrl+D',
          () => this.app.toggleTheme(),
          'theme-btn',
        ),
        iconButton(ICONS.settings, 'Réglages', () => this.app.openSettings()),
      ),
    );
  }

  private buildToolbar(): HTMLElement {
    const bar = h('nav', { class: 'toolbar' });
    TOOL_GROUPS.forEach((group, i) => {
      if (i > 0) bar.append(h('span', { class: 'tool-sep' }));
      for (const spec of group) {
        const btn = h('button', {
          class: 'tool-btn',
          title: spec.label,
          html: spec.icon,
          attrs: { 'aria-label': spec.label },
          on: {
            click: () => {
              if (spec.id === 'image') this.pickImage();
              else this.editor.setTool(spec.id);
            },
          },
        });
        this.toolButtons.set(spec.id, btn);
        bar.append(btn);
      }
    });
    return bar;
  }

  private buildZoomBar(): HTMLElement {
    this.zoomLabel.addEventListener('click', () => this.editor.zoomReset());
    return h(
      'div',
      { class: 'zoombar' },
      iconButton(ICONS.zoomOut, 'Zoom arrière · Ctrl+-', () => this.editor.zoomOut()),
      this.zoomLabel,
      iconButton(ICONS.zoomIn, 'Zoom avant · Ctrl++', () => this.editor.zoomIn()),
      iconButton(ICONS.fit, 'Ajuster au contenu · Ctrl+1', () => this.editor.zoomToFit()),
    );
  }

  private pickImage() {
    const input = h('input', { type: 'file' });
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void this.editor.addImageFile(file);
    };
    input.click();
  }

  /* ----------------------------------------------------------- refresh */

  refresh() {
    for (const [id, btn] of this.toolButtons) {
      btn.classList.toggle('active', this.editor.tool === id);
    }
    this.refreshHistory();
    this.refreshZoom();
    this.renderStylePanel();
  }

  refreshBoardName(name: string) {
    if (document.activeElement !== this.nameInput) this.nameInput.value = name;
  }

  private refreshHistory() {
    this.undoBtn.disabled = !this.editor.store.canUndo;
    this.redoBtn.disabled = !this.editor.store.canRedo;
  }

  private refreshZoom() {
    this.zoomLabel.textContent = `${Math.round(this.editor.store.camera.zoom * 100)} %`;
  }

  refreshTheme() {
    const btn = this.root.querySelector('.theme-btn');
    if (btn) btn.innerHTML = this.app.currentTheme() === 'dark' ? ICONS.sun : ICONS.moon;
  }

  /* ------------------------------------------------------- panneau style */

  private renderStylePanel() {
    const panel = this.stylePanel;
    clear(panel);
    const tool = this.editor.tool;
    const selection = this.editor.selectedElements();

    if (tool === 'select' && selection.length > 0) {
      this.buildSelectionPanel(panel);
      panel.hidden = false;
      return;
    }

    switch (tool) {
      case 'pen':
      case 'marker':
      case 'highlighter':
      case 'pencil':
        this.buildBrushPanel(panel, tool);
        break;
      case 'eraser':
        this.buildEraserPanel(panel);
        break;
      case 'shape':
        this.buildShapePanel(panel);
        break;
      case 'note':
        this.buildNotePanel(panel);
        break;
      case 'text':
        this.buildTextPanel(panel);
        break;
      default:
        panel.hidden = true;
        return;
    }
    panel.hidden = false;
  }

  private group(label?: string, ...children: HTMLElement[]): HTMLElement {
    return h(
      'div',
      { class: 'style-group' },
      label ? h('span', { class: 'style-label', text: label }) : null,
      h('div', { class: 'style-row' }, ...(children as HTMLElement[])),
    );
  }

  private colorSwatches(current: string, onPick: (c: string) => void, colors = INK_COLORS): HTMLElement[] {
    return colors.map((c) =>
      h('button', {
        class: `swatch${c.value === current ? ' active' : ''}`,
        title: c.name,
        style: { background: c.value },
        on: { click: () => onPick(c.value) },
      }),
    );
  }

  private sizeDots(sizes: number[], current: number, onPick: (s: number) => void): HTMLElement[] {
    const max = Math.max(...sizes);
    return sizes.map((s) =>
      h(
        'button',
        {
          class: `size-btn${s === current ? ' active' : ''}`,
          title: `${s} px`,
          on: { click: () => onPick(s) },
        },
        h('span', {
          class: 'size-dot',
          style: {
            width: `${6 + (s / max) * 14}px`,
            height: `${6 + (s / max) * 14}px`,
          },
        }),
      ),
    );
  }

  private segmented<T extends string>(
    options: Array<{ id: T; label?: string; icon?: string; title?: string }>,
    current: T,
    onPick: (v: T) => void,
  ): HTMLElement {
    return h(
      'div',
      { class: 'segmented' },
      ...options.map((o) =>
        h('button', {
          class: `seg-btn${o.id === current ? ' active' : ''}`,
          title: o.title ?? o.label ?? o.id,
          text: o.icon ? undefined : o.label ?? o.id,
          html: o.icon,
          on: { click: () => onPick(o.id) },
        }),
      ),
    );
  }

  private buildBrushPanel(panel: HTMLElement, brush: BrushKind) {
    const style = this.editor.style;
    panel.append(
      this.group('Couleur', ...this.colorSwatches(style.ink, (c) => this.editor.setStyle({ ink: c }))),
      this.group(
        'Épaisseur',
        ...this.sizeDots(BRUSHES[brush].sizes, style.sizes[brush], (s) => this.editor.setBrushSize(s)),
      ),
    );
    if (brush === 'pen' || brush === 'marker') {
      panel.append(
        this.group(
          'Assistance',
          h(
            'button',
            {
              class: `chip${this.editor.settings.inkToShape ? ' active' : ''}`,
              title: 'Transforme un cercle ou un rectangle tracé à main levée en forme nette',
              text: 'Formes auto',
              on: {
                click: () => {
                  this.editor.settings.inkToShape = !this.editor.settings.inkToShape;
                  this.refresh();
                },
              },
            },
          ),
        ),
      );
    }
  }

  private buildEraserPanel(panel: HTMLElement) {
    const style = this.editor.style;
    panel.append(
      this.group(
        'Mode',
        this.segmented(
          [
            { id: 'stroke' as const, label: 'Trait entier' },
            { id: 'point' as const, label: 'Ponctuelle' },
          ],
          style.eraserMode,
          (v) => this.editor.setStyle({ eraserMode: v }),
        ),
      ),
      this.group('Taille', ...this.sizeDots([14, 28, 48, 80], style.eraserSize, (s) => this.editor.setStyle({ eraserSize: s }))),
    );
  }

  private buildShapePanel(panel: HTMLElement) {
    const style = this.editor.style;
    const shapes: ShapeKind[] = ['rect', 'ellipse', 'diamond', 'triangle', 'star', 'line', 'arrow'];
    panel.append(
      this.group(
        'Forme',
        this.segmented(
          shapes.map((s) => ({ id: s, icon: SHAPE_ICONS[s], title: s })),
          style.shape,
          (v) => this.editor.setStyle({ shape: v }),
        ),
      ),
      this.group('Contour', ...this.colorSwatches(style.shapeStroke, (c) => this.editor.setStyle({ shapeStroke: c }))),
      this.group(
        'Remplissage',
        h('button', {
          class: `swatch swatch-none${style.shapeFill === 'transparent' ? ' active' : ''}`,
          title: 'Aucun',
          on: { click: () => this.editor.setStyle({ shapeFill: 'transparent' }) },
        }),
        ...this.colorSwatches(style.shapeFill, (c) => this.editor.setStyle({ shapeFill: c }), NOTE_COLORS),
      ),
      this.group(
        'Trait',
        ...this.sizeDots([1.5, 2.5, 4, 7, 11], style.shapeStrokeWidth, (s) => this.editor.setStyle({ shapeStrokeWidth: s })),
        this.segmented(
          [
            { id: 'solid' as DashKind, label: '——' },
            { id: 'dashed' as DashKind, label: '- -' },
            { id: 'dotted' as DashKind, label: '···' },
          ],
          style.dash,
          (v) => this.editor.setStyle({ dash: v }),
        ),
      ),
    );
  }

  private buildNotePanel(panel: HTMLElement) {
    const style = this.editor.style;
    panel.append(
      this.group('Couleur', ...this.colorSwatches(style.noteColor, (c) => this.editor.setStyle({ noteColor: c }), NOTE_COLORS)),
      this.group('Police', this.fontPicker(style.font, (f) => this.editor.setStyle({ font: f }))),
    );
  }

  private buildTextPanel(panel: HTMLElement) {
    const style = this.editor.style;
    panel.append(
      this.group('Couleur', ...this.colorSwatches(style.textColor, (c) => this.editor.setStyle({ textColor: c }))),
      this.group('Police', this.fontPicker(style.font, (f) => this.editor.setStyle({ font: f }))),
      this.group('Taille', ...this.sizeDots([16, 24, 34, 48, 72], style.fontSize, (s) => this.editor.setStyle({ fontSize: s }))),
    );
  }

  private fontPicker(current: FontKind, onPick: (f: FontKind) => void): HTMLElement {
    const fonts: FontKind[] = ['sans', 'serif', 'mono', 'hand'];
    return this.segmented(
      fonts.map((f) => ({ id: f, label: FONT_LABELS[f] })),
      current,
      onPick,
    );
  }

  private buildSelectionPanel(panel: HTMLElement) {
    const selection = this.editor.selectedElements();
    const first = selection[0];
    const currentColor =
      first.type === 'stroke' ? first.color
      : first.type === 'shape' ? first.stroke
      : first.type === 'note' ? first.color
      : first.type === 'text' ? first.color
      : '';

    const hasNote = selection.some((e) => e.type === 'note');
    panel.append(
      this.group(
        'Couleur',
        ...this.colorSwatches(currentColor, (c) => this.editor.applyColor(c), hasNote ? NOTE_COLORS : INK_COLORS),
      ),
      this.group(
        'Disposition',
        iconButton(ICONS.front, 'Premier plan · Ctrl+]', () => this.editor.bringToFront()),
        iconButton(ICONS.back, 'Arrière-plan · Ctrl+[', () => this.editor.sendToBack()),
        iconButton(ICONS.copy, 'Dupliquer · Ctrl+D', () => this.editor.duplicateSelection()),
        iconButton(ICONS.trash, 'Supprimer · Suppr', () => this.editor.deleteSelection(), 'danger'),
      ),
      h('span', { class: 'style-count', text: `${selection.length} élément${selection.length > 1 ? 's' : ''}` }),
    );
  }

  /* ------------------------------------------------------ popover fond */

  openBackgroundPopover(anchor: HTMLElement) {
    const store = this.editor.store;
    const panel = h('div', { class: 'popover' });
    const rebuild = () => {
      clear(panel);
      panel.append(
        h('p', { class: 'popover-title', text: 'Motif' }),
        h(
          'div',
          { class: 'popover-grid' },
          ...BACKGROUNDS.map((b) =>
            h('button', {
              class: `pick${store.background === b.id ? ' active' : ''}`,
              title: b.label,
              html: `${BACKGROUND_ICONS[b.id]}<span>${b.label}</span>`,
              on: {
                click: () => {
                  this.editor.setBackground(b.id);
                  rebuild();
                },
              },
            }),
          ),
        ),
        h('p', { class: 'popover-title', text: 'Papier' }),
        h(
          'div',
          { class: 'popover-grid' },
          ...PAPER_LABELS.map((p) =>
            h('button', {
              class: `pick${store.paper === p.id ? ' active' : ''}`,
              title: p.label,
              html: `<span class="paper-chip" style="background:${PAPERS[p.id].bg};border-color:${PAPERS[p.id].line}"></span><span>${p.label}</span>`,
              on: {
                click: () => {
                  this.editor.setPaper(p.id);
                  rebuild();
                },
              },
            }),
          ),
        ),
      );
    };
    rebuild();
    this.mountPopover(panel, anchor);
  }

  openExportPopover(anchor: HTMLElement) {
    const hasSelection = this.editor.selection.length > 0;
    let close = () => {};
    const panel = h(
      'div',
      { class: 'popover' },
      h('p', { class: 'popover-title', text: 'Exporter' }),
      h('button', { class: 'popover-item', text: 'Image PNG', on: { click: () => { close(); this.app.exportPNG(false, false); } } }),
      h('button', { class: 'popover-item', text: 'PNG fond transparent', on: { click: () => { close(); this.app.exportPNG(false, true); } } }),
      hasSelection
        ? h('button', { class: 'popover-item', text: 'PNG de la sélection', on: { click: () => { close(); this.app.exportPNG(true, true); } } })
        : null,
      h('button', { class: 'popover-item', text: 'Vectoriel SVG', on: { click: () => { close(); this.app.exportSVG(); } } }),
      h('span', { class: 'popover-sep' }),
      h('button', { class: 'popover-item', text: 'Fichier .focusboard', on: { click: () => { close(); this.app.exportJSON(); } } }),
      h('button', { class: 'popover-item', text: 'Importer un .focusboard…', on: { click: () => { close(); this.app.importBoard(); } } }),
    );
    close = this.mountPopover(panel, anchor);
  }

  private mountPopover(panel: HTMLElement, anchor: HTMLElement): () => void {
    document.body.append(panel);
    const rect = anchor.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 8}px`;
    panel.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
    return dismissOnOutside(panel, () => panel.remove());
  }
}
