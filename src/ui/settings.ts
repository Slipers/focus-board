import type { AppSettings } from '../core/types';
import type { Editor } from '../editor/editor';
import { DEFAULT_TABLET } from '../core/types';
import { outlineOptionsFor } from '../core/brushes';
import { cascadeAmount, outlineToPath, strokeOutline, streamlinePoint } from '../core/freehand';
import { getDisplayVersion } from '../io/storage';
import { h } from './dom';
import { showModal } from './modal';

export interface SettingsHooks {
  settings: AppSettings;
  save(): void;
}

export function openSettings(editor: Editor, hooks: SettingsHooks) {
  const modal = showModal('Réglages', {
    subtitle: 'Le stylet, la tablette et le comportement du tableau.',
    wide: true,
  });
  const s = hooks.settings;

  const commit = () => {
    editor.setSettings(s);
    hooks.save();
  };

  const slider = (
    label: string,
    hint: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
  ) => {
    const value = h('span', { class: 'field-value', text: get().toFixed(2) });
    const input = h('input', { type: 'range', class: 'range' });
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    input.addEventListener('input', () => {
      set(Number(input.value));
      value.textContent = Number(input.value).toFixed(2);
      commit();
    });
    return h(
      'div',
      { class: 'field' },
      h('div', { class: 'field-head' }, h('label', { text: label }), value),
      input,
      h('p', { class: 'field-hint', text: hint }),
    );
  };

  const toggle = (label: string, hint: string, get: () => boolean, set: (v: boolean) => void) => {
    const input = h('input', { type: 'checkbox' });
    input.checked = get();
    input.addEventListener('change', () => {
      set(input.checked);
      commit();
    });
    return h(
      'label',
      { class: 'switch-row' },
      input,
      h('span', { class: 'switch' }),
      h('div', {}, h('span', { class: 'switch-label', text: label }), h('p', { class: 'field-hint', text: hint })),
    );
  };

  const segmented = <T extends string>(
    label: string,
    options: Array<{ id: T; label: string }>,
    get: () => T,
    set: (v: T) => void,
  ) => {
    const row = h('div', { class: 'segmented' });
    const rebuild = () => {
      row.innerHTML = '';
      for (const o of options) {
        row.append(
          h('button', {
            class: `seg-btn${get() === o.id ? ' active' : ''}`,
            text: o.label,
            on: {
              click: () => {
                set(o.id);
                commit();
                rebuild();
              },
            },
          }),
        );
      }
    };
    rebuild();
    return h('div', { class: 'field' }, h('div', { class: 'field-head' }, h('label', { text: label })), row);
  };

  // Le curseur d'intensité n'a de sens que si le lissage est actif : on le
  // grise au lieu de le laisser trompeusement manipulable.
  const intensityField = slider(
    'Intensité du lissage',
    'Plus haut, l’écriture est plus calme ; trop haut, le trait « traîne » derrière le stylet.',
    0, 0.85, 0.05,
    () => s.tablet.streamline,
    (v) => (s.tablet.streamline = v),
  );
  const syncIntensity = () => {
    intensityField.classList.toggle('field-off', !s.tablet.smoothing);
    const range = intensityField.querySelector('input');
    if (range) range.disabled = !s.tablet.smoothing;
  };

  modal.body.append(
    h('h3', { class: 'section-title', text: 'Stylet et tablette graphique' }),
    toggle(
      'Lissage de l’écriture',
      'Atténue le tremblement de la main pendant le tracé, puis repasse sur le trait terminé pour effacer les oscillations résiduelles.',
      () => s.tablet.smoothing,
      (v) => {
        s.tablet.smoothing = v;
        syncIntensity();
      },
    ),
    intensityField,
    slider(
      'Courbe de pression',
      'Sous 1, un appui léger donne déjà un trait épais. Au-dessus, il faut appuyer davantage.',
      0.35, 1.8, 0.05,
      () => s.tablet.pressureCurve,
      (v) => (s.tablet.pressureCurve = v),
    ),
    slider(
      'Largeur minimale',
      'Épaisseur conservée quand la pression est nulle. À 0, les déliés disparaissent complètement.',
      0, 0.6, 0.02,
      () => s.tablet.minWidth,
      (v) => (s.tablet.minWidth = v),
    ),
    segmented(
      'Bouton latéral du stylet',
      [
        { id: 'none' as const, label: 'Rien' },
        { id: 'pan' as const, label: 'Déplacer la vue' },
        { id: 'erase' as const, label: 'Gommer' },
        { id: 'select' as const, label: 'Sélectionner' },
      ],
      () => s.tablet.barrelButton,
      (v) => (s.tablet.barrelButton = v),
    ),
    toggle(
      'Bout gomme du stylet',
      'Retourner le stylet passe automatiquement en gomme.',
      () => s.tablet.penEraserTip,
      (v) => (s.tablet.penEraserTip = v),
    ),
    toggle(
      'Rejet de la paume',
      'Ignore les contacts tactiles tant que le stylet est en approche.',
      () => s.tablet.palmRejection,
      (v) => (s.tablet.palmRejection = v),
    ),
    toggle(
      'Un doigt déplace la vue',
      'Sur écran tactile : un doigt fait défiler, le stylet dessine. Deux doigts zooment toujours.',
      () => s.tablet.fingerPans,
      (v) => (s.tablet.fingerPans = v),
    ),
    toggle(
      'Utiliser l’inclinaison',
      'Élargit le trait quand le stylet est incliné, pour un effet de biseau.',
      () => s.tablet.useTilt,
      (v) => (s.tablet.useTilt = v),
    ),
    toggle(
      'Aperçu de la pointe au survol',
      'Affiche un cercle sous le stylet avant même qu’il touche la tablette.',
      () => s.tablet.hoverCursor,
      (v) => (s.tablet.hoverCursor = v),
    ),

    h('h3', { class: 'section-title', text: 'Tableau' }),
    toggle(
      'Magnétisme',
      'Aligne les éléments déplacés sur les bords et centres voisins. Maintenez Alt pour l’ignorer.',
      () => s.snapToObjects,
      (v) => (s.snapToObjects = v),
    ),
    toggle(
      'Reconnaissance de formes',
      'Un cercle ou un rectangle tracé à main levée devient une forme nette.',
      () => s.inkToShape,
      (v) => (s.inkToShape = v),
    ),
    toggle(
      'Quadrillage',
      'Affiche des repères sur le tableau. Désactivez pour un fond entièrement uni.',
      () => editor.store.background !== 'blank',
      (v) => editor.setBackground(v ? 'grid' : 'blank'),
    ),

    h('h3', { class: 'section-title', text: 'Diagnostic du stylet' }),
    diagnostics(editor, s, modal.onClose),

    h(
      'div',
      { class: 'modal-actions' },
      h('button', {
        class: 'btn',
        text: 'Réinitialiser les réglages tablette',
        on: {
          click: () => {
            Object.assign(s.tablet, DEFAULT_TABLET);
            commit();
            modal.close();
            openSettings(editor, hooks);
          },
        },
      }),
    ),
    h('p', { class: 'settings-version', text: '' }),
  );

  syncIntensity();

  const versionLine = modal.body.querySelector<HTMLParagraphElement>('.settings-version')!;
  void getDisplayVersion().then((v) => {
    if (v) versionLine.textContent = `FocUs Board ${v}`;
  });
}

