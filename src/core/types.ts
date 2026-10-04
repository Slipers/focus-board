export type ID = string;

export type BrushKind = 'pen' | 'marker' | 'highlighter' | 'pencil';
export type ShapeKind = 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'star' | 'line' | 'arrow';
export type DashKind = 'solid' | 'dashed' | 'dotted';
export type FontKind = 'sans' | 'serif' | 'mono' | 'hand';
export type AlignKind = 'left' | 'center' | 'right';
export type BackgroundKind = 'blank' | 'grid' | 'dots' | 'lines' | 'iso';
export type PaperKind = 'white' | 'cream' | 'slate' | 'black';

export interface ElementBase {
  id: ID;
  /** Coin haut-gauche de la boîte englobante locale, en coordonnées monde. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation en radians autour du centre de la boîte. */
  angle: number;
  z: number;
  opacity: number;
  locked?: boolean;
}

export interface StrokeElement extends ElementBase {
  type: 'stroke';
  brush: BrushKind;
  color: string;
  /** Largeur de référence du trait, en px monde (à pression 0.5). */
  size: number;
  /** Plat : [x, y, pression, …] en coordonnées locales (0..w, 0..h). */
  points: number[];
}

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: ShapeKind;
  stroke: string;
  fill: string;
  strokeWidth: number;
  dash: DashKind;
  /** Pour line/arrow : [ax, ay, bx, by] en coordonnées locales. */
  pts?: number[];
  text: string;
  textColor: string;
  fontSize: number;
  font: FontKind;
}

export interface NoteElement extends ElementBase {
  type: 'note';
  color: string;
  text: string;
  textColor: string;
  fontSize: number;
  font: FontKind;
  align: AlignKind;
}

export interface TextElement extends ElementBase {
  type: 'text';
  text: string;
  color: string;
  fontSize: number;
  font: FontKind;
  align: AlignKind;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  src: string;
  naturalW: number;
  naturalH: number;
  radius: number;
}

/**
 * Une page d'un PDF importé, posée sur le tableau comme une feuille sur
 * laquelle on écrit. Seule la référence à la page est stockée ici : les octets
 * du PDF vivent une seule fois dans `BoardDoc.assets`, et la page est
 * rastérisée à la demande, à la résolution du zoom courant.
 */
export interface PdfPageElement extends ElementBase {
  type: 'pdfPage';
  /** Clé de l'asset PDF dans le document. */
  asset: ID;
  /** Numéro de page, à partir de 1 comme dans un lecteur PDF. */
  page: number;
  /** Nombre de pages du document source. */
  pageCount: number;
  /** Taille de la page en points PDF (72 par pouce), avant tout redimensionnement. */
  pageW: number;
  pageH: number;
  /** Nom du fichier importé. */
  label: string;
}

export interface BoardAsset {
  kind: 'pdf';
  /** Nom du fichier d'origine. */
  name: string;
  /** Contenu du fichier, en base64. */
  data: string;
}

export type AnyElement =
  | StrokeElement
  | ShapeElement
  | NoteElement
  | TextElement
  | ImageElement
  | PdfPageElement;
export type ElementType = AnyElement['type'];

export interface Camera {
  /** Coordonnée monde située au coin haut-gauche du viewport. */
  x: number;
  y: number;
  zoom: number;
}

export interface BoardDoc {
  version: 1;
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  background: BackgroundKind;
  paper: PaperKind;
  /** Écartement du motif de fond, en multiple de son pas naturel. */
  spacingScale?: SpacingScale;
  camera: Camera;
  elements: AnyElement[];
  /** Fichiers source attachés au tableau (PDF importés), indexés par clé. */
  assets?: Record<ID, BoardAsset>;
  thumbnail?: string | null;
}

export type SpacingScale = 0.75 | 1 | 1.5;

/**
 * Pas naturel de chaque motif, en px monde. Les lignes d'écriture sont
 * nettement plus espacées que le quadrillage : il faut la place d'écrire une
 * ligne de texte, avec ses exposants et ses fractions.
 */
export const BACKGROUND_STEP: Record<BackgroundKind, number> = {
  blank: 0,
  grid: 44,
  dots: 44,
  lines: 88,
  iso: 44,
};

export interface BoardSummary {
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  elementCount: number;
  thumbnail: string | null;
}

export type ToolId =
  | 'select'
  | 'lasso'
  | 'pan'
  | 'pen'
  | 'marker'
  | 'highlighter'
  | 'pencil'
  | 'eraser'
  | 'shape'
  | 'note'
  | 'text'
  | 'image'
  | 'laser';

export interface TabletSettings {
  /** Courbe de pression : <1 rend le trait plus réactif aux appuis légers. */
  pressureCurve: number;
  /** Largeur minimale relative (0..1) quand la pression est nulle. */
  minWidth: number;
  /** Lissage de l'écriture : atténue le tremblement de la main. */
  smoothing: boolean;
  /** Intensité du lissage (0 = brut, 0.9 = très lissé). Sans effet si `smoothing` est faux. */
  streamline: number;
  /**
   * Stabilité de l'écriture (0..1) : rayon de la zone morte sous laquelle un
   * mouvement du stylet ne déplace pas du tout le trait. Contrairement au
   * lissage, qui atténue le tremblement proportionnellement, la zone morte
   * l'annule complètement tant qu'il reste sous ce seuil.
   */
  stability: number;
  /** Ignore les contacts tactiles quand un stylet est actif. */
  palmRejection: boolean;
  /** Un doigt déplace la vue au lieu de dessiner. */
  fingerPans: boolean;
  /** Le bout gomme du stylet bascule sur la gomme. */
  penEraserTip: boolean;
  /** Action du bouton latéral du stylet. */
  barrelButton: 'none' | 'pan' | 'erase' | 'select';
  /** Utilise l'inclinaison du stylet pour élargir le trait (effet biseau). */
  useTilt: boolean;
  /** Affiche un curseur de survol quand le stylet plane au-dessus de la tablette. */
  hoverCursor: boolean;
}

export interface AppSettings {
  theme: 'light' | 'dark';
  lastBoardId: ID | null;
  tablet: TabletSettings;
  snapToObjects: boolean;
  inkToShape: boolean;
  /** Un zigzag par-dessus de l'écriture l'efface. */
  scratchToErase: boolean;
  /**
   * À quel point le geste doit être franc pour compter comme un gribouillis,
   * de 0 (il faut une rature insistante) à 1 (le moindre zigzag suffit).
   */
  scratchSensitivity: number;
  /**
   * Tolérance de la reconnaissance de formes, de 0 (seul un tracé déjà net
   * devient une forme) à 1 (un croquis approximatif est redressé).
   */
  shapeSensitivity: number;
  /** Une ligne tracée au milieu d'un mot l'efface. */
  strikeToErase: boolean;
}

export const DEFAULT_TABLET: TabletSettings = {
  pressureCurve: 0.75,
  minWidth: 0.18,
  smoothing: true,
  streamline: 0.65,
  stability: 0.35,
  palmRejection: true,
  fingerPans: true,
  penEraserTip: true,
  barrelButton: 'pan',
  useTilt: false,
  hoverCursor: true,
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  lastBoardId: null,
  tablet: DEFAULT_TABLET,
  snapToObjects: true,
  inkToShape: false,
  scratchToErase: true,
  scratchSensitivity: 0.5,
  shapeSensitivity: 0.5,
  strikeToErase: true,
};
