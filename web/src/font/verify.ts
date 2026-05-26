import { buildMaskFromBitmap } from '../mask';

export type StrokeCanvasLike = { canvas: HTMLCanvasElement };

export type VerifyResult = {
  wholeArea: number;
  mergedStrokesArea: number;
  areaRatio: number;
  diffPixels: number;
  diffRatio: number;
};

/** 比较整字 mask 与笔画 OR 合并 mask（开发期校验）。 */
export async function verifyStrokeMerge(
  wholeCanvas: HTMLCanvasElement,
  strokes: StrokeCanvasLike[],
  opts: { threshold: number; invert: boolean }
): Promise<VerifyResult> {
  const W = wholeCanvas.width;
  const H = wholeCanvas.height;

  const wholeBmp = await createImageBitmap(wholeCanvas);
  const wholeMask = await buildMaskFromBitmap(wholeBmp, 'alpha', opts);
  wholeBmp.close();

  const merged = new Uint8Array(W * H);
  for (const s of strokes) {
    const bmp = await createImageBitmap(s.canvas);
    const m = await buildMaskFromBitmap(bmp, 'alpha', opts);
    bmp.close();
    for (let i = 0; i < merged.length; i++) merged[i] = merged[i]! | m.mask[i]!;
  }

  let wholeArea = 0;
  let mergedArea = 0;
  let diffPixels = 0;
  for (let i = 0; i < merged.length; i++) {
    if (wholeMask.mask[i]) wholeArea++;
    if (merged[i]) mergedArea++;
    if (wholeMask.mask[i] !== merged[i]) diffPixels++;
  }

  const total = W * H;
  return {
    wholeArea,
    mergedStrokesArea: mergedArea,
    areaRatio: wholeArea > 0 ? mergedArea / wholeArea : 0,
    diffPixels,
    diffRatio: total > 0 ? diffPixels / total : 0,
  };
}
