import type { AppSettings, BoardDoc, BoardSummary, ID } from '../core/types';
import { DEFAULT_SETTINGS, DEFAULT_TABLET } from '../core/types';

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface UpdateAvailableInfo {
  version: string;
  notes: string | null;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateReadyInfo {
  version: string;
}

interface UpdaterApi {
  download(): Promise<void>;
  install(): Promise<void>;
  onAvailable(handler: (info: UpdateAvailableInfo) => void): () => void;
  onProgress(handler: (progress: UpdateProgress) => void): () => void;
  onReady(handler: (info: UpdateReadyInfo) => void): () => void;
  onError(handler: (message: string) => void): () => void;
}

interface FocusApi {
  platform: string;
  getVersion(): Promise<string>;
  boards: {
    list(): Promise<BoardSummary[]>;
    read(id: ID): Promise<BoardDoc | null>;
    write(doc: BoardDoc): Promise<boolean>;
    remove(id: ID): Promise<boolean>;
    reveal(): Promise<string>;
  };
  settings: {
    read(): Promise<Partial<AppSettings>>;
    write(s: AppSettings): Promise<boolean>;
  };
  files: {
    save(args: {
      defaultName: string;
      data: string;
      encoding: 'utf8' | 'base64';
      filters: FileFilter[];
    }): Promise<string | null>;
    open(filters: FileFilter[]): Promise<{ path: string; content: string } | null>;
    showItem(path: string): Promise<void>;
  };
  setTheme(theme: 'light' | 'dark'): void;
  onMenu(handler: (command: string) => void): () => void;
  updater: UpdaterApi;
}

const api: FocusApi | undefined = (window as unknown as { focusApi?: FocusApi }).focusApi;

/** Vrai quand l'app tourne dans Electron ; faux si le renderer est ouvert seul dans un navigateur. */
export const isDesktop = Boolean(api);

/* ------------------------------------------------- repli navigateur */

const LS_BOARDS = 'focusboard:boards';
const LS_SETTINGS = 'focusboard:settings';

function lsBoards(): Record<ID, BoardDoc> {
  try {
    return JSON.parse(localStorage.getItem(LS_BOARDS) ?? '{}');
  } catch {
    return {};
  }
}

function lsWriteBoards(all: Record<ID, BoardDoc>) {
  localStorage.setItem(LS_BOARDS, JSON.stringify(all));
}

/* ---------------------------------------------------------- tableaux */

export async function listBoards(): Promise<BoardSummary[]> {
  const raw = api
    ? await api.boards.list()
    : Object.values(lsBoards()).map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        elementCount: d.elements.length,
        thumbnail: d.thumbnail ?? null,
      }));
  return raw.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readBoard(id: ID): Promise<BoardDoc | null> {
  if (api) return api.boards.read(id);
  return lsBoards()[id] ?? null;
}

export async function writeBoard(doc: BoardDoc): Promise<void> {
  if (api) {
    await api.boards.write(doc);
    return;
  }
  const all = lsBoards();
  all[doc.id] = doc;
  lsWriteBoards(all);
}

export async function deleteBoard(id: ID): Promise<void> {
  if (api) {
    await api.boards.remove(id);
    return;
  }
  const all = lsBoards();
  delete all[id];
  lsWriteBoards(all);
}

export async function revealBoardsFolder(): Promise<void> {
  await api?.boards.reveal();
}

/* ---------------------------------------------------------- réglages */

export async function readSettings(): Promise<AppSettings> {
  const stored = api
    ? await api.settings.read()
    : (JSON.parse(localStorage.getItem(LS_SETTINGS) ?? '{}') as Partial<AppSettings>);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    tablet: { ...DEFAULT_TABLET, ...(stored.tablet ?? {}) },
  };
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  if (api) {
    await api.settings.write(settings);
    return;
  }
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}

/* -------------------------------------------------------- fichiers */

export async function saveFile(
  defaultName: string,
  data: string,
  encoding: 'utf8' | 'base64',
  filters: FileFilter[],
): Promise<string | null> {
  if (api) return api.files.save({ defaultName, data, encoding, filters });
  // Navigateur : téléchargement classique.
  const blob =
    encoding === 'base64'
      ? new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))])
      : new Blob([data], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return defaultName;
}

export async function openTextFile(filters: FileFilter[]): Promise<string | null> {
  if (api) {
    const res = await api.files.open(filters);
    return res?.content ?? null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? await file.text() : null);
    };
    input.click();
  });
}

export function setNativeTheme(theme: 'light' | 'dark') {
  api?.setTheme(theme);
}

export function onMenuCommand(handler: (command: string) => void): () => void {
  return api?.onMenu(handler) ?? (() => {});
}

/* -------------------------------------------------------- mise à jour */

/** `null` en dehors d'Electron (navigateur) ou en dev : il n'y a alors rien à mettre à jour. */
export const updater: UpdaterApi | null = api?.updater ?? null;

/**
 * Numéro de version affiché à l'utilisateur (ex. « 1.1 ») : le patch est tu
 * quand il vaut 0, conformément à la convention 1.0/1.1/… de ce projet.
 */
export async function getDisplayVersion(): Promise<string | null> {
  if (!api) return null;
  const full = await api.getVersion();
  return full.replace(/\.0$/, '');
}
