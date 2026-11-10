/**
 * Intermediate representation of a parsed presentation. Geometry is in EMU in slide space
 * (groups already flattened); colours are resolved. The emitter turns it into Blueprint layers.
 */

import type { Rgba } from "../shared/color";

/** English Metric Units per CSS pixel (914400 EMU per inch, 96 px per inch). */
export const EMU_PER_PX = 9525;
/** EMU per typographic point. */
export const EMU_PER_PT = 12700;

/** Placement of a shape in slide space. Rotation is clockwise degrees around the box centre. */
export interface Xform {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

export type Fill =
  | { kind: "none" }
  | { kind: "solid"; color: Rgba }
  | { kind: "gradient"; css: string; first: Rgba }
  | { kind: "image"; src: string; natural?: { w: number; h: number }; crop?: CropRect };

/** Source crop as fractions of the image (DrawingML `srcRect`), each 0..1 from its edge. */
export interface CropRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

export type ArrowKind = "triangle" | "arrow" | "stealth" | "oval" | "diamond";

export interface Stroke {
  color: Rgba;
  /** Width in EMU. */
  width: number;
  /** DrawingML preset dash name ("dash", "sysDot", ...); undefined for solid. */
  dash?: string;
  head?: ArrowKind;
  tail?: ArrowKind;
}

export interface Shadow {
  dx: number;
  dy: number;
  blur: number;
  color: Rgba;
}

/** Shape outline: a preset rendered as a CSS box, or an explicit path in local EMU coordinates. */
export type Geometry =
  | { kind: "rect" }
  | { kind: "roundRect"; radius: number }
  | { kind: "ellipse" }
  | { kind: "path"; segments: PathSegment[]; closed: boolean }
  | { kind: "line"; segments: PathSegment[] };

export type PathSegment =
  | { op: "M" | "L"; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "Z" };

export interface RunStyle {
  sizePt: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: Rgba;
  /** CSS font-family list. */
  font: string;
  /** Superscript (>0) / subscript (<0) offset in percent. */
  baseline: number;
  caps: "none" | "all" | "small";
  highlight?: Rgba;
}

export type TextRun = { text: string; style: RunStyle } | { br: true; style: RunStyle };

export type Spacing = { pct: number } | { pts: number };

export interface Bullet {
  text: string;
  color: Rgba;
  font: string;
  /** Size relative to the first run, 1 = same. */
  scale: number;
}

export interface TextParagraph {
  align: "left" | "center" | "right" | "justify";
  /** Left margin and first-line indent, EMU. */
  marL: number;
  indent: number;
  rtl: boolean;
  lineSpacing: Spacing;
  spaceBefore: Spacing;
  spaceAfter: Spacing;
  bullet?: Bullet;
  runs: TextRun[];
  /** Style used for an empty paragraph's line height. */
  endStyle: RunStyle;
  level: number;
}

export interface TextBody {
  paragraphs: TextParagraph[];
  /** Insets in EMU. */
  insets: { l: number; t: number; r: number; b: number };
  anchor: "top" | "middle" | "bottom";
  wrap: boolean;
  /** normAutofit font scale and line spacing reduction (fractions). */
  fontScale: number;
  lineReduction: number;
  /** Text rotated 90/270 degrees (vert, vert270, eaVert ...). */
  vertical?: "vertical-rl" | "sideways-lr";
  /** Placeholder kind when the shape is a placeholder ("title", "body", ...). */
  placeholder?: string;
}

export interface TableCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  fill?: Fill;
  borders: { l?: Stroke; r?: Stroke; t?: Stroke; b?: Stroke };
  text?: TextBody;
}

export interface TableModel {
  /** Column widths and row heights in EMU. */
  cols: number[];
  rows: number[];
  cells: TableCell[];
}

interface NodeBase {
  xf: Xform;
  name: string;
}

export interface ShapeNode extends NodeBase {
  type: "shape";
  geometry: Geometry;
  fill: Fill;
  stroke?: Stroke;
  shadow?: Shadow;
  text?: TextBody;
}

export interface PictureNode extends NodeBase {
  type: "picture";
  src: string;
  natural?: { w: number; h: number };
  crop?: CropRect;
  geometry: Geometry;
  stroke?: Stroke;
  shadow?: Shadow;
}

export interface TableNode extends NodeBase {
  type: "table";
  table: TableModel;
}

/** Content we cannot rebuild (charts, SmartArt, OLE, video, unsupported image types). */
export interface MediaNode extends NodeBase {
  type: "media";
  label: string;
  poster?: string;
}

export type SlideNode = ShapeNode | PictureNode | TableNode | MediaNode;

export interface SlideModel {
  /** 1-based slide number in the deck. */
  number: number;
  background: Fill;
  nodes: SlideNode[];
  /** Set when the slide could not be read; the emitter shows a labelled placeholder. */
  error?: string;
}

export interface Presentation {
  /** Slide size in EMU. */
  width: number;
  height: number;
  slides: SlideModel[];
  /** Slides not read because of the slide limit. */
  droppedSlides: number;
  title?: string;
}
