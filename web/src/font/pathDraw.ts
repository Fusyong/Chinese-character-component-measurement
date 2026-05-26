import type { BoundingBox, PathCommand } from 'opentype.js';

export function drawCommands(ctx: CanvasRenderingContext2D, commands: PathCommand[]) {
  ctx.beginPath();
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        ctx.moveTo(cmd.x, cmd.y);
        break;
      case 'L':
        ctx.lineTo(cmd.x, cmd.y);
        break;
      case 'C':
        ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        break;
      case 'Q':
        ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        break;
      case 'Z':
        ctx.closePath();
        break;
      default:
        break;
    }
  }
}

export type CanvasLayout = {
  canvasSize: number;
  tx: number;
  ty: number;
  pathWidth: number;
  pathHeight: number;
};

/** 将 opentype 路径平移到画布中央（getPath 坐标与 Canvas 同为 Y 向下，勿再 scale(1,-1)）。 */
export function applyPathTransform(ctx: CanvasRenderingContext2D, layout: CanvasLayout) {
  ctx.translate(layout.tx, layout.ty);
}

/** path 已由 fontSize 缩放到合适大小，此处仅做画布居中。 */
/** 将整字 path 外接框居中到 canvasSize×canvasSize（各笔画共用此变换）。 */
export function layoutForPath(pathBbox: BoundingBox, canvasSize: number): CanvasLayout {
  const pathW = pathBbox.x2 - pathBbox.x1;
  const pathH = pathBbox.y2 - pathBbox.y1;
  const tx = (canvasSize - pathW) / 2 - pathBbox.x1;
  const ty = (canvasSize - pathH) / 2 - pathBbox.y1;

  return { canvasSize, tx, ty, pathWidth: pathW, pathHeight: pathH };
}
