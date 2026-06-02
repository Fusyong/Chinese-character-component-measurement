export type DrawLayer = 'bottom' | 'middle' | 'top';

/** 兼容旧数据中的 under → middle */
export function normalizeDrawLayer(layer: string): DrawLayer {
  if (layer === 'under') return 'middle';
  if (layer === 'bottom' || layer === 'middle' || layer === 'top') return layer;
  return 'middle';
}

export const DRAW_LAYER_OPTIONS: { v: DrawLayer; t: string }[] = [
  { v: 'bottom', t: '下层（田字格下）' },
  { v: 'middle', t: '中层（田字格与笔画间）' },
  { v: 'top', t: '上层（笔画上）' },
];

export const STROKE_LAYER_OPTIONS: { v: DrawLayer; t: string }[] = [
  { v: 'middle', t: '中层（笔画下）' },
  { v: 'top', t: '上层（笔画上）' },
];

export type MarkIconKind = 'crossMark' | 'centroidMark' | 'circleMark';

export const MARK_ICON_KINDS: MarkIconKind[] = ['crossMark', 'centroidMark', 'circleMark'];

export function isMarkIconKind(kind: string): kind is MarkIconKind {
  return kind === 'crossMark' || kind === 'centroidMark' || kind === 'circleMark';
}

export function isMarkIconAnnotation(
  ann: { kind: string }
): ann is CrossMarkAnnotation | CentroidMarkAnnotation | CircleMarkAnnotation {
  return isMarkIconKind(ann.kind);
}

export type DrawStyle = {
  color: string;
  lineWidth: number;
};

export type MarkIconPreset = {
  size: number;
  style: DrawStyle;
  layer: DrawLayer;
};

export type Point = { x: number; y: number };

export type BaseAnnotation = {
  id: string;
  layer: DrawLayer;
  style: DrawStyle;
};

export type LineAnnotation = BaseAnnotation & {
  kind: 'line';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type RectAnnotation = BaseAnnotation & {
  kind: 'rect';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 填色为方形，不填色为方框；默认 true */
  filled?: boolean;
};

/** @deprecated 旧数据兼容，运行时等同 rect + filled */
export type SquareAnnotation = BaseAnnotation & {
  kind: 'square';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type ArrowAnnotation = BaseAnnotation & {
  kind: 'arrow';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type PolygonAnnotation = BaseAnnotation & {
  kind: 'polygon';
  points: Point[];
  closed: boolean;
  /** 填色为实心多边形，不填色为多边形框；默认 true */
  filled?: boolean;
};

export type PolylineAnnotation = BaseAnnotation & {
  kind: 'polyline';
  points: Point[];
};

export type EqualSpacingAnnotation = BaseAnnotation & {
  kind: 'equalSpacing';
  /** 竖向拉拽为 v（画横线）；横向拉拽为 h（画竖线） */
  orientation: 'h' | 'v';
  count: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type ProportionScaleAnnotation = BaseAnnotation & {
  kind: 'proportionScale';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 分隔线数（含起止端刻度，≥2） */
  count: number;
  /** 各段相对长度；默认等比例，拖拽分割点后可变 */
  ratios: number[];
};

export type AnnularSectorAnnotation = BaseAnnotation & {
  kind: 'annularSector';
  cx: number;
  cy: number;
  rInner: number;
  rOuter: number;
  a0: number;
  a1: number;
};

export type CrossMarkAnnotation = BaseAnnotation & {
  kind: 'crossMark';
  x: number;
  y: number;
  size: number;
};

export type CentroidMarkAnnotation = BaseAnnotation & {
  kind: 'centroidMark';
  x: number;
  y: number;
  size: number;
};

export type CircleMarkAnnotation = BaseAnnotation & {
  kind: 'circleMark';
  x: number;
  y: number;
  size: number;
};

export type CentroidCopyAnnotation = BaseAnnotation & {
  kind: 'centroidCopy';
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
};

export type BboxCopyAnnotation = BaseAnnotation & {
  kind: 'bboxCopy';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
};

export type BodyBBoxCopyAnnotation = BaseAnnotation & {
  kind: 'bodyBBoxCopy';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
};

export type FrameCopyAnnotation = BboxCopyAnnotation | BodyBBoxCopyAnnotation;

export type Annotation =
  | LineAnnotation
  | RectAnnotation
  | SquareAnnotation
  | ArrowAnnotation
  | PolygonAnnotation
  | PolylineAnnotation
  | EqualSpacingAnnotation
  | ProportionScaleAnnotation
  | AnnularSectorAnnotation
  | CrossMarkAnnotation
  | CentroidMarkAnnotation
  | CircleMarkAnnotation
  | CentroidCopyAnnotation
  | BboxCopyAnnotation
  | BodyBBoxCopyAnnotation;

export type DrawTool =
  | 'select'
  | 'strokeFill'
  | 'line'
  | 'rect'
  | 'arrow'
  | 'polygon'
  | 'polyline'
  | 'equalSpacing'
  | 'proportionScale'
  | 'annularSector'
  | 'crossMark'
  | 'centroidMark'
  | 'circleMark'
  | 'copyCentroid'
  | 'copyBBox'
  | 'copyBodyBBox';

export type StrokeFillEntry = {
  fileKey: string;
  groupId: string;
  color: string;
  layer: DrawLayer;
};

export function rectAnnotationFilled(ann: { kind: 'rect' | 'square'; filled?: boolean }): boolean {
  if (ann.kind === 'square') return true;
  return ann.filled ?? false;
}

export function polygonAnnotationFilled(ann: { filled?: boolean }): boolean {
  return ann.filled ?? false;
}
