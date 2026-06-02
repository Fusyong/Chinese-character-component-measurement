import type { Annotation, DrawLayer, DrawStyle, StrokeFillEntry } from './types';
import { polygonAnnotationFilled, rectAnnotationFilled } from './types';
import { arrowStartTickGeometry, annularHandlePoints, gridUnit } from './geom';
import { equalSpacingGeometry } from './equalSpacingTemplate';
import { effectiveProportionRatios, formatGridLength, proportionLabelOffset, proportionSplitPoints, proportionSplitT } from './proportionScale';

function applyStyle(ctx: CanvasRenderingContext2D, style: DrawStyle) {
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function drawArrowHead(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, lw: number) {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const headLen = Math.max(6, lw * 2.5);
  const wing = (25 * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - headLen * Math.cos(angle - wing), y1 - headLen * Math.sin(angle - wing));
  ctx.lineTo(x1 - headLen * Math.cos(angle + wing), y1 - headLen * Math.sin(angle + wing));
  ctx.closePath();
  ctx.fill();
}

function drawArrowStartTickAndAngle(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lw: number,
  canvasWidth: number
) {
  const g = arrowStartTickGeometry(x0, y0, x1, y1, lw);
  if (!g) return;

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(g.tx, g.ty);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x0, y0, g.arcR, g.arcStart, g.arcStart + g.arcSweep, g.arcSweep < 0);
  ctx.stroke();
  ctx.restore();

  const deg = Math.round((g.acuteRad * 180) / Math.PI);

  const gu = gridUnit(canvasWidth);
  const fs = Math.max(10, gu * 0.32);
  const along = Math.max(g.arcR + fs * 0.85, g.tickLen + fs * 0.75);
  // 法向偏移：含线宽与半字高，下侧（canvas +y 一侧）再加大以免压线
  let sideOff = lw * 3 + fs * 0.35;
  if (g.labelSide > 0) sideOff += fs * 0.45;
  const lx = x0 + Math.cos(g.mainAng) * along - Math.sin(g.mainAng) * g.labelSide * sideOff;
  const ly = y0 + Math.sin(g.mainAng) * along + Math.cos(g.mainAng) * g.labelSide * sideOff;

  let rot = g.mainAng;
  let align: CanvasTextAlign = 'left';
  let pad = 3;
  if (Math.cos(rot) < 0) {
    rot += Math.PI;
    align = 'right';
    pad = -3;
  }

  ctx.font = `${fs}px ui-sans-serif, system-ui, sans-serif`;
  ctx.save();
  ctx.translate(lx, ly);
  ctx.rotate(rot);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${deg}°`, pad, 0);
  ctx.restore();
}

export function renderAnnotation(ctx: CanvasRenderingContext2D, ann: Annotation, canvasWidth: number, selected: boolean) {
  ctx.save();
  applyStyle(ctx, ann.style);
  if (selected) {
    ctx.shadowColor = 'rgba(120, 160, 255, 0.9)';
    ctx.shadowBlur = 6;
  }

  switch (ann.kind) {
    case 'line':
      ctx.beginPath();
      ctx.moveTo(ann.x0, ann.y0);
      ctx.lineTo(ann.x1, ann.y1);
      ctx.stroke();
      break;
    case 'rect':
    case 'square': {
      const x0 = Math.min(ann.x0, ann.x1);
      const y0 = Math.min(ann.y0, ann.y1);
      const w = Math.abs(ann.x1 - ann.x0);
      const h = Math.abs(ann.y1 - ann.y0);
      if (rectAnnotationFilled(ann)) ctx.fillRect(x0, y0, w, h);
      else ctx.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
      break;
    }
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(ann.x0, ann.y0);
      ctx.lineTo(ann.x1, ann.y1);
      ctx.stroke();
      drawArrowStartTickAndAngle(ctx, ann.x0, ann.y0, ann.x1, ann.y1, ann.style.lineWidth, canvasWidth);
      drawArrowHead(ctx, ann.x0, ann.y0, ann.x1, ann.y1, ann.style.lineWidth);
      break;
    }
    case 'polygon':
    case 'polyline': {
      if (ann.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(ann.points[0]!.x, ann.points[0]!.y);
      for (let i = 1; i < ann.points.length; i++) {
        ctx.lineTo(ann.points[i]!.x, ann.points[i]!.y);
      }
      if (ann.kind === 'polygon' && ann.closed) ctx.closePath();
      if (ann.kind === 'polygon' && polygonAnnotationFilled(ann)) ctx.fill();
      else ctx.stroke();
      break;
    }
    case 'equalSpacing': {
      const { lines, circles } = equalSpacingGeometry(
        ann.x0,
        ann.y0,
        ann.x1,
        ann.y1,
        ann.count,
        ann.orientation
      );
      for (const [a, b] of lines) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const c of circles) {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'proportionScale': {
      const gu = gridUnit(canvasWidth);
      const tick = gu * 0.28;
      const fs = Math.max(10, gu * 0.35);
      const ratios = effectiveProportionRatios(ann.count, ann.ratios);
      const splits = proportionSplitT(ratios);
      const sum = ratios.reduce((a, b) => a + b, 0) || 1;
      ctx.beginPath();
      ctx.moveTo(ann.x0, ann.y0);
      ctx.lineTo(ann.x1, ann.y1);
      ctx.stroke();
      const dx = ann.x1 - ann.x0;
      const dy = ann.y1 - ann.y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const points = [0, ...splits, 1];
      const labelOff = Math.max(tick * 2.4, fs * 0.85);
      const lo = proportionLabelOffset(dx, dy, labelOff);
      ctx.font = `${fs}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = lo.align;
      ctx.textBaseline = lo.baseline;
      for (let i = 0; i < points.length; i++) {
        const t = points[i]!;
        const px = ann.x0 + dx * t;
        const py = ann.y0 + dy * t;
        ctx.beginPath();
        ctx.moveTo(px - nx * tick, py - ny * tick);
        ctx.lineTo(px + nx * tick, py + ny * tick);
        ctx.stroke();
        if (i < ratios.length) {
          const t0 = points[i]!;
          const t1 = points[i + 1]!;
          const tMid = (t0 + t1) / 2;
          const mx = ann.x0 + dx * tMid;
          const my = ann.y0 + dy * tMid;
          const segPx = len * (ratios[i]! / sum);
          const label = formatGridLength(segPx, gu);
          ctx.fillText(label, mx + lo.x, my + lo.y);
        }
      }
      break;
    }
    case 'annularSector': {
      const { cx, cy, rInner, rOuter, a0, a1 } = ann;
      if (selected) {
        ctx.beginPath();
        ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, a0, a1);
      ctx.arc(cx, cy, rInner, a1, a0, true);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'crossMark': {
      const h = ann.size / 2;
      ctx.beginPath();
      ctx.moveTo(ann.x - h, ann.y);
      ctx.lineTo(ann.x + h, ann.y);
      ctx.moveTo(ann.x, ann.y - h);
      ctx.lineTo(ann.x, ann.y + h);
      ctx.stroke();
      break;
    }
    case 'centroidMark': {
      const rx = ann.size / 2;
      const ry = ann.size / 2;
      ctx.beginPath();
      ctx.ellipse(ann.x, ann.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      const margin = Math.max(1, ann.style.lineWidth * 0.9);
      const hx = Math.max(2, rx - margin);
      const hy = Math.max(2, ry - margin);
      ctx.beginPath();
      ctx.moveTo(ann.x - hx, ann.y);
      ctx.lineTo(ann.x + hx, ann.y);
      ctx.moveTo(ann.x, ann.y - hy);
      ctx.lineTo(ann.x, ann.y + hy);
      ctx.stroke();
      break;
    }
    case 'circleMark': {
      const r = ann.size / 2;
      ctx.beginPath();
      ctx.arc(ann.x, ann.y, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'centroidCopy': {
      ctx.strokeStyle = ann.color;
      ctx.beginPath();
      ctx.ellipse(ann.x, ann.y, ann.rx, ann.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      const margin = Math.max(1, ann.style.lineWidth * 0.9);
      const hx = Math.max(2, ann.rx - margin);
      const hy = Math.max(2, ann.ry - margin);
      ctx.beginPath();
      ctx.moveTo(ann.x - hx, ann.y);
      ctx.lineTo(ann.x + hx, ann.y);
      ctx.moveTo(ann.x, ann.y - hy);
      ctx.lineTo(ann.x, ann.y + hy);
      ctx.stroke();
      break;
    }
    case 'bboxCopy':
    case 'bodyBBoxCopy': {
      ctx.strokeStyle = ann.color;
      const x0 = Math.min(ann.x0, ann.x1);
      const y0 = Math.min(ann.y0, ann.y1);
      const w = Math.abs(ann.x1 - ann.x0);
      const h = Math.abs(ann.y1 - ann.y0);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
      break;
    }
  }
  ctx.restore();
}

export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  layer: DrawLayer,
  canvasWidth: number,
  selectedIds: Set<string>
) {
  for (const ann of annotations) {
    if (ann.layer !== layer) continue;
    renderAnnotation(ctx, ann, canvasWidth, selectedIds.has(ann.id));
  }
}

function parseFillRgba(css: string): { r: number; g: number; b: number; a: number } {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return { r: 255, g: 107, b: 107, a: 115 };
  const parts = m[1]!.split(',').map((s) => s.trim());
  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  const a = parts[3] !== undefined ? Math.round(Number(parts[3]) * 255) : 115;
  return { r, g, b, a };
}

export function renderStrokeFills(
  ctx: CanvasRenderingContext2D,
  fills: StrokeFillEntry[],
  layer: DrawLayer,
  width: number,
  height: number,
  masks: Map<string, Uint8Array>
) {
  const layerFills = fills.filter((f) => f.layer === layer);
  if (layerFills.length === 0) return;

  const id = ctx.getImageData(0, 0, width, height);
  const d = id.data;

  for (const fill of layerFills) {
    const mask = masks.get(fill.fileKey);
    if (!mask) continue;
    const { r, g, b, a } = parseFillRgba(fill.color);
    for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
      if (!mask[i]) continue;
      d[j] = r;
      d[j + 1] = g;
      d[j + 2] = b;
      d[j + 3] = a;
    }
  }

  ctx.putImageData(id, 0, 0);
}

export function renderPathDraft(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  cursor: { x: number; y: number } | null,
  style: DrawStyle,
  options?: { closePreview?: boolean; fillPreview?: boolean }
) {
  if (points.length === 0) return;
  ctx.save();
  applyStyle(ctx, style);
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i]!.x, points[i]!.y);
  }
  if (cursor) ctx.lineTo(cursor.x, cursor.y);
  if (options?.fillPreview && options.closePreview && points.length >= 3) {
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.stroke();
  }
  if (options?.closePreview && points.length >= 3 && !options.fillPreview) {
    ctx.setLineDash([6, 4]);
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(cursor ? cursor.x : points[points.length - 1]!.x, cursor ? cursor.y : points[points.length - 1]!.y);
    ctx.lineTo(points[0]!.x, points[0]!.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** @deprecated use renderPathDraft */
export function renderPolygonDraft(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  cursor: { x: number; y: number } | null,
  style: DrawStyle
) {
  renderPathDraft(ctx, points, cursor, style, { closePreview: true });
}

export function renderSelectionHandles(ctx: CanvasRenderingContext2D, ann: Annotation, canvasWidth: number) {
  ctx.save();
  ctx.fillStyle = 'rgb(120, 160, 255)';
  const r = 5;
  const dot = (x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (ann.kind) {
    case 'line':
    case 'arrow':
      dot(ann.x0, ann.y0);
      dot(ann.x1, ann.y1);
      break;
    case 'proportionScale':
      dot(ann.x0, ann.y0);
      dot(ann.x1, ann.y1);
      for (const sp of proportionSplitPoints(ann.x0, ann.y0, ann.x1, ann.y1, effectiveProportionRatios(ann.count, ann.ratios))) {
        dot(sp.x, sp.y);
      }
      break;
    case 'rect':
    case 'square':
    case 'bboxCopy':
    case 'bodyBBoxCopy':
      dot(ann.x0, ann.y0);
      dot(ann.x1, ann.y1);
      break;
    case 'equalSpacing':
      dot(ann.x0, ann.y0);
      dot(ann.x1, ann.y1);
      break;
    case 'polygon':
    case 'polyline':
      for (const pt of ann.points) dot(pt.x, pt.y);
      break;
    case 'crossMark':
    case 'centroidMark':
    case 'circleMark':
      dot(ann.x + ann.size / 2, ann.y);
      break;
    case 'annularSector': {
      const hp = annularHandlePoints(ann);
      dot(hp.c.x, hp.c.y);
      dot(hp.is.x, hp.is.y);
      dot(hp.ie.x, hp.ie.y);
      dot(hp.os.x, hp.os.y);
      dot(hp.oe.x, hp.oe.y);
      break;
    }
    case 'centroidCopy':
      dot(ann.x, ann.y);
      break;
  }
  ctx.restore();
}
