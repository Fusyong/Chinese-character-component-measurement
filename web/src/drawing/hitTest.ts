import type { Annotation } from './types';
import { annularHandlePoints, dist, normRect, pointInAnnularSector, pointInRect, pointSegDist } from './geom';
import { equalSpacingBBox, equalSpacingGeometry } from './equalSpacingTemplate';
import { effectiveProportionRatios, proportionSplitPoints } from './proportionScale';

export type HitResult =
  | { kind: 'none' }
  | { kind: 'move'; annId: string }
  | { kind: 'handle'; annId: string; handle: string };

const HANDLE_R = 8;

export function hitTestAnnotations(px: number, py: number, annotations: Annotation[], width: number): HitResult {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i]!;
    const h = hitAnnotation(px, py, ann, width);
    if (h.kind !== 'none') return h;
  }
  return { kind: 'none' };
}

function nearHandle(px: number, py: number, hx: number, hy: number) {
  return dist(px, py, hx, hy) <= HANDLE_R;
}

function hitAnnotation(px: number, py: number, ann: Annotation, width: number): HitResult {
  switch (ann.kind) {
    case 'line':
    case 'arrow':
      if (nearHandle(px, py, ann.x0, ann.y0)) return { kind: 'handle', annId: ann.id, handle: 'p0' };
      if (nearHandle(px, py, ann.x1, ann.y1)) return { kind: 'handle', annId: ann.id, handle: 'p1' };
      if (pointSegDist(px, py, ann.x0, ann.y0, ann.x1, ann.y1) < 8) return { kind: 'move', annId: ann.id };
      break;
    case 'rect':
    case 'square':
    case 'bboxCopy':
    case 'bodyBBoxCopy':
      if (nearHandle(px, py, ann.x0, ann.y0)) return { kind: 'handle', annId: ann.id, handle: 'p0' };
      if (nearHandle(px, py, ann.x1, ann.y1)) return { kind: 'handle', annId: ann.id, handle: 'p1' };
      if (pointInRect(px, py, ann.x0, ann.y0, ann.x1, ann.y1, 0)) return { kind: 'move', annId: ann.id };
      break;
    case 'equalSpacing': {
      if (nearHandle(px, py, ann.x0, ann.y0)) return { kind: 'handle', annId: ann.id, handle: 'p0' };
      if (nearHandle(px, py, ann.x1, ann.y1)) return { kind: 'handle', annId: ann.id, handle: 'p1' };
      const { lines, circles } = equalSpacingGeometry(
        ann.x0,
        ann.y0,
        ann.x1,
        ann.y1,
        ann.count,
        ann.orientation
      );
      for (const [a, b] of lines) {
        if (pointSegDist(px, py, a.x, a.y, b.x, b.y) < 10) return { kind: 'move', annId: ann.id };
      }
      for (const c of circles) {
        if (Math.abs(dist(px, py, c.cx, c.cy) - c.r) < 10) return { kind: 'move', annId: ann.id };
      }
      const b = equalSpacingBBox(ann.x0, ann.y0, ann.x1, ann.y1, ann.count, ann.orientation);
      if (pointInRect(px, py, b.minX, b.minY, b.minX + b.w, b.minY + b.h, 4)) return { kind: 'move', annId: ann.id };
      break;
    }
    case 'proportionScale': {
      if (nearHandle(px, py, ann.x0, ann.y0)) return { kind: 'handle', annId: ann.id, handle: 'p0' };
      if (nearHandle(px, py, ann.x1, ann.y1)) return { kind: 'handle', annId: ann.id, handle: 'p1' };
      const ratios = effectiveProportionRatios(ann.count, ann.ratios);
      const splits = proportionSplitPoints(ann.x0, ann.y0, ann.x1, ann.y1, ratios);
      for (let i = 0; i < splits.length; i++) {
        const sp = splits[i]!;
        if (nearHandle(px, py, sp.x, sp.y)) return { kind: 'handle', annId: ann.id, handle: `split:${i}` };
      }
      const dx = ann.x1 - ann.x0;
      const dy = ann.y1 - ann.y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const tickR = 12;
      for (let i = 0; i < splits.length; i++) {
        const sp = splits[i]!;
        if (
          pointSegDist(px, py, sp.x - nx * tickR, sp.y - ny * tickR, sp.x + nx * tickR, sp.y + ny * tickR) < 10
        ) {
          return { kind: 'handle', annId: ann.id, handle: `split:${i}` };
        }
      }
      if (pointSegDist(px, py, ann.x0, ann.y0, ann.x1, ann.y1) < 10) return { kind: 'move', annId: ann.id };
      break;
    }
    case 'annularSector': {
      const hp = annularHandlePoints(ann);
      if (nearHandle(px, py, hp.c.x, hp.c.y)) return { kind: 'handle', annId: ann.id, handle: 'c' };
      if (nearHandle(px, py, hp.is.x, hp.is.y)) return { kind: 'handle', annId: ann.id, handle: 'is' };
      if (nearHandle(px, py, hp.ie.x, hp.ie.y)) return { kind: 'handle', annId: ann.id, handle: 'ie' };
      if (nearHandle(px, py, hp.os.x, hp.os.y)) return { kind: 'handle', annId: ann.id, handle: 'os' };
      if (nearHandle(px, py, hp.oe.x, hp.oe.y)) return { kind: 'handle', annId: ann.id, handle: 'oe' };
      if (pointInAnnularSector(px, py, ann)) return { kind: 'move', annId: ann.id };
      break;
    }
    case 'crossMark':
    case 'centroidMark':
    case 'circleMark':
      if (dist(px, py, ann.x, ann.y) < ann.size) return { kind: 'move', annId: ann.id };
      if (nearHandle(px, py, ann.x + ann.size / 2, ann.y)) return { kind: 'handle', annId: ann.id, handle: 'size' };
      break;
    case 'polygon':
    case 'polyline':
      for (let i = 0; i < ann.points.length; i++) {
        const pt = ann.points[i]!;
        if (nearHandle(px, py, pt.x, pt.y)) return { kind: 'handle', annId: ann.id, handle: `v:${i}` };
      }
      {
        const segCount = ann.kind === 'polyline' ? ann.points.length - 1 : ann.points.length;
        for (let i = 0; i < segCount; i++) {
          const a = ann.points[i]!;
          const b = ann.points[(i + 1) % ann.points.length]!;
          if (ann.kind === 'polygon' && !ann.closed && i === ann.points.length - 1) break;
          if (pointSegDist(px, py, a.x, a.y, b.x, b.y) < 8) return { kind: 'move', annId: ann.id };
        }
      }
      break;
    case 'centroidCopy':
      if (dist(px, py, ann.x, ann.y) < Math.max(ann.rx, ann.ry) + 6) return { kind: 'move', annId: ann.id };
      break;
  }
  return { kind: 'none' };
}

export function hitTestStrokeMask(
  px: number,
  py: number,
  width: number,
  height: number,
  masks: { fileKey: string; groupId: string; mask: Uint8Array }[]
): string | null {
  const x = Math.floor(px);
  const y = Math.floor(py);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const i = y * width + x;
  for (let m = masks.length - 1; m >= 0; m--) {
    const item = masks[m]!;
    if (item.mask[i]) return item.fileKey;
  }
  return null;
}
