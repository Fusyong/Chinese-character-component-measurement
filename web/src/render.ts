import type { Metrics } from './types';
import type { MergedMask } from './mask';

export function renderMask(ctx: CanvasRenderingContext2D, merged: MergedMask) {
  const { width, height, mask } = merged;
  // Important: only paint foreground pixels, so underlays stay visible.
  const id = ctx.getImageData(0, 0, width, height);
  const d = id.data;
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
    if (!mask[i]) continue;
    d[j] = 255;
    d[j + 1] = 255;
    d[j + 2] = 255;
    d[j + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
}

export type OverlayStyle = {
  color: string; // rgb(...) preferred
  alpha: number;
  lineWidth: number;
  dash?: number[];
};

export type OverlayOpts = { showBBox: boolean; showBodyBBox: boolean; showCentroid: boolean; showContours: boolean };

function strokeRect(ctx: CanvasRenderingContext2D, r: { x0: number; y0: number; x1: number; y1: number }, style: OverlayStyle) {
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  if (style.dash) ctx.setLineDash(style.dash);
  ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0, r.y1 - r.y0);
  ctx.restore();
}

function drawCentroidEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, style: OverlayStyle, rx: number, ry: number) {
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  if (style.dash) ctx.setLineDash(style.dash);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Keep crosshair inside ellipse: horizontal half-length <= rx, vertical <= ry.
  const margin = Math.max(1, style.lineWidth * 0.9);
  const hx = Math.max(2, rx - margin);
  const hy = Math.max(2, ry - margin);
  ctx.beginPath();
  ctx.moveTo(x - hx, y);
  ctx.lineTo(x + hx, y);
  ctx.moveTo(x, y - hy);
  ctx.lineTo(x, y + hy);
  ctx.stroke();
  ctx.restore();
}

function drawGuideCrosshair(ctx: CanvasRenderingContext2D, width: number, height: number, x: number, y: number, style: OverlayStyle) {
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(style.dash ?? [8, 6]);

  // Vertical line at x
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, height);
  ctx.stroke();

  // Horizontal line at y
  ctx.beginPath();
  ctx.moveTo(0, y + 0.5);
  ctx.lineTo(width, y + 0.5);
  ctx.stroke();

  ctx.restore();
}

export function renderBoxUnderlays(
  ctx: CanvasRenderingContext2D,
  metrics: Metrics,
  opts: OverlayOpts,
  style: OverlayStyle
) {
  if (opts.showBBox && metrics.bbox) strokeRect(ctx, metrics.bbox, style);
  if (opts.showBodyBBox && metrics.bodyBBox?.rect) strokeRect(ctx, metrics.bodyBBox.rect, style);
}

export function renderCentroidOverlay(
  ctx: CanvasRenderingContext2D,
  metrics: Metrics,
  opts: OverlayOpts,
  style: OverlayStyle,
  radii: { rx: number; ry: number }
) {
  if (!opts.showCentroid || !metrics.centroid) return;
  drawCentroidEllipse(ctx, metrics.centroid.x, metrics.centroid.y, style, radii.rx, radii.ry);
}

export function renderContourOverlay(ctx: CanvasRenderingContext2D, metrics: Metrics, opts: OverlayOpts, style: OverlayStyle) {
  if (!opts.showContours || !metrics.contours?.polylines) return;
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  if (style.dash) ctx.setLineDash(style.dash);
  for (const pl of metrics.contours.polylines) {
    const pts = pl.points;
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderGuidesUnderlay(ctx: CanvasRenderingContext2D, width: number, height: number, style: OverlayStyle) {
  drawGuideCrosshair(ctx, width, height, 400, 400, style);
}

export function clearCanvas(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
}

export function renderAllLegacy(
  ctx: CanvasRenderingContext2D,
  merged: MergedMask,
  metrics: Metrics,
  opts: OverlayOpts,
  style: OverlayStyle
) {
  // Deprecated: kept for any external callers. Prefer: guides+underlays -> mask -> centroid.
  clearCanvas(ctx, merged.width, merged.height);
  renderGuidesUnderlay(ctx, merged.width, merged.height, style);
  renderBoxUnderlays(ctx, metrics, opts, style);
  renderMask(ctx, merged);
  renderContourOverlay(ctx, metrics, opts, style);
  renderCentroidOverlay(ctx, metrics, opts, style, { rx: 5, ry: 5 });
}

