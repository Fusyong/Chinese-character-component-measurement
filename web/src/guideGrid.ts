import type { OverlayStyle } from './render';

export type GuideGridKind = 'tian' | 'mi' | 'jiugong' | 'huigong' | 'huimi';

export const GUIDE_GRID_OPTIONS: { v: GuideGridKind; t: string }[] = [
  { v: 'tian', t: '田字格' },
  { v: 'mi', t: '米字格' },
  { v: 'jiugong', t: '九宫格' },
  { v: 'huigong', t: '回宫格' },
  { v: 'huimi', t: '回米格' },
];

function applyStroke(ctx: CanvasRenderingContext2D, style: OverlayStyle) {
  ctx.globalAlpha = style.alpha;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  if (style.dash) ctx.setLineDash(style.dash);
  else ctx.setLineDash([]);
}

function strokeOuterBorder(ctx: CanvasRenderingContext2D, width: number, height: number, style: OverlayStyle) {
  applyStroke(ctx, { ...style, dash: undefined });
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}

function strokeInnerRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  style: OverlayStyle
) {
  applyStroke(ctx, style);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function hLine(ctx: CanvasRenderingContext2D, width: number, y: number, style: OverlayStyle) {
  applyStroke(ctx, style);
  ctx.beginPath();
  ctx.moveTo(0, y + 0.5);
  ctx.lineTo(width, y + 0.5);
  ctx.stroke();
}

function vLine(ctx: CanvasRenderingContext2D, x: number, height: number, style: OverlayStyle) {
  applyStroke(ctx, style);
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, height);
  ctx.stroke();
}

function diagonal(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  style: OverlayStyle
) {
  applyStroke(ctx, style);
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, y0 + 0.5);
  ctx.lineTo(x1 + 0.5, y1 + 0.5);
  ctx.stroke();
}

function drawTianLines(ctx: CanvasRenderingContext2D, width: number, height: number, style: OverlayStyle) {
  hLine(ctx, width, height / 2, style);
  vLine(ctx, width / 2, height, style);
}

function drawMiLines(ctx: CanvasRenderingContext2D, width: number, height: number, style: OverlayStyle) {
  drawTianLines(ctx, width, height, style);
  diagonal(ctx, 0, 0, width, height, style);
  diagonal(ctx, width, 0, 0, height, style);
}

function drawJiugongLines(ctx: CanvasRenderingContext2D, width: number, height: number, style: OverlayStyle) {
  hLine(ctx, width, height / 3, style);
  hLine(ctx, width, (height * 2) / 3, style);
  vLine(ctx, width / 3, height, style);
  vLine(ctx, (width * 2) / 3, height, style);
}

/** 内框为外框边长一半、居中（四边各留 25%） */
function innerPalaceRect(width: number, height: number) {
  const w = width / 2;
  const h = height / 2;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

export function renderGuideGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  kind: GuideGridKind,
  style: OverlayStyle
) {
  if (width <= 0 || height <= 0) return;
  ctx.save();
  strokeOuterBorder(ctx, width, height, style);

  switch (kind) {
    case 'tian':
      drawTianLines(ctx, width, height, style);
      break;
    case 'mi':
      drawMiLines(ctx, width, height, style);
      break;
    case 'jiugong':
      drawJiugongLines(ctx, width, height, style);
      break;
    case 'huigong': {
      const inner = innerPalaceRect(width, height);
      strokeInnerRect(ctx, inner.x, inner.y, inner.w, inner.h, style);
      drawTianLines(ctx, width, height, style);
      break;
    }
    case 'huimi': {
      const inner = innerPalaceRect(width, height);
      strokeInnerRect(ctx, inner.x, inner.y, inner.w, inner.h, style);
      drawMiLines(ctx, width, height, style);
      break;
    }
  }
  ctx.restore();
}
