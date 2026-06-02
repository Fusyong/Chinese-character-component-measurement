import type { Point } from './types';

export function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(bx - ax, by - ay);
}

/** 两方向夹角的锐角（弧度） */
export function acuteAngleRad(a1: number, a2: number) {
  let d = a1 - a2;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const ad = Math.abs(d);
  return ad > Math.PI / 2 ? Math.PI - ad : ad;
}

export type ArrowStartTickGeom = {
  tx: number;
  ty: number;
  tickLen: number;
  arcR: number;
  tickAng: number;
  mainAng: number;
  acuteRad: number;
  arcStart: number;
  arcSweep: number;
  /** 短线相对主线方向（+1 / -1），标签与之同侧 */
  labelSide: number;
};

const TICK_DIR_CANDIDATES = [0, Math.PI, Math.PI / 2, -Math.PI / 2] as const;

function acuteArcSweep(from: number, to: number) {
  let sweep = to - from;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (Math.abs(sweep) > Math.PI / 2) {
    sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI;
  }
  return sweep;
}

/** 起点短线：水平/垂直中取与主线夹角最小者，单侧伸出 */
export function arrowStartTickGeometry(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lw: number
): ArrowStartTickGeom | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (Math.hypot(dx, dy) < 1e-6) return null;

  const mainAng = Math.atan2(dy, dx);
  let tickAng: number = TICK_DIR_CANDIDATES[0];
  let acuteRad = acuteAngleRad(mainAng, tickAng);
  let bestDot = -Infinity;
  for (const cand of TICK_DIR_CANDIDATES) {
    const ac = acuteAngleRad(mainAng, cand);
    const dot = Math.cos(cand) * Math.cos(mainAng) + Math.sin(cand) * Math.sin(mainAng);
    if (ac < acuteRad - 1e-9 || (Math.abs(ac - acuteRad) < 1e-9 && dot > bestDot)) {
      acuteRad = ac;
      tickAng = cand;
      bestDot = dot;
    }
  }

  const arcR = Math.max(42, lw * 18);
  const tickLen = arcR;
  const tx = x0 + Math.cos(tickAng) * arcR;
  const ty = y0 + Math.sin(tickAng) * arcR;
  const arcSweep = acuteArcSweep(tickAng, mainAng);
  const crossZ = Math.sin(tickAng - mainAng);
  const labelSide = Math.abs(crossZ) < 1e-9 ? 1 : Math.sign(crossZ);

  return { tx, ty, tickLen, arcR, tickAng, mainAng, acuteRad, arcStart: tickAng, arcSweep, labelSide };
}

export function snapAngle8(x0: number, y0: number, x1: number, y1: number): { x: number; y: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: x1, y: y1 };
  const a = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(a / step) * step;
  return { x: x0 + Math.cos(snapped) * len, y: y0 + Math.sin(snapped) * len };
}

/** 16 向吸附：0°、30°、45°、60°、90° … 每象限 4 个方向 */
const SNAP16_DEG = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330] as const;

export function snapAngle16(x0: number, y0: number, x1: number, y1: number): { x: number; y: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: x1, y: y1 };
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  let best: number = SNAP16_DEG[0];
  let bestDiff = Infinity;
  for (const d of SNAP16_DEG) {
    let diff = Math.abs(deg - d);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  const rad = (best * Math.PI) / 180;
  return { x: x0 + Math.cos(rad) * len, y: y0 + Math.sin(rad) * len };
}

export function angleSnappedPoint(
  ax: number,
  ay: number,
  x: number,
  y: number,
  mode: 'snap8' | 'snap16',
  opts: { shift?: boolean; requireShift?: boolean } = {}
): { x: number; y: number } {
  const requireShift = opts.requireShift ?? true;
  const shift = opts.shift ?? false;
  if (requireShift && !shift) return { x, y };
  return mode === 'snap16' ? snapAngle16(ax, ay, x, y) : snapAngle8(ax, ay, x, y);
}

export function constrainAxis(x0: number, y0: number, x1: number, y1: number, shift: boolean): { x: number; y: number } {
  if (!shift) return { x: x1, y: y1 };
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  if (dx > dy) return { x: x1, y: y0 };
  return { x: x0, y: y1 };
}

export function pointSegDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return dist(px, py, x0, y0);
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, x0 + t * dx, y0 + t * dy);
}

export function normRect(x0: number, y0: number, x1: number, y1: number) {
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
}

/** 第一点为固定顶点，第二点为对角顶点；Shift 时边长取 max(|dx|,|dy|) */
export function squareFromFixedCorner(x0: number, y0: number, x1: number, y1: number) {
  const side = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const sx = x1 >= x0 ? 1 : -1;
  const sy = y1 >= y0 ? 1 : -1;
  return { x0, y0, x1: x0 + sx * side, y1: y0 + sy * side };
}

