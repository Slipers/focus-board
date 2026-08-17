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

export type AnyElement = StrokeElement | ShapeElement | NoteElement | TextElement | ImageElement;
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
  camera: Camera;
  elements: AnyElement[];
  thumbnail?: string | null;
}

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
}

export const DEFAULT_TABLET: TabletSettings = {
  pressureCurve: 0.75,
  minWidth: 0.18,
  smoothing: true,
  streamline: 0.6,
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
};
