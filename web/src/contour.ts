import type { ContourPolyline, Point } from './types';

type Segment = { a: Point; b: Point };

function keyOf(p: Point): string {
  // All points are on 0.5 grid; key on doubled ints.
  const x2 = Math.round(p.x * 2);
  const y2 = Math.round(p.y * 2);
  return `${x2},${y2}`;
}

function addSeg(segs: Segment[], ax: number, ay: number, bx: number, by: number) {
  segs.push({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
}

export function marchingSquaresContours(mask: Uint8Array, width: number, height: number): ContourPolyline[] {
  if (width < 2 || height < 2) return [];

  const segs: Segment[] = [];

  // Sample helper (treat outside as 0).
  const at = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return mask[y * width + x] ? 1 : 0;
  };

  // Marching squares over pixel grid cells: corners at integer coords (x,y).
  // We use pixel centers as corners; the resulting contour lies on half-integer coordinates.
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);

      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (c === 0 || c === 15) continue;

      // Edge midpoints (in pixel coords).
      const xm = x + 0.5;
      const ym = y + 0.5;

      const top = { x: xm, y: y };
      const right = { x: x + 1, y: ym };
      const bottom = { x: xm, y: y + 1 };
      const left = { x: x, y: ym };

      // Cases: standard marching squares with ambiguous 5/10 resolved by connectivity of foreground.
      // Here we pick a consistent rule: if tl==br (diagonal), connect edges to keep small components tight.
      switch (c) {
        case 1: // 0001
          addSeg(segs, left.x, left.y, bottom.x, bottom.y);
          break;
        case 2: // 0010
          addSeg(segs, bottom.x, bottom.y, right.x, right.y);
          break;
        case 3: // 0011
          addSeg(segs, left.x, left.y, right.x, right.y);
          break;
        case 4: // 0100
          addSeg(segs, top.x, top.y, right.x, right.y);
          break;
        case 5: // 0101 (ambiguous)
          if (tl === 1) {
            addSeg(segs, top.x, top.y, left.x, left.y);
            addSeg(segs, bottom.x, bottom.y, right.x, right.y);
          } else {
            addSeg(segs, top.x, top.y, right.x, right.y);
            addSeg(segs, bottom.x, bottom.y, left.x, left.y);
          }
          break;
        case 6: // 0110
          addSeg(segs, top.x, top.y, bottom.x, bottom.y);
          break;
        case 7: // 0111
          addSeg(segs, top.x, top.y, left.x, left.y);
          break;
        case 8: // 1000
          addSeg(segs, top.x, top.y, left.x, left.y);
          break;
        case 9: // 1001
          addSeg(segs, top.x, top.y, bottom.x, bottom.y);
          break;
        case 10: // 1010 (ambiguous)
          if (tl === 1) {
            addSeg(segs, top.x, top.y, right.x, right.y);
            addSeg(segs, bottom.x, bottom.y, left.x, left.y);
          } else {
            addSeg(segs, top.x, top.y, left.x, left.y);
            addSeg(segs, bottom.x, bottom.y, right.x, right.y);
          }
          break;
        case 11: // 1011
          addSeg(segs, top.x, top.y, right.x, right.y);
          break;
        case 12: // 1100
          addSeg(segs, left.x, left.y, right.x, right.y);
          break;
        case 13: // 1101
          addSeg(segs, bottom.x, bottom.y, right.x, right.y);
          break;
        case 14: // 1110
          addSeg(segs, left.x, left.y, bottom.x, bottom.y);
          break;
        default:
          break;
      }
    }
  }

  // Stitch segments into polylines.
  const nextMap = new Map<string, Point[]>();
  const usedSeg = new Array(segs.length).fill(false);

  const addAdj = (from: Point, to: Point) => {
    const k = keyOf(from);
    const arr = nextMap.get(k);
    if (arr) arr.push(to);
    else nextMap.set(k, [to]);
  };

  for (const s of segs) {
    addAdj(s.a, s.b);
    addAdj(s.b, s.a);
  }

  // To trace, we need a set of unused directed edges. We'll key directed edges by pair of keys.
  const edgeUsed = new Set<string>();
  const edgeKey = (a: Point, b: Point) => `${keyOf(a)}>${keyOf(b)}`;

  const polylines: ContourPolyline[] = [];

  for (const s of segs) {
    // Start from each segment's both directions if not used.
    for (const [start, next] of [
      [s.a, s.b] as const,
      [s.b, s.a] as const,
    ]) {
      if (edgeUsed.has(edgeKey(start, next))) continue;

      const pts: Point[] = [start];
      let cur = start;
      let prev: Point | null = null;

      // Walk until dead-end or returns to start.
      while (true) {
        const adj = nextMap.get(keyOf(cur)) ?? [];
        let candidate: Point | null = null;
        // Prefer continuing not to go back to prev.
        for (const a of adj) {
          if (prev && keyOf(a) === keyOf(prev)) continue;
          if (!edgeUsed.has(edgeKey(cur, a))) {
            candidate = a;
            break;
          }
        }
        // If none, allow back edge if unused.
        if (!candidate) {
          for (const a of adj) {
            if (!edgeUsed.has(edgeKey(cur, a))) {
              candidate = a;
              break;
            }
          }
        }

        if (!candidate) break;

        edgeUsed.add(edgeKey(cur, candidate));
        prev = cur;
        cur = candidate;
        pts.push(cur);

        if (keyOf(cur) === keyOf(start)) break;
        if (pts.length > 500000) break; // safety
      }

      if (pts.length >= 4) {
        const closed = keyOf(pts[0]) === keyOf(pts[pts.length - 1]);
        polylines.push({ closed, points: pts });
      }
    }
  }

  // Deduplicate very short/empty polylines.
  return polylines.filter((p) => p.points.length >= 4);
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

export function simplifyPolylineRDP(pl: ContourPolyline, epsilon: number): ContourPolyline {
  if (epsilon <= 0 || pl.points.length <= 4) return pl;

  const pts = pl.points;
  // For closed polylines, keep closure by simplifying without the duplicate last point, then re-close.
  const isClosed = pl.closed && keyOf(pts[0]) === keyOf(pts[pts.length - 1]);
  const work = isClosed ? pts.slice(0, -1) : pts.slice();

  const keep = new Array(work.length).fill(false);
  keep[0] = true;
  keep[work.length - 1] = true;

  const stack: Array<[number, number]> = [[0, work.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    const a = work[i0];
    const b = work[i1];
    for (let i = i0 + 1; i < i1; i++) {
      const d = perpendicularDistance(work[i], a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx !== -1) {
      keep[idx] = true;
      stack.push([i0, idx], [idx, i1]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < work.length; i++) if (keep[i]) out.push(work[i]);

  if (isClosed) out.push(out[0]);
  return { closed: isClosed, points: out };
}

