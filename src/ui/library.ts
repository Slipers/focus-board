import type { BoardSummary, ID } from '../core/types';
import { ICONS } from './icons';
import { clear, h, iconButton } from './dom';
import { confirmDialog, showModal } from './modal';

export interface LibraryHooks {
  currentId: ID;
  list(): Promise<BoardSummary[]>;
  open(id: ID): void;
  create(): void;
  remove(id: ID): Promise<void>;
  duplicate(id: ID): Promise<void>;
  revealFolder(): void;
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function openLibrary(hooks: LibraryHooks) {
  const modal = showModal('Vos tableaux', {
    wide: true,
    subtitle: 'Tout est stocké en local sur cet ordinateur. Rien ne part sur Internet.',
  });

  const grid = h('div', { class: 'library-grid' });
  const actions = h(
    'div',
    { class: 'library-actions' },
    h('button', { class: 'btn btn-primary', text: 'Nouveau tableau', on: { click: () => { modal.close(); hooks.create(); } } }),
    h('button', { class: 'btn', text: 'Ouvrir le dossier', on: { click: () => hooks.revealFolder() } }),
  );
  modal.body.append(actions, grid);

  const refresh = async () => {
    const boards = await hooks.list();
    clear(grid);
    if (!boards.length) {
      grid.append(h('p', { class: 'empty', text: 'Aucun tableau pour l’instant.' }));
      return;
    }
    for (const b of boards) {
      grid.append(card(b, hooks, modal.close, refresh));
    }
  };

  void refresh();
}

function card(
  board: BoardSummary,
  hooks: LibraryHooks,
  closeModal: () => void,
  refresh: () => Promise<void>,
): HTMLElement {
  const preview = board.thumbnail
    ? h('img', { class: 'card-thumb', attrs: { src: board.thumbnail, alt: '' } })
    : h('div', { class: 'card-thumb card-thumb-empty', text: 'Vide' });

  const isCurrent = board.id === hooks.currentId;

  return h(
    'article',
    { class: `board-card${isCurrent ? ' current' : ''}` },
    h('button', {
      class: 'card-open',
      title: 'Ouvrir',
      on: {
        click: () => {
          closeModal();
          hooks.open(board.id);
        },
      },
    }, preview),
    h(
      'div',
      { class: 'card-meta' },
      h('span', { class: 'card-name', text: board.name }),
      h('span', {
        class: 'card-sub',
        text: `${dateFmt.format(new Date(board.updatedAt))} · ${board.elementCount} élément${board.elementCount > 1 ? 's' : ''}`,
      }),
    ),
    h(
      'div',
      { class: 'card-tools' },
      iconButton(ICONS.copy, 'Dupliquer', async () => {
        await hooks.duplicate(board.id);
        await refresh();
      }),
      iconButton(
        ICONS.trash,
        'Supprimer',
        async () => {
          const ok = await confirmDialog(
            'Supprimer ce tableau ?',
            `« ${board.name} » sera définitivement supprimé de cet ordinateur.`,
            'Supprimer',
          );
          if (!ok) return;
          await hooks.remove(board.id);
          await refresh();
        },
        'danger',
      ),
    ),
  );
}
