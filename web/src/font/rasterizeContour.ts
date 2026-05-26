import type { PathCommand } from 'opentype.js';
import { applyPathTransform, drawCommands, layoutForPath, type CanvasLayout } from './pathDraw';

export function rasterizeCommands(
  commands: PathCommand[],
  layout: CanvasLayout,
  canvasSize = layout.canvasSize
): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = canvasSize;
  cv.height = canvasSize;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');

  ctx.clearRect(0, 0, canvasSize, canvasSize);
  ctx.save();
  applyPathTransform(ctx, layout);
  drawCommands(ctx, commands);
  ctx.fillStyle = '#000';
  ctx.fill('evenodd');
  ctx.restore();

  return cv;
}

export function canvasToBlob(cv: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    cv.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob 失败'));
    }, 'image/png');
  });
}

export async function commandsToFile(
  commands: PathCommand[],
  layout: CanvasLayout,
  fileName: string
): Promise<{ canvas: HTMLCanvasElement; blob: Blob; file: File }> {
  const canvas = rasterizeCommands(commands, layout);
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], fileName, { type: 'image/png', lastModified: Date.now() });
  return { canvas, blob, file };
}

export { layoutForPath };
