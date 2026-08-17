import type { AnyElement, BoardDoc, BackgroundKind, Camera, ID, PaperKind } from './types';
import { uid } from './geom';

interface Patch {
  id: ID;
  before: AnyElement | null;
  after: AnyElement | null;
}

interface HistoryEntry {
  label: string;
  patches: Patch[];
  selectionBefore: ID[];
  selectionAfter: ID[];
}

const clone = <T>(v: T): T => structuredClone(v);

export function createBoardDoc(name = 'Nouveau tableau'): BoardDoc {
  const now = Date.now();
  return {
    version: 1,
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    background: 'grid',
    paper: 'slate',
    camera: { x: -600, y: -400, zoom: 1 },
    elements: [],
    thumbnail: null,
  };
}

/**
 * Modèle du tableau + historique.
 *
 * L'historique est à base de patches (image avant / après par élément) plutôt
 * que de copies complètes du document : sur un tableau chargé, annuler un
 * simple déplacement ne doit pas dupliquer des milliers de traits.
 */
export class BoardStore {
  id: ID;
  name: string;
  createdAt: number;
  background: BackgroundKind;
  paper: PaperKind;
  camera: Camera;

  /** Incrémenté à chaque mutation : sert d'invalidation pour le rendu. */
  revision = 0;

  private els = new Map<ID, AnyElement>();
  private sortedCache: AnyElement[] | null = null;
  private maxZ = 0;
  private tx: Map<ID, AnyElement | null> | null = null;
  private txSelection: ID[] = [];
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<(dirty: boolean) => void>();

  constructor(doc: BoardDoc) {
    this.id = doc.id;
    this.name = doc.name;
    this.createdAt = doc.createdAt;
    this.background = doc.background;
    this.paper = doc.paper;
    this.camera = { ...doc.camera };
    for (const el of doc.elements) {
      this.els.set(el.id, el);
      this.maxZ = Math.max(this.maxZ, el.z);
    }
  }

  toDoc(thumbnail?: string | null): BoardDoc {
    return {
      version: 1,
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      background: this.background,
      paper: this.paper,
      camera: { ...this.camera },
      elements: this.allSorted().map(clone),
      thumbnail: thumbnail ?? null,
    };
  }

  /* --------------------------------------------------------- lectures */

  get size(): number {
    return this.els.size;
  }

  get(id: ID): AnyElement | undefined {
    return this.els.get(id);
  }

  has(id: ID): boolean {
    return this.els.has(id);
  }

  /** Éléments triés par profondeur (du fond vers l'avant). */
  allSorted(): AnyElement[] {
    if (!this.sortedCache) {
      this.sortedCache = [...this.els.values()].sort((a, b) => a.z - b.z);
    }
    return this.sortedCache;
  }

  nextZ(): number {
    return ++this.maxZ;
  }

  /* -------------------------------------------------------- mutations */

  onChange(fn: (dirty: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** `dirty` distingue un changement à sauvegarder d'un simple rafraîchissement. */
  private emit(dirty: boolean) {
    this.revision++;
    this.sortedCache = null;
    for (const fn of this.listeners) fn(dirty);
  }

  /** Signale un changement hors historique (caméra, nom, fond…). */
  touch(dirty = true) {
    this.emit(dirty);
  }

  begin(selection: ID[] = []) {
    if (this.tx) throw new Error('Transaction déjà ouverte');
    this.tx = new Map();
    this.txSelection = [...selection];
  }

  private record(id: ID) {
    if (!this.tx) throw new Error('Mutation hors transaction');
    if (!this.tx.has(id)) {
      const cur = this.els.get(id);
      this.tx.set(id, cur ? clone(cur) : null);
    }
  }

  add(el: AnyElement) {
    this.record(el.id);
    this.els.set(el.id, el);
    this.maxZ = Math.max(this.maxZ, el.z);
    this.emit(true);
  }

  remove(id: ID) {
    if (!this.els.has(id)) return;
    this.record(id);
    this.els.delete(id);
    this.emit(true);
  }

  /** Remplace l'élément par une copie modifiée : la nouvelle identité invalide les caches de rendu. */
  update<T extends AnyElement>(id: ID, patch: Partial<T>): AnyElement | undefined {
    const cur = this.els.get(id);
    if (!cur) return undefined;
    this.record(id);
    const next = { ...cur, ...patch } as AnyElement;
    this.els.set(id, next);
    this.maxZ = Math.max(this.maxZ, next.z);
    this.emit(true);
    return next;
  }

  /** Mutation en place sur un clone : pratique pour retoucher un tableau de points. */
  mutate<T extends AnyElement>(id: ID, fn: (draft: T) => void): AnyElement | undefined {
    const cur = this.els.get(id) as T | undefined;
    if (!cur) return undefined;
    this.record(id);
    const draft = clone(cur);
    fn(draft);
    this.els.set(id, draft);
    this.maxZ = Math.max(this.maxZ, draft.z);
    this.emit(true);
    return draft;
  }

  /** Clôt la transaction. Renvoie false si rien n'a réellement changé. */
  commit(label: string, selectionAfter: ID[] = []): boolean {
    if (!this.tx) return false;
    const patches: Patch[] = [];
    for (const [id, before] of this.tx) {
      const after = this.els.get(id) ?? null;
      if (before === null && after === null) continue;
      if (before && after && JSON.stringify(before) === JSON.stringify(after)) continue;
      patches.push({ id, before, after: after ? clone(after) : null });
    }
    const selectionBefore = this.txSelection;
    this.tx = null;
    this.txSelection = [];
    if (!patches.length) return false;
    this.undoStack.push({ label, patches, selectionBefore, selectionAfter: [...selectionAfter] });
    if (this.undoStack.length > 400) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit(true);
    return true;
  }

  /** Annule la transaction en cours et restaure les images « avant ». */
  abort() {
    if (!this.tx) return;
    for (const [id, before] of this.tx) {
      if (before) this.els.set(id, before);
      else this.els.delete(id);
    }
    this.tx = null;
    this.txSelection = [];
    this.emit(false);
  }

  get inTransaction(): boolean {
    return this.tx !== null;
  }

  /* ------------------------------------------------------- historique */

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private apply(patches: Patch[], direction: 'before' | 'after') {
    for (const p of patches) {
      const target = direction === 'before' ? p.before : p.after;
      if (target) this.els.set(p.id, clone(target));
      else this.els.delete(p.id);
      if (target) this.maxZ = Math.max(this.maxZ, target.z);
    }
  }

  /** Renvoie la sélection à restaurer, ou null si rien à annuler. */
  undo(): ID[] | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.apply(entry.patches, 'before');
    this.redoStack.push(entry);
    this.emit(true);
    return entry.selectionBefore.filter((id) => this.els.has(id));
  }

  redo(): ID[] | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.apply(entry.patches, 'after');
    this.undoStack.push(entry);
    this.emit(true);
    return entry.selectionAfter.filter((id) => this.els.has(id));
  }

  /* --------------------------------------------------------- z-order */

  bringToFront(ids: ID[]) {
    for (const id of ids) this.update(id, { z: this.nextZ() });
  }

  sendToBack(ids: ID[]) {
    const minZ = Math.min(...[...this.els.values()].map((e) => e.z), 0);
    let z = minZ - ids.length;
    for (const id of ids) this.update(id, { z: z++ });
  }
}
