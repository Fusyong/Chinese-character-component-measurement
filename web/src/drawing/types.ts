export type DrawLayer = 'under' | 'top';

export type DrawStyle = {
  color: string;
  lineWidth: number;
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
};

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
  | EqualSpacingAnnotation
  | ProportionScaleAnnotation
  | AnnularSectorAnnotation
  | CrossMarkAnnotation
  | CentroidCopyAnnotation
  | BboxCopyAnnotation
  | BodyBBoxCopyAnnotation;

export type DrawTool =
  | 'select'
  | 'strokeFill'
  | 'line'
  | 'rect'
  | 'square'
  | 'arrow'
  | 'equalSpacing'
  | 'proportionScale'
  | 'annularSector'
  | 'crossMark'
  | 'copyCentroid'
  | 'copyBBox'
  | 'copyBodyBBox';

export type StrokeFillEntry = {
  fileKey: string;
  groupId: string;
  color: string;
  layer: DrawLayer;
};
