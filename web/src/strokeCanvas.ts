/** PNG 与字体笔画共用的固定方形画布（像素）。 */
export const WORKSPACE_CANVAS_SIZE = 800;

/** PNG 笔画来源的字号（pt），与拆字导出一致。 */
export const STROKE_FONT_SIZE = 700;

// TODO: 暂未找到正确对齐逻辑，使用临时偏移
/** PNG 相对画布原点的平移（与 800×800 拆字图对齐）。 */
export const PNG_OFFSET_X = 45;
export const PNG_OFFSET_Y = 35;

export function getWorkspaceCanvasSize(): number {
  return WORKSPACE_CANVAS_SIZE;
}

function canvasToPngFile(cv: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    cv.toBlob((blob) => {
      if (!blob) {
        reject(new Error('canvas.toBlob 失败'));
        return;
      }
      resolve(new File([blob], name, { type: 'image/png', lastModified: Date.now() }));
    }, 'image/png');
  });
}

/** 在 800×800 画布上将 PNG 内容平移后写回（导入时应用）。 */
export async function applyPngContentOffset(file: File): Promise<File> {
  await assertPngCanvasSize(file);
  const bmp = await createImageBitmap(file);
  const n = WORKSPACE_CANVAS_SIZE;
  const cv = document.createElement('canvas');
  cv.width = n;
  cv.height = n;
  const ctx = cv.getContext('2d');
  if (!ctx) {
    bmp.close();
    throw new Error('Canvas 2D not available');
  }
  ctx.clearRect(0, 0, n, n);
  ctx.drawImage(bmp, PNG_OFFSET_X, PNG_OFFSET_Y);
  bmp.close();
  return canvasToPngFile(cv, file.name);
}

/** 校验 PNG 为固定画布尺寸。 */
export async function assertPngCanvasSize(file: File): Promise<void> {
  const bmp = await createImageBitmap(file);
  const w = bmp.width;
  const h = bmp.height;
  bmp.close();
  const n = WORKSPACE_CANVAS_SIZE;
  if (w !== n || h !== n) {
    throw new Error(`PNG 须为 ${n}×${n}，当前为 ${w}×${h}：${file.name}`);
  }
}
