export type BinarizeMode = 'alpha' | 'lumaThreshold';

export type MergedMask = {
  width: number;
  height: number;
  mask: Uint8Array; // 0/1
  binarizeMode: BinarizeMode;
};

function luma(r: number, g: number, b: number) {
  // Rec. 709
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

export async function buildMergedMaskFromFiles(
  files: File[],
  opts: { threshold: number; invert: boolean }
): Promise<MergedMask> {
  if (files.length === 0) {
    return { width: 0, height: 0, mask: new Uint8Array(), binarizeMode: 'alpha' };
  }

  const bitmaps = await Promise.all(files.map(fileToImageBitmap));
  const width = bitmaps[0].width;
  const height = bitmaps[0].height;
  for (const bmp of bitmaps) ensureSameSize(width, height, bmp.width, bmp.height);

  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D not available');

  const merged = new Uint8Array(width * height);

  // Decide whether alpha is meaningful: if we ever see a pixel with 0<alpha<255 or alpha==0, we treat alpha as mask.
  let sawAlphaTransparent = false;
  let sawAlphaPartial = false;

  // First pass (cheap sampling) to choose binarization mode.
  for (const bmp of bitmaps) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, width, height);
    const d = id.data;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 50));
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

  const binarizeMode: BinarizeMode = sawAlphaTransparent || sawAlphaPartial ? 'alpha' : 'lumaThreshold';

  // Merge masks by OR.
  for (const bmp of bitmaps) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, width, height);
    const d = id.data;

    if (binarizeMode === 'alpha') {
      for (let p = 0, j = 0; p < merged.length; p++, j += 4) {
        const a = d[j + 3];
        if (a > 0) merged[p] = 1;
      }
    } else {
      const thr = opts.threshold;
      const inv = opts.invert;
      for (let p = 0, j = 0; p < merged.length; p++, j += 4) {
        const lum = luma(d[j], d[j + 1], d[j + 2]);
        const fg = lum >= thr ? 1 : 0;
        merged[p] = merged[p] | (inv ? (fg ^ 1) : fg);
      }
    }
  }

  // Clean up bitmaps.
  for (const bmp of bitmaps) bmp.close();

  return { width, height, mask: merged, binarizeMode };
}

