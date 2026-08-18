import { ICONS } from './icons';
import { h, iconButton } from './dom';

export interface ModalHandle {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
  /** Enregistre un nettoyage (désabonnements…) exécuté une fois à la fermeture. */
  onClose: (fn: () => void) => void;
}

let openModal: ModalHandle | null = null;

export function showModal(title: string, options: { wide?: boolean; subtitle?: string } = {}): ModalHandle {
  openModal?.close();

  const body = h('div', { class: 'modal-body' });
  const closeBtn = iconButton(ICONS.close, 'Fermer', () => handle.close());
  const panel = h(
    'div',
    { class: `modal ${options.wide ? 'modal-wide' : ''}`.trim() },
    h(
      'header',
      { class: 'modal-head' },
      h(
        'div',
        {},
        h('h2', { text: title }),
        options.subtitle ? h('p', { class: 'modal-sub', text: options.subtitle }) : null,
      ),
      closeBtn,
    ),
    body,
  );

  const root = h('div', { class: 'modal-backdrop' }, panel);
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) handle.close();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handle.close();
    }
  };

  const cleanups: Array<() => void> = [];

  const handle: ModalHandle = {
    root,
    body,
    close: () => {
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      if (openModal === handle) openModal = null;
      for (const fn of cleanups) fn();
      cleanups.length = 0;
    },
    onClose: (fn) => cleanups.push(fn),
  };

  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  openModal = handle;
  return handle;
}

export function confirmDialog(title: string, message: string, confirmLabel = 'Confirmer'): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = showModal(title);
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(value);
    };
    modal.body.append(
      h('p', { class: 'modal-text', text: message }),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn', text: 'Annuler', on: { click: () => finish(false) } }),
        h('button', { class: 'btn btn-danger', text: confirmLabel, on: { click: () => finish(true) } }),
      ),
    );
    modal.root.addEventListener('remove', () => finish(false));
  });
}

/** Petite notification éphémère en bas de l'écran. */
export function toast(message: string) {
  const el = h('div', { class: 'toast', text: message });
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('toast-in'));
  setTimeout(() => {
    el.classList.remove('toast-in');
    setTimeout(() => el.remove(), 240);
  }, 2400);
}
