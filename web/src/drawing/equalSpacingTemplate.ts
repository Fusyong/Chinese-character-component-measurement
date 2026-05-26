import type { Point } from './types';

/** |dy|≥|dx| → 竖向（沿 Y 等分，画横线）；否则横向 */
export function equalSpacingOrientationFromDrag(x0: number, y0: number, x1: number, y1: number): 'h' | 'v' {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  return dy >= dx ? 'v' : 'h';
}

export type EqualSpacingGeom = {
  lines: [Point, Point][];
  circles: { cx: number; cy: number; r: number }[];
  gap: number;
  lineLen: number;
};

/**
 * 首条线在起点、末条在终点；中间均分。相邻间距 gap，圆直径与分隔线长度均为 0.6×gap。
 */
export function equalSpacingGeometry(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  count: number,
  orientation: 'h' | 'v'
): EqualSpacingGeom {
  const n = Math.max(1, Math.round(count));
  const lines: [Point, Point][] = [];
  const circles: { cx: number; cy: number; r: number }[] = [];

  const axisPos = (n === 1 ? [0] : Array.from({ length: n }, (_, k) => k / (n - 1)));

  if (orientation === 'v') {
    const midX = (x0 + x1) / 2;
    const ys = axisPos.map((t) => y0 + t * (y1 - y0));
    const gap = n > 1 ? Math.abs(y1 - y0) / (n - 1) || 1 : 1;
    const lineLen = gap * 0.6;
    const circleR = lineLen / 2;
    const half = lineLen / 2;
    for (const y of ys) {
      lines.push([{ x: midX - half, y }, { x: midX + half, y }]);
    }
    for (let k = 0; k < ys.length - 1; k++) {
      circles.push({ cx: midX, cy: (ys[k]! + ys[k + 1]!) / 2, r: circleR });
    }
    return { lines, circles, gap, lineLen };
  }

  const midY = (y0 + y1) / 2;
  const xs = axisPos.map((t) => x0 + t * (x1 - x0));
  const gap = n > 1 ? Math.abs(x1 - x0) / (n - 1) || 1 : 1;
  const lineLen = gap * 0.6;
  const circleR = lineLen / 2;
  const half = lineLen / 2;
  for (const x of xs) {
    lines.push([{ x, y: midY - half }, { x, y: midY + half }]);
  }
  for (let k = 0; k < xs.length - 1; k++) {
    circles.push({ cx: (xs[k]! + xs[k + 1]!) / 2, cy: midY, r: circleR });
  }
  return { lines, circles, gap, lineLen };
}

export function equalSpacingBBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  count: number,
  orientation: 'h' | 'v'
) {
  const { lines, circles } = equalSpacingGeometry(x0, y0, x1, y1, count, orientation);
  let minX = Math.min(x0, x1);
  let minY = Math.min(y0, y1);
  let maxX = Math.max(x0, x1);
  let maxY = Math.max(y0, y1);
  for (const [a, b] of lines) {
    for (const p of [a, b]) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  for (const c of circles) {
    minX = Math.min(minX, c.cx - c.r);
    maxX = Math.max(maxX, c.cx + c.r);
    minY = Math.min(minY, c.cy - c.r);
    maxY = Math.max(maxY, c.cy + c.r);
  }
  return { minX, minY, w: maxX - minX || 1, h: maxY - minY || 1 };
}

/** @deprecated */
export function equalSpacingTemplate(count: number, orientation: 'h' | 'v') {
  return equalSpacingGeometry(0, -0.5, 0, 0.5, count, orientation);
}

export function equalSpacingBounds(count: number, orientation: 'h' | 'v') {
  const b = equalSpacingBBox(0, -0.5, 0, 0.5, count, orientation);
  return { minX: b.minX, minY: b.minY, w: b.w, h: b.h };
}
