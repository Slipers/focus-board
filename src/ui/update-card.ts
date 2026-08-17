import { updater } from '../io/storage';
import { h, clear } from './dom';
import { ICONS } from './icons';

type Phase = 'hidden' | 'available' | 'downloading' | 'ready' | 'error';

/**
 * Carte flottante de mise à jour, en haut à droite.
 *
 * Flux : sondage silencieux au démarrage (côté main) → « disponible » avec un
 * bouton Installer → téléchargement avec barre de progression → redémarrage
 * automatique une fois le paquet prêt. Inerte hors d'Electron ou en dev (pas
 * de build publié à comparer).
 */
export function initUpdateCard() {
  if (!updater) return;

  let phase: Phase = 'hidden';
  let version = '';
  let percent = 0;
  let errorMessage = '';

  const card = h('div', { class: 'update-card' });
  document.body.append(card);

  function render() {
    card.classList.toggle('update-card-visible', phase !== 'hidden');
    clear(card);
    if (phase === 'hidden') return;

    if (phase === 'available') {
      card.append(
        h('div', { class: 'update-card-icon', html: ICONS.download }),
        h(
          'div',
          { class: 'update-card-body' },
          h('strong', { text: `Mise à jour disponible — ${version}` }),
          h('p', { text: 'Redémarre l’application pour installer la nouvelle version.' }),
          h(
            'div',
            { class: 'update-card-actions' },
            h('button', { class: 'btn', text: 'Plus tard', on: { click: () => setPhase('hidden') } }),
            h('button', { class: 'btn btn-primary', text: 'Installer', on: { click: () => void startDownload() } }),
          ),
        ),
      );
      return;
    }

    if (phase === 'downloading') {
      const pct = Math.round(percent);
      card.append(
        h('div', { class: 'update-card-icon update-card-icon-spin', html: ICONS.download }),
        h(
          'div',
          { class: 'update-card-body' },
          h('strong', { text: `Téléchargement — ${version}` }),
          h('div', { class: 'update-progress' }, h('div', { class: 'update-progress-fill', style: { width: `${pct}%` } })),
          h('p', { text: `${pct} %` }),
        ),
      );
      return;
    }

    if (phase === 'ready') {
      card.append(
        h('div', { class: 'update-card-icon', html: ICONS.check }),
        h(
          'div',
          { class: 'update-card-body' },
          h('strong', { text: 'Mise à jour prête' }),
          h('p', { text: 'Redémarrage de FocUs Board…' }),
        ),
      );
      return;
    }

    card.append(
      h('div', { class: 'update-card-icon', html: ICONS.close }),
      h(
        'div',
        { class: 'update-card-body' },
        h('strong', { text: 'Échec de la mise à jour' }),
        h('p', { text: errorMessage }),
        h(
          'div',
          { class: 'update-card-actions' },
          h('button', { class: 'btn', text: 'Fermer', on: { click: () => setPhase('hidden') } }),
        ),
      ),
    );
  }

  function setPhase(next: Phase) {
    phase = next;
    render();
  }

  async function startDownload() {
    setPhase('downloading');
    percent = 0;
    try {
      await updater!.download();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      setPhase('error');
    }
  }

  updater.onAvailable((info) => {
    version = info.version;
    setPhase('available');
  });

  updater.onProgress((p) => {
    percent = p.percent;
    if (phase !== 'downloading') phase = 'downloading';
    render();
  });

  updater.onReady((info) => {
    version = info.version;
    setPhase('ready');
    // Laisse le message « prêt » s'afficher un instant avant de couper l'app —
    // sinon la fenêtre disparaît si vite que ça ressemble à un plantage.
    setTimeout(() => void updater!.install(), 1200);
  });

  updater.onError((message) => {
    // Le sondage silencieux au démarrage échoue souvent (pas de réseau, pas
    // de release plus récente à comparer) : ça ne doit jamais alerter
    // l'utilisateur. Seul un échec après un clic sur Installer compte.
    if (phase === 'downloading' || phase === 'ready') {
      errorMessage = message;
      setPhase('error');
    }
  });
}
