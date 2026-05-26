import type { PathCommand } from 'opentype.js';
import { loadKaiTiFont } from './loadFont';
import { splitContours } from './splitContours';
import { commandsToFile, rasterizeCommands } from './rasterizeContour';
import { layoutForPath, type CanvasLayout } from './pathDraw';
import { STROKE_FONT_SIZE, WORKSPACE_CANVAS_SIZE } from '../strokeCanvas';
import { verifyStrokeMerge, type VerifyResult } from './verify';

export type StrokeRaster = {
  index: number;
  commands: PathCommand[];
  canvas: HTMLCanvasElement;
  blob: Blob;
  file: File;
};

export type ExtractStrokesResult = {
  char: string;
  codePoint: number;
  glyphIndex: number;
  fontContourCount: number | undefined;
  strokes: StrokeRaster[];
  wholeGlyphCanvas: HTMLCanvasElement;
  mergedPreviewCanvas: HTMLCanvasElement;
  layout: CanvasLayout;
  verify: VerifyResult;
};

export type ExtractStrokesOptions = {
  canvasSize?: number;
  /** opentype getPath 字号，默认与 PNG 拆字一致（700pt） */
  fontSize?: number;
  maskOpts?: { threshold: number; invert: boolean };
};

const DEFAULT_MASK_OPTS = { threshold: 200, invert: false };

export async function extractStrokes(
  char: string,
  opts: ExtractStrokesOptions = {}
): Promise<ExtractStrokesResult> {
  const trimmed = [...char.trim()];
  if (trimmed.length !== 1) throw new Error('请只输入一个汉字');
  const ch = trimmed[0]!;

  const canvasSize = opts.canvasSize ?? WORKSPACE_CANVAS_SIZE;
  const fontSize = opts.fontSize ?? STROKE_FONT_SIZE;
  const maskOpts = opts.maskOpts ?? DEFAULT_MASK_OPTS;

  const font = await loadKaiTiFont();
  if (!font.hasChar(ch)) throw new Error(`字体中无字符：${ch}`);

  const glyph = font.charToGlyph(ch);
  const fullPath = glyph.getPath(0, 0, fontSize);
  // 整字共用同一 layout，各笔画在 800×800 上保持拆字时的相对位置（与 PNG 一致）
  const layout = layoutForPath(fullPath.getBoundingBox(), canvasSize);

  const contourCmds = splitContours(fullPath.commands);
  if (contourCmds.length === 0) throw new Error(`未解析到闭合轮廓：${ch}`);

  const strokes: StrokeRaster[] = [];
  for (let i = 0; i < contourCmds.length; i++) {
    const { canvas, blob, file } = await commandsToFile(
      contourCmds[i]!,
      layout,
      `${ch}-stroke-${i}.png`
    );
    strokes.push({ index: i, commands: contourCmds[i]!, canvas, blob, file });
  }

  const wholeGlyphCanvas = rasterizeCommands(fullPath.commands, layout, canvasSize);

  const mergedPreviewCanvas = document.createElement('canvas');
  mergedPreviewCanvas.width = canvasSize;
  mergedPreviewCanvas.height = canvasSize;
  const mctx = mergedPreviewCanvas.getContext('2d');
  if (!mctx) throw new Error('Canvas 2D not available');
  for (const s of strokes) {
    mctx.drawImage(s.canvas, 0, 0);
  }

  const verify = await verifyStrokeMerge(wholeGlyphCanvas, strokes, maskOpts);

  const codePoint = ch.codePointAt(0)!;
  console.info(
    `[font] ${ch} (U+${codePoint.toString(16).toUpperCase()}) ${fontSize}pt @ ${canvasSize}px` +
      ` contours=${contourCmds.length} font.numberOfContours=${glyph.numberOfContours ?? '—'} verify:`,
    verify
  );

  return {
    char: ch,
    codePoint,
    glyphIndex: glyph.index,
    fontContourCount: glyph.numberOfContours,
    strokes,
    wholeGlyphCanvas,
    mergedPreviewCanvas,
    layout,
    verify,
  };
}
