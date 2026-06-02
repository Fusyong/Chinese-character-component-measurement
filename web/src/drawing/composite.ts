export type LayerCanvases = {
  drawBottom: HTMLCanvasElement;
  drawMiddle: HTMLCanvasElement;
  measure: HTMLCanvasElement;
  glyph: HTMLCanvasElement;
  measureOver: HTMLCanvasElement;
  drawTop: HTMLCanvasElement;
};

export async function compositeExportBlob(layers: LayerCanvases): Promise<Blob> {
  const W = layers.glyph.width;
  const H = layers.glyph.height;
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const ctx = off.getContext('2d');
  if (!ctx) return new Blob();

  const order = [
    layers.drawBottom,
    layers.drawMiddle,
    layers.measure,
    layers.glyph,
    layers.measureOver,
    layers.drawTop,
  ];
  for (const cv of order) {
    if (cv.width === W && cv.height === H) ctx.drawImage(cv, 0, 0);
  }

  return new Promise<Blob>((resolve) => off.toBlob((b) => resolve(b ?? new Blob()), 'image/png'));
}
