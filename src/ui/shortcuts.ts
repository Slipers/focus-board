import { h } from './dom';
import { showModal } from './modal';

const GROUPS: Array<[string, Array<[string, string]>]> = [
  [
    'Outils',
    [
      ['V', 'Sélection'],
      ['L', 'Lasso'],
      ['B', 'Stylo'],
      ['F', 'Feutre'],
      ['H', 'Surligneur'],
      ['C', 'Crayon'],
      ['E', 'Gomme'],
      ['R', 'Forme'],
      ['N', 'Note'],
      ['T', 'Texte'],
      ['X', 'Pointeur laser'],
    ],
  ],
  [
    'Navigation',
    [
      ['Espace + glisser', 'Déplacer la vue'],
      ['Clic molette + glisser', 'Déplacer la vue'],
      ['Molette', 'Zoomer, centré sur le curseur'],
      ['Maj + molette', 'Défiler horizontalement'],
      ['Deux doigts', 'Déplacer et zoomer'],
      ['Ctrl + 0', 'Taille réelle'],
      ['Ctrl + 1', 'Ajuster au contenu'],
    ],
  ],
  [
    'Édition',
    [
      ['Ctrl + Z', 'Annuler'],
      ['Ctrl + Maj + Z', 'Rétablir'],
      ['Ctrl + A', 'Tout sélectionner'],
      ['Ctrl + D', 'Dupliquer'],
      ['Ctrl + C / V / X', 'Copier / coller / couper'],
      ['Suppr', 'Supprimer la sélection'],
      ['Flèches', 'Déplacer de 1 px (Maj : 20 px)'],
      ['Entrée', 'Éditer le texte de l’élément'],
      ['Double-clic', 'Éditer, ou créer un texte'],
      ['Ctrl + ] / [', 'Premier plan / arrière-plan'],
    ],
  ],
  [
    'Pendant un geste',
    [
      ['Maj', 'Contraindre (angle, proportions, axe)'],
      ['Alt', 'Depuis le centre · ignorer le magnétisme'],
      ['Échap', 'Annuler le geste en cours'],
    ],
  ],
  [
    'Stylet',
    [
      ['Bout gomme', 'Gomme instantanée'],
      ['Bouton latéral', 'Configurable dans les réglages'],
      ['Pression', 'Épaisseur du trait'],
      ['Survol', 'Aperçu de la pointe'],
    ],
  ],
];

export function openShortcuts() {
  const modal = showModal('Raccourcis clavier', { wide: true });
  const grid = h('div', { class: 'shortcut-grid' });
  for (const [title, rows] of GROUPS) {
    grid.append(
      h(
        'section',
        { class: 'shortcut-section' },
        h('h3', { text: title }),
        ...rows.map(([key, label]) =>
          h('div', { class: 'shortcut-row' }, h('kbd', { text: key }), h('span', { text: label })),
        ),
      ),
    );
  }
  modal.body.append(grid);
}
