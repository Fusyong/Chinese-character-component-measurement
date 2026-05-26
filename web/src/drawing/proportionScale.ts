/** 分隔线数 → 等比例各段相对长度（n 条线 → n−1 段） */
export function equalProportionRatios(dividerCount: number): number[] {
  const segs = Math.max(1, Math.round(dividerCount) - 1);
  return Array(segs).fill(1);
}

/** 保证 ratios 长度与分隔线数一致 */
export function effectiveProportionRatios(count: number, ratios: number[]): number[] {
  const n = Math.max(1, Math.round(count) - 1);
  if (ratios.length === n) return ratios;
  return equalProportionRatios(count);
}

/** 解析相对长度数组，如 "3,7" 或 "30，70" */
export function parseProportionRatios(text: string): number[] {
  const parts = text
    .split(/[,，\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parts.length > 0 ? parts : [1];
}

/** 相对长度 → 分割点 t∈(0,1)，不含 0 与 1 */
export function proportionSplitT(ratios: number[]): number[] {
  const sum = ratios.reduce((a, b) => a + b, 0) || 1;
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < ratios.length - 1; i++) {
    acc += ratios[i]!;
    out.push(acc / sum);
  }
  return out;
}

/** 分割点 t → 各段相对长度 */
export function ratiosFromSplitT(splits: number[]): number[] {
  const pts = [0, ...splits, 1];
  const ratios: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    ratios.push(Math.max(pts[i + 1]! - pts[i]!, 1e-6));
  }
  return ratios;
}

/** 指针在主线段上的参数 t∈[0,1] */
export function paramOnProportionLine(x0: number, y0: number, x1: number, y1: number, px: number, py: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return 0;
  const t = ((px - x0) * dx + (py - y0) * dy) / len2;
  return Math.max(0, Math.min(1, t));
}

/** 约束第 i 个内部分割点的 t（0-based） */
export function clampSplitT(splits: number[], index: number, t: number, margin = 0.015): number {
  const lo = index === 0 ? margin : splits[index - 1]! + margin;
  const hi = index === splits.length - 1 ? 1 - margin : splits[index + 1]! - margin;
  if (lo >= hi) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, t));
}

export function proportionSplitPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ratios: number[]
): { t: number; x: number; y: number }[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return proportionSplitT(ratios).map((t) => ({
    t,
    x: x0 + dx * t,
    y: y0 + dy * t,
  }));
}

export function formatGridLength(pxLen: number, gridUnit: number): string {
  const gu = gridUnit > 0 ? gridUnit : 1;
  const v = Math.round((pxLen / gu) * 10) / 10;
  return Number.isInteger(v) ? String(v) : String(v);
}

/** 标签偏移：近水平→主线上方，近竖直→主线右方（canvas 坐标） */
export function proportionLabelOffset(
  dx: number,
  dy: number,
  dist: number
): { x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline } {
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const mostlyH = Math.abs(dx) >= Math.abs(dy);
  if (mostlyH) {
    return { x: -nx * dist, y: -ny * dist, align: 'center', baseline: 'bottom' };
  }
  const rx = dy / len;
  const ry = -dx / len;
  return { x: rx * dist, y: ry * dist, align: 'left', baseline: 'middle' };
}
