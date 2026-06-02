import opentype from 'opentype.js';

export const KAITI_FONT_URL = `${import.meta.env.BASE_URL}fonts/k.ttf`;

let fontPromise: Promise<opentype.Font> | null = null;

export function loadKaiTiFont(): Promise<opentype.Font> {
  if (!fontPromise) {
    fontPromise = fetch(KAITI_FONT_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`字体加载失败 (${res.status}): ${KAITI_FONT_URL}`);
        return res.arrayBuffer();
      })
      .then((buf) => opentype.parse(buf));
  }
  return fontPromise;
}
