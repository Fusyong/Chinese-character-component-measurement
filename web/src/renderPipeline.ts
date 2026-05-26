import type { GroupResult, Metrics } from './types';
import type { MergedMask } from './mask';
import type { OverlayOpts, OverlayStyle } from './render';
import {
  clearCanvas,
  renderBoxUnderlays,
  renderCentroidOverlay,
  renderContourOverlay,
  renderGuidesUnderlay,
  renderMask,
} from './render';

export type MeasureRenderInput = {
  width: number;
  height: number;
  overallMerged: MergedMask;
  overallMetrics: Metrics;
  groupResults: GroupResult[];
  overlayOpts: OverlayOpts;
  showOverallOverlays: boolean;
  showGroupOverlays: boolean;
  overallStyle: OverlayStyle;
  groupStyle: (color: string) => OverlayStyle;
  centroidRadii: (m: Metrics) => { rx: number; ry: number };
};

export type LayerContexts = {
  guide: CanvasRenderingContext2D | null;
  measure: CanvasRenderingContext2D | null;
  glyph: CanvasRenderingContext2D | null;
  measureOver: CanvasRenderingContext2D | null;
};

export function renderMeasureLayers(ctxs: LayerContexts, input: MeasureRenderInput) {
  const { width: W, height: H } = input;
  const mctx = ctxs.measure;
  const gctx = ctxs.glyph;
  const octx = ctxs.measureOver;

  if (mctx) {
    clearCanvas(mctx, W, H);
    if (input.showOverallOverlays) {
      renderBoxUnderlays(mctx, input.overallMetrics, input.overlayOpts, input.overallStyle);
    }
    if (input.showGroupOverlays) {
      for (const gr of input.groupResults) {
        if (!gr.group.enabled) continue;
        renderBoxUnderlays(mctx, gr.metrics, input.overlayOpts, input.groupStyle(gr.group.color));
      }
    }
  }

  if (gctx) {
    clearCanvas(gctx, W, H);
    renderMask(gctx, input.overallMerged);
  }

  if (octx) {
    clearCanvas(octx, W, H);
    if (input.showOverallOverlays) {
      renderContourOverlay(octx, input.overallMetrics, input.overlayOpts, input.overallStyle);
      renderCentroidOverlay(
        octx,
        input.overallMetrics,
        input.overlayOpts,
        input.overallStyle,
        input.centroidRadii(input.overallMetrics)
      );
    }
    if (input.showGroupOverlays) {
      for (const gr of input.groupResults) {
        const st = input.groupStyle(gr.group.color);
        renderContourOverlay(octx, gr.metrics, input.overlayOpts, st);
        if (gr.group.enabled) {
          renderCentroidOverlay(octx, gr.metrics, input.overlayOpts, st, input.centroidRadii(gr.metrics));
        }
      }
    }
  }
}

export function renderGuideLayer(
  gctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: OverlayStyle
) {
  clearCanvas(gctx, width, height);
  renderGuidesUnderlay(gctx, width, height, style);
}