/**
 * Zone d'essai : c'est le moyen le plus direct de vérifier que le pilote de la
 * tablette transmet bien la pression. Si `type` reste « mouse » ou que la
 * pression est figée à 0.50, Windows Ink est désactivé côté pilote.
 */
function diagnostics(editor: Editor, settings: AppSettings, onClose: (fn: () => void) => void): HTMLElement {
  const status = h('div', { class: 'diag-status' });
  const readout = h('div', { class: 'diag-readout' });
  const canvas = h('canvas', { class: 'diag-canvas' });
  canvas.width = 640;
  canvas.height = 200;
  const ctx = canvas.getContext('2d')!;

  const STATUS_LABEL: Record<typeof editor.penPressureMode, string> = {
    unknown: 'En attente d’un premier trait au stylet…',
    real: 'Pression réelle détectée ✓',
    synthetic: 'Aucune pression détectée — épaisseur simulée par la vitesse',
  };
  const renderStatus = () => {
    status.textContent = STATUS_LABEL[editor.penPressureMode];
    status.className = `diag-status diag-status-${editor.penPressureMode}`;
  };

  const render = () => {
    renderStatus();
    const p = editor.lastPointer;
    readout.innerHTML = '';
    const rows: Array<[string, string]> = p
      ? [
          ['Périphérique', p.type],
          ['Pression', p.pressure.toFixed(3)],
          ['Inclinaison', `${p.tiltX}° / ${p.tiltY}°`],
          ['Rotation', `${p.twist}°`],
          ['Boutons', String(p.buttons)],
          ['Échantillons/évt', String(p.coalesced)],
        ]
      : [['En attente', 'dessinez dans la zone ci-dessous']];
    for (const [k, v] of rows) {
      readout.append(h('div', { class: 'diag-cell' }, h('span', { text: k }), h('strong', { text: v })));
    }
  };

  onClose(editor.on('pointer', render));
  onClose(editor.on('penFallback', render));
  render();

  let drawing = false;
  let pts: number[] = [];
  // Mêmes deux étages de filtre que la vraie toile, pour que l'essai reflète
  // exactement ce que donnera le réglage.
  let stageA: [number, number, number] | null = null;
  let stageB: [number, number, number] | null = null;

  const paint = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pts.length < 3) return;
    const path = outlineToPath(strokeOutline(pts, outlineOptionsFor('pen', 8, settings.tablet)));
    ctx.fillStyle = '#4c8dff';
    ctx.fill(path, 'nonzero');
  };

  const localPoint = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    pts = [];
    const { x, y } = localPoint(e);
    const pressure = e.pointerType === 'pen' ? Math.max(0.02, e.pressure) : 0.6;
    stageA = [x, y, pressure];
    stageB = [x, y, pressure];
    pts.push(x, y, pressure);
    paint();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing || !stageA || !stageB) return;
    const amount = settings.tablet.smoothing ? cascadeAmount(settings.tablet.streamline) : 0;
    const list = e.getCoalescedEvents?.() ?? [];
    for (const ce of list.length ? list : [e]) {
      const { x, y } = localPoint(ce);
      const pressure = ce.pointerType === 'pen' ? Math.max(0.02, ce.pressure) : 0.6;
      stageA = streamlinePoint(stageA[0], stageA[1], stageA[2], x, y, pressure, amount);
      stageB = streamlinePoint(stageB[0], stageB[1], stageB[2], stageA[0], stageA[1], stageA[2], amount);
      pts.push(stageB[0], stageB[1], stageB[2]);
    }
    paint();
  });
  const stop = () => {
    drawing = false;
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  return h(
    'div',
    { class: 'diag' },
    status,
    readout,
    canvas,
    h('p', {
      class: 'field-hint',
      text: 'Si « Périphérique » affiche « mouse » avec votre stylet, activez Windows Ink dans le pilote de la tablette (Wacom : Propriétés → Mappage → Utiliser Windows Ink).',
    }),
  );
}
