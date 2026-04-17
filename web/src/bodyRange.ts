import type { Rect } from './types';

function clampRect(r: Rect, width: number, height: number): Rect {
  return {
    x0: Math.max(0, Math.min(width - 1, r.x0)),
    y0: Math.max(0, Math.min(height - 1, r.y0)),
    x1: Math.max(0, Math.min(width - 1, r.x1)),
    y1: Math.max(0, Math.min(height - 1, r.y1)),
  };
}

function slidingMinInterval(counts: Uint32Array, target: number): { l: number; r: number } | null {
  // Find minimal-length [l,r] with sum >= target. counts are nonnegative.
  let bestL = 0;
  let bestR = counts.length - 1;
  let bestLen = Number.POSITIVE_INFINITY;

  let l = 0;
  let sum = 0;
  for (let r = 0; r < counts.length; r++) {
    sum += counts[r];
    while (l <= r && sum - counts[l] >= target) {
      sum -= counts[l];
      l++;
    }
    if (sum >= target) {
      const len = r - l;
      if (len < bestLen) {
        bestLen = len;
        bestL = l;
        bestR = r;
      }
    }
  }

  if (!Number.isFinite(bestLen)) return null;
  return { l: bestL, r: bestR };
}

export function computeBodyBBoxQuantile1d(mask: Uint8Array, width: number, height: number, ratio: number): Rect | undefined {
  if (ratio <= 0 || ratio > 1) throw new Error('ratio must be in (0,1]');

  let area = 0;
  for (let i = 0; i < mask.length; i++) area += mask[i];
  if (area === 0) return undefined;

  const target = Math.ceil(area * ratio);

  const xCounts = new Uint32Array(width);
  const yCounts = new Uint32Array(height);
  let idx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, idx++) {
      if (mask[idx] === 0) continue;
      xCounts[x]++;
      yCounts[y]++;
    }
  }

  const xi = slidingMinInterval(xCounts, target);
  const yi = slidingMinInterval(yCounts, target);
  if (!xi || !yi) return undefined;

  return {
    x0: xi.l,
    x1: xi.r,
    y0: yi.l,
    y1: yi.r,
  };
}

export function verifyRectRatio(mask: Uint8Array, width: number, height: number, rect: Rect, fullArea: number): number {
  const r = clampRect(rect, width, height);
  let inside = 0;
  for (let y = r.y0; y <= r.y1; y++) {
    const base = y * width;
    for (let x = r.x0; x <= r.x1; x++) {
      inside += mask[base + x];
    }
  }
  return fullArea > 0 ? inside / fullArea : 0;
}

function downsampleMask(mask: Uint8Array, width: number, height: number, targetMax: number): { m: Uint8Array; w: number; h: number; sx: number; sy: number } {
  const scale = Math.min(1, targetMax / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const sx = width / w;
  const sy = height / h;

  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(height - 1, Math.floor((y + 1) * sy) - 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(width - 1, Math.floor((x + 1) * sx) - 1);
      let v = 0;
      for (let yy = y0; yy <= y1 && v === 0; yy++) {
        const base = yy * width;
        for (let xx = x0; xx <= x1; xx++) {
          if (mask[base + xx]) {
            v = 1;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return { m: out, w, h, sx, sy };
}

export function computeBodyBBoxIntegral2d(
  mask: Uint8Array,
  width: number,
  height: number,
  ratio: number,
  opts: { downsampleToMax: number }
): Rect | undefined {
  if (ratio <= 0 || ratio > 1) throw new Error('ratio must be in (0,1]');

  let area = 0;
  for (let i = 0; i < mask.length; i++) area += mask[i];
  if (area === 0) return undefined;
  const target = Math.ceil(area * ratio);

  // Work on a downsampled grid to keep O(h^2*w) fast.
  const ds = downsampleMask(mask, width, height, opts.downsampleToMax);
  const w = ds.w;
  const h = ds.h;
  const dm = ds.m;

  let dArea = 0;
  for (let i = 0; i < dm.length; i++) dArea += dm[i];
  if (dArea === 0) return undefined;
  const dTarget = Math.ceil(dArea * ratio);

  let best: { x0: number; x1: number; y0: number; y1: number; area: number } | null = null;

  const col = new Uint16Array(w);
  for (let y0 = 0; y0 < h; y0++) {
    col.fill(0);
    for (let y1 = y0; y1 < h; y1++) {
      const rowBase = y1 * w;
      for (let x = 0; x < w; x++) col[x] += dm[rowBase + x];

      // Find minimal width subarray with sum>=dTarget (nonnegative, sliding window).
      let sum = 0;
      let l = 0;
      for (let r = 0; r < w; r++) {
        sum += col[r];
        while (l <= r && sum - col[l] >= dTarget) {
          sum -= col[l];
          l++;
        }
        if (sum >= dTarget) {
          const rectArea = (y1 - y0 + 1) * (r - l + 1);
          if (!best || rectArea < best.area) {
            best = { x0: l, x1: r, y0, y1, area: rectArea };
          }
        }
      }
    }
  }

  if (!best) return undefined;

  // Map back to original resolution as a coarse box.
  const x0 = Math.floor(best.x0 * ds.sx);
  const x1 = Math.min(width - 1, Math.ceil((best.x1 + 1) * ds.sx) - 1);
  const y0 = Math.floor(best.y0 * ds.sy);
  const y1 = Math.min(height - 1, Math.ceil((best.y1 + 1) * ds.sy) - 1);

  return clampRect({ x0, y0, x1, y1 }, width, height);
}

