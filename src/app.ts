import './style.css';

import type { AppSettings, BoardDoc, ID } from './core/types';
import { BoardStore, createBoardDoc } from './core/store';
import { uid } from './core/geom';
import { Editor } from './editor/editor';
import { Chrome, type AppBridge } from './ui/chrome';
import { openLibrary } from './ui/library';
import { openSettings } from './ui/settings';
import { openShortcuts } from './ui/shortcuts';
import { initUpdateCard } from './ui/update-card';
import { showModal, toast } from './ui/modal';
import { h } from './ui/dom';
import { exportPNGBase64, exportSVG, makeThumbnail } from './io/export';
import {
  deleteBoard,
  isDesktop,
  listBoards,
  onMenuCommand,
  openTextFile,
  readBoard,
  readSettings,
  revealBoardsFolder,
  saveFile,
  setNativeTheme,
  writeBoard,
  writeSettings,
} from './io/storage';

const SAVE_DEBOUNCE = 700;
const THUMB_INTERVAL = 15_000;

class App {
  private settings!: AppSettings;
  private store!: BoardStore;
  private editor!: Editor;
  private chrome!: Chrome;

  private saveTimer: number | null = null;
  private lastThumbAt = 0;
  private lastThumb: string | null = null;

  async start() {
    this.settings = await readSettings();
    this.applyTheme();

    const doc = await this.pickInitialBoard();
    this.store = new BoardStore(doc);
    this.lastThumb = doc.thumbnail ?? null;
    // Mémorisé tout de suite : la prochaine ouverture doit retomber sur ce
    // tableau même si l'utilisateur n'y a rien modifié.
    this.settings.lastBoardId = doc.id;
    void writeSettings(this.settings);

    const root = document.getElementById('app')!;
    const stage = h('div', { class: 'stage' });
    root.append(stage);

    this.editor = new Editor(stage, this.store, this.settings);
    this.chrome = new Chrome(root, this.editor, this.bridge());
    this.chrome.refreshBoardName(this.store.name);

    this.editor.on('change', () => this.scheduleSave());
    this.editor.on('camera', () => this.scheduleSave());
    this.editor.on('penFallback', () => {
      toast('Le stylet ne transmet pas de vraie pression — épaisseur simulée. Réglages → Diagnostic du stylet pour activer Windows Ink.');
    });

    onMenuCommand((command) => this.handleMenu(command));
    window.addEventListener('blur', () => void this.saveNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.saveNow();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        openShortcuts();
      }
    });

    if (!isDesktop) {
      toast('Mode navigateur : les tableaux sont stockés dans ce navigateur.');
    }
    initUpdateCard();

    if (import.meta.env.DEV) {
      // Accroche de debug : uniquement dans le serveur de développement.
      (window as unknown as { __focus: unknown }).__focus = this;
    }
  }

  get debug() {
    return { editor: this.editor, store: this.store, settings: this.settings };
  }

  private async pickInitialBoard(): Promise<BoardDoc> {
    if (this.settings.lastBoardId) {
      const doc = await readBoard(this.settings.lastBoardId);
      if (doc) return doc;
    }
    const boards = await listBoards();
    if (boards.length) {
      const doc = await readBoard(boards[0].id);
      if (doc) return doc;
    }
    const fresh = createBoardDoc('Mon premier tableau');
    await writeBoard(fresh);
    return fresh;
  }

  /* --------------------------------------------------------- sauvegarde */

  private scheduleSave() {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), SAVE_DEBOUNCE);
  }

  private async saveNow() {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    // La vignette coûte un rendu complet : on l'actualise par intervalles.
    const now = Date.now();
    if (now - this.lastThumbAt > THUMB_INTERVAL) {
      this.lastThumbAt = now;
      try {
        this.lastThumb = await makeThumbnail(this.store, this.settings.tablet);
      } catch {
        /* une vignette manquante n'empêche pas de sauvegarder */
      }
    }
    await writeBoard(this.store.toDoc(this.lastThumb));
    this.settings.lastBoardId = this.store.id;
    await writeSettings(this.settings);
  }

  /* -------------------------------------------------------- navigation */

  private async openBoardById(id: ID) {
    if (id === this.store.id) return;
    await this.saveNow();
    const doc = await readBoard(id);
    if (!doc) {
      toast('Ce tableau est introuvable.');
      return;
    }
    this.store = new BoardStore(doc);
    this.lastThumb = doc.thumbnail ?? null;
    this.lastThumbAt = 0;
    this.editor.setStore(this.store);
    this.chrome.refreshBoardName(this.store.name);
    this.chrome.refresh();
    this.settings.lastBoardId = id;
    void writeSettings(this.settings);
  }

  private async createBoard(name = 'Nouveau tableau') {
    await this.saveNow();
    const doc = createBoardDoc(name);
    doc.paper = this.store.paper;
    doc.background = this.store.background;
    await writeBoard(doc);
    await this.openBoardById(doc.id);
  }

  /* ------------------------------------------------------------ exports */

  private async doExportPNG(selectionOnly: boolean, transparent: boolean) {
    try {
      const only = selectionOnly ? this.editor.selectedElements() : undefined;
      const base64 = await exportPNGBase64(this.store, this.settings.tablet, {
        scale: 2,
        transparent,
        only,
      });
      const path = await saveFile(`${safeName(this.store.name)}.png`, base64, 'base64', [
        { name: 'Image PNG', extensions: ['png'] },
      ]);
      if (path) toast('PNG exporté.');
    } catch (err) {
      toast(`Export impossible : ${(err as Error).message}`);
    }
  }

  private async doExportSVG() {
    const svg = exportSVG(this.store, this.settings.tablet, {});
    const path = await saveFile(`${safeName(this.store.name)}.svg`, svg, 'utf8', [
      { name: 'Image vectorielle SVG', extensions: ['svg'] },
    ]);
    if (path) toast('SVG exporté.');
  }

  private async doExportJSON() {
    const doc = this.store.toDoc(this.lastThumb);
    const path = await saveFile(`${safeName(this.store.name)}.focusboard.json`, JSON.stringify(doc, null, 1), 'utf8', [
      { name: 'Tableau FocUs', extensions: ['json'] },
    ]);
    if (path) toast('Tableau exporté.');
  }

  private async doImport() {
    const content = await openTextFile([{ name: 'Tableau FocUs', extensions: ['json'] }]);
    if (!content) return;
    try {
      const doc = JSON.parse(content) as BoardDoc;
      if (!Array.isArray(doc.elements)) throw new Error('format inattendu');
      doc.id = uid();
      doc.name = `${doc.name ?? 'Tableau importé'} (importé)`;
      doc.updatedAt = Date.now();
      await writeBoard(doc);
      await this.openBoardById(doc.id);
      toast('Tableau importé.');
    } catch (err) {
      toast(`Import impossible : ${(err as Error).message}`);
    }
  }

  /* ------------------------------------------------------------- thème */

  private applyTheme() {
    document.documentElement.dataset.theme = this.settings.theme;
    setNativeTheme(this.settings.theme);
  }

  private toggleTheme() {
    this.settings.theme = this.settings.theme === 'dark' ? 'light' : 'dark';
    this.applyTheme();
    this.chrome.refreshTheme();
    // Le thème clair doit donner un tableau entièrement blanc, pas une
    // interface claire avec un fond de tableau resté sombre.
    this.editor.setPaper(this.settings.theme === 'light' ? 'white' : 'slate');
    void writeSettings(this.settings);
  }

  /* ------------------------------------------------------------- menus */

  private handleMenu(command: string) {
    switch (command) {
      case 'board:new':
        void this.createBoard();
        break;
      case 'board:library':
        this.openLibraryModal();
        break;
      case 'board:import':
        void this.doImport();
        break;
      case 'export:png':
        void this.doExportPNG(false, false);
        break;
      case 'export:svg':
        void this.doExportSVG();
        break;
      case 'export:json':
        void this.doExportJSON();
        break;
      case 'edit:undo':
        this.editor.undo();
        break;
      case 'edit:redo':
        this.editor.redo();
        break;
      case 'edit:selectAll':
        this.editor.selectAll();
        break;
      case 'edit:delete':
        this.editor.deleteSelection();
        break;
      case 'view:zoomIn':
        this.editor.zoomIn();
        break;
      case 'view:zoomOut':
        this.editor.zoomOut();
        break;
      case 'view:zoomReset':
        this.editor.zoomReset();
        break;
      case 'view:zoomFit':
        this.editor.zoomToFit();
        break;
      case 'view:toggleTheme':
        this.toggleTheme();
        break;
      case 'help:shortcuts':
        openShortcuts();
        break;
      case 'help:tablet':
        openSettings(this.editor, { settings: this.settings, save: () => void writeSettings(this.settings) });
        break;
    }
  }

  private openLibraryModal() {
    openLibrary({
      currentId: this.store.id,
      list: () => listBoards(),
      open: (id) => void this.openBoardById(id),
      create: () => void this.createBoard(),
      remove: async (id) => {
        await deleteBoard(id);
        if (id === this.store.id) {
          const rest = await listBoards();
          if (rest.length) await this.openBoardById(rest[0].id);
          else await this.createBoard();
        }
      },
      duplicate: async (id) => {
        const doc = await readBoard(id);
        if (!doc) return;
        const copy: BoardDoc = { ...doc, id: uid(), name: `${doc.name} (copie)`, updatedAt: Date.now() };
        await writeBoard(copy);
      },
      revealFolder: () => void revealBoardsFolder(),
    });
  }

  private bridge(): AppBridge {
    return {
      newBoard: () => void this.createBoard(),
      openLibrary: () => this.openLibraryModal(),
      openSettings: () =>
        openSettings(this.editor, { settings: this.settings, save: () => void writeSettings(this.settings) }),
      openShortcuts: () => openShortcuts(),
      renameBoard: (name) => {
        this.store.name = name;
        this.store.touch();
        this.chrome.refreshBoardName(name);
      },
      exportPNG: (selectionOnly, transparent) => void this.doExportPNG(selectionOnly, transparent),
      exportSVG: () => void this.doExportSVG(),
      exportJSON: () => void this.doExportJSON(),
      importBoard: () => void this.doImport(),
      toggleTheme: () => this.toggleTheme(),
      currentTheme: () => this.settings.theme,
    };
  }
}

function safeName(name: string): string {
  return (name || 'tableau').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
}

new App().start().catch((err) => {
  const modal = showModal('Démarrage impossible');
  modal.body.append(h('p', { class: 'modal-text', text: String(err?.stack ?? err) }));
});
