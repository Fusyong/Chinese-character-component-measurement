import type { Point, Rect } from './types';

export function computeBasicMetrics(mask: Uint8Array, width: number, height: number): {
  area: number;
  centroid?: Point;
  bbox?: Rect;
} {
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;

  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      if (mask[i] === 0) continue;
      area++;
      sumX += x;
      sumY += y;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }

  if (area === 0) return { area };

  return {
    area,
    centroid: { x: sumX / area, y: sumY / area },
    bbox: { x0, y0, x1, y1 },
  };
}

