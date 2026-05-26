export type BinarizeMode = 'alpha' | 'lumaThreshold';

export type MergedMask = {
  width: number;
  height: number;
  mask: Uint8Array; // 0/1
  binarizeMode: BinarizeMode;
};

export type PerFileMask = {
  fileKey: string;
  mask: MergedMask;
};

export function fileKey(f: File): string {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function fileToImageBitmap(file: File): Promise<ImageBitmap> {
  const blob = file.slice(0, file.size, file.type || 'image/png');
  return await createImageBitmap(blob);
}

function ensureSameSize(width: number, height: number, w: number, h: number) {
  if (width !== w || height !== h) {
    throw new Error(`图片尺寸不一致：期望 ${width}×${height}，但遇到 ${w}×${h}`);
  }
}

function detectBinarizeMode(bitmaps: ImageBitmap[], ctx: CanvasRenderingContext2D, width: number, height: number): BinarizeMode {
  let sawAlphaTransparent = false;
  let sawAlphaPartial = false;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 50));
  for (const bmp of bitmaps) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, width, height);
    const d = id.data;
    for (let y = 0; y < height; y += step) {
      const row = y * width * 4;
      for (let x = 0; x < width; x += step) {
        const i = row + x * 4;
        const a = d[i + 3];
        if (a === 0) sawAlphaTransparent = true;
        else if (a < 255) sawAlphaPartial = true;
        if (sawAlphaTransparent || sawAlphaPartial) break;
      }
      if (sawAlphaTransparent || sawAlphaPartial) break;
    }
    if (sawAlphaTransparent || sawAlphaPartial) break;
  }
  return sawAlphaTransparent || sawAlphaPartial ? 'alpha' : 'lumaThreshold';
}

function maskFromImageData(d: Uint8ClampedArray, width: number, height: number, binarizeMode: BinarizeMode, opts: { threshold: number; invert: boolean }): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (binarizeMode === 'alpha') {
    for (let p = 0, j = 0; p < mask.length; p++, j += 4) {
      if (d[j + 3] > 0) mask[p] = 1;
    }
  } else {
    const thr = opts.threshold;
    const inv = opts.invert;
    for (let p = 0, j = 0; p < mask.length; p++, j += 4) {
      const lum = luma(d[j], d[j + 1], d[j + 2]);
      const fg = lum >= thr ? 1 : 0;
      mask[p] = inv ? (fg ^ 1) : fg;
    }
  }
  return mask;
}

export async function buildMaskFromBitmap(
  bmp: ImageBitmap,
  binarizeMode: BinarizeMode,
  opts: { threshold: number; invert: boolean }
): Promise<MergedMask> {
  const width = bmp.width;
  const height = bmp.height;
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D not available');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0);
  const id = ctx.getImageData(0, 0, width, height);
  const mask = maskFromImageData(id.data, width, height, binarizeMode, opts);
  return { width, height, mask, binarizeMode };
}

export async function buildPerFileMasks(files: File[], opts: { threshold: number; invert: boolean }): Promise<PerFileMask[]> {
  if (files.length === 0) return [];
  const bitmaps = await Promise.all(files.map(fileToImageBitmap));
  const width = bitmaps[0].width;
  const height = bitmaps[0].height;
  for (const bmp of bitmaps) ensureSameSize(width, height, bmp.width, bmp.height);

  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D not available');

  const binarizeMode = detectBinarizeMode(bitmaps, ctx, width, height);
  const results: PerFileMask[] = [];

  for (let i = 0; i < files.length; i++) {
    const bmp = bitmaps[i]!;
    const mask = await buildMaskFromBitmap(bmp, binarizeMode, opts);
    results.push({ fileKey: fileKey(files[i]!), mask });
    bmp.close();
  }

  return results;
}

export async function buildMergedMaskFromFiles(
  files: File[],
  opts: { threshold: number; invert: boolean }
): Promise<MergedMask> {
  if (files.length === 0) {
    return { width: 0, height: 0, mask: new Uint8Array(), binarizeMode: 'alpha' };
  }

  const perFile = await buildPerFileMasks(files, opts);
  const { width, height, binarizeMode } = perFile[0]!.mask;
  const merged = new Uint8Array(width * height);
  for (const pf of perFile) {
    for (let i = 0; i < merged.length; i++) merged[i] = merged[i] | pf.mask.mask[i]!;
  }
  return { width, height, mask: merged, binarizeMode };
}