/** 拖拽对角定矩形；forceSquare 时以第一点为顶点 */
export function rectFromDrag(x0: number, y0: number, x1: number, y1: number, forceSquare: boolean) {
  if (forceSquare) return squareFromFixedCorner(x0, y0, x1, y1);
  return { x0, y0, x1, y1 };
}

/** 拖拽角点；Shift 时相对锚点保持正方形（锚点为对角顶点） */
export function squareCornerFromAnchor(ax: number, ay: number, x: number, y: number) {
  const r = squareFromFixedCorner(ax, ay, x, y);
  return { x: r.x1, y: r.y1 };
}

export function pointInRect(px: number, py: number, x0: number, y0: number, x1: number, y1: number, pad = 6) {
  const r = normRect(x0, y0, x1, y1);
  return px >= r.x0 - pad && px <= r.x1 + pad && py >= r.y0 - pad && py <= r.y1 + pad;
}

export function gridUnit(canvasWidth: number) {
  return canvasWidth / 100;
}

export function angleOnCircle(cx: number, cy: number, px: number, py: number) {
  return Math.atan2(py - cy, px - cx);
}

export function polarPoint(cx: number, cy: number, r: number, a: number): Point {
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

/** 默认扇形：左下四分之一环（canvas 坐标，a0=下、a1=左） */
export const ANNULAR_DEFAULT_A0 = Math.PI / 2;
export const ANNULAR_DEFAULT_A1 = Math.PI;

export function annularHandlePoints(ann: {
  cx: number;
  cy: number;
  rInner: number;
  rOuter: number;
  a0: number;
  a1: number;
}) {
  const { cx, cy, rInner, rOuter, a0, a1 } = ann;
  return {
    c: { x: cx, y: cy },
    is: polarPoint(cx, cy, rInner, a0),
    ie: polarPoint(cx, cy, rInner, a1),
    os: polarPoint(cx, cy, rOuter, a0),
    oe: polarPoint(cx, cy, rOuter, a1),
  };
}

function normAngle(a: number) {
  let t = a;
  while (t < 0) t += 2 * Math.PI;
  while (t >= 2 * Math.PI) t -= 2 * Math.PI;
  return t;
}

export function angleInSector(a: number, a0: number, a1: number) {
  const ang = normAngle(a);
  const s = normAngle(a0);
  const e = normAngle(a1);
  if (s <= e) return ang >= s && ang <= e;
  return ang >= s || ang <= e;
}

export function pointInAnnularSector(
  px: number,
  py: number,
  ann: { cx: number; cy: number; rInner: number; rOuter: number; a0: number; a1: number },
  pad = 6
) {
  const d = dist(px, py, ann.cx, ann.cy);
  if (d < ann.rInner - pad || d > ann.rOuter + pad) return false;
  return angleInSector(angleOnCircle(ann.cx, ann.cy, px, py), ann.a0, ann.a1);
}

export function moveAnnotation(ann: import('./types').Annotation, dx: number, dy: number): import('./types').Annotation {
  switch (ann.kind) {
    case 'line':
    case 'arrow':
    case 'proportionScale':
      return { ...ann, x0: ann.x0 + dx, y0: ann.y0 + dy, x1: ann.x1 + dx, y1: ann.y1 + dy };
    case 'rect':
      return { ...ann, x0: ann.x0 + dx, y0: ann.y0 + dy, x1: ann.x1 + dx, y1: ann.y1 + dy };
    case 'square':
      return { ...ann, x0: ann.x0 + dx, y0: ann.y0 + dy, x1: ann.x1 + dx, y1: ann.y1 + dy };
    case 'equalSpacing':
      return { ...ann, x0: ann.x0 + dx, y0: ann.y0 + dy, x1: ann.x1 + dx, y1: ann.y1 + dy };
    case 'polygon':
    case 'polyline':
      return {
        ...ann,
        points: ann.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    case 'annularSector':
      return { ...ann, cx: ann.cx + dx, cy: ann.cy + dy };
    case 'crossMark':
    case 'centroidMark':
    case 'circleMark':
      return { ...ann, x: ann.x + dx, y: ann.y + dy };
    case 'centroidCopy':
      return { ...ann, x: ann.x + dx, y: ann.y + dy };
    case 'bboxCopy':
    case 'bodyBBoxCopy':
      return { ...ann, x0: ann.x0 + dx, y0: ann.y0 + dy, x1: ann.x1 + dx, y1: ann.y1 + dy };
    default:
      return ann;
  }
}

export function pathVertexAnchor(points: Point[], index: number, closed: boolean): Point {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  if (closed) return points[(index - 1 + n) % n]!;
  if (index > 0) return points[index - 1]!;
  if (n > 1) return points[1]!;
  return points[0]!;
}
