import type { Metrics } from '../types';
import { duplicateAnnotationsForDrag } from './duplicate';
import { copyFrameAnnotations } from './copyFrames';
import { angleOnCircle, ANNULAR_DEFAULT_A0, ANNULAR_DEFAULT_A1, angleSnappedPoint, constrainAxis, dist, moveAnnotation, pathVertexAnchor, rectFromDrag, squareCornerFromAnchor } from './geom';
import { equalSpacingOrientationFromDrag } from './equalSpacingTemplate';
import { markIconPreset, getToolPreset, rememberToolPresetFromAnnotation, rememberToolPresetFromStrokeFill } from './toolPresets';
import {
  clampSplitT,
  effectiveProportionRatios,
  equalProportionRatios,
  paramOnProportionLine,
  proportionSplitT,
  ratiosFromSplitT,
} from './proportionScale';
import { hitTestAnnotations, hitTestStrokeMask } from './hitTest';
import { renderAnnotation, renderAnnotations, renderPathDraft, renderSelectionHandles, renderStrokeFills } from './render';
import {
  addAnnotation,
  beginEdit,
  currentDrawStyle,
  drawingState,
  newAnnId,
  redo,
  removeSelected,
  removeStrokeFill,
  setStrokeFill,
  undo,
  updateAnnotation,
  pushUndo,
} from './store';
import type { Annotation, DrawLayer, DrawStyle, DrawTool, Point } from './types';

export type InteractionContext = {
  width: number;
  height: number;
  canvases: {
    drawBottom: HTMLCanvasElement;
    drawMiddle: HTMLCanvasElement;
    drawTop: HTMLCanvasElement;
    hit: HTMLCanvasElement;
  };
  getPerFileMasks: () => { fileKey: string; groupId: string; mask: Uint8Array; enabled: boolean }[];
  getMetricsForCopy: () => {
    overall?: { metrics: Metrics; color: string; show: boolean };
    groups: { id: string; metrics: Metrics; color: string; enabled: boolean }[];
  };
  centroidRadii: (m: Metrics) => { rx: number; ry: number };
  onExportRefresh: () => void;
  onSelectionChange?: () => void;
  onEnterEdit?: () => void;
};

type DragState =
  | { kind: 'none' }
  | { kind: 'create'; tool: DrawTool; x0: number; y0: number; preview: Partial<Annotation> | null }
  | { kind: 'move'; annId: string; ox: number; oy: number; bases: Map<string, Annotation> }
  | { kind: 'handle'; annId: string; handle: string; startAnn: Annotation };

let drag: DragState = { kind: 'none' };
let previewAnn: Annotation | null = null;

type PathDraftMode = 'polygon' | 'polyline';
type PathDraft = { mode: PathDraftMode; points: Point[]; layer: DrawLayer; style: DrawStyle; filled?: boolean };
let pathDraft: PathDraft | null = null;
let pathCursor: Point | null = null;

const POLYGON_CLOSE_R = 12;
const POLYGON_MIN_VERTEX_DIST = 4;

export function cancelPolygonDraft() {
  pathDraft = null;
  pathCursor = null;
}

export function hasPolygonDraft() {
  return pathDraft !== null;
}

export function cancelPathDraftUnlessTool(tool: DrawTool) {
  if (!pathDraft) return;
  if (tool !== 'polygon' && tool !== 'polyline') {
    cancelPolygonDraft();
    return;
  }
  if (pathDraft.mode !== tool) cancelPolygonDraft();
}

function canvasPoint(cv: HTMLCanvasElement, ev: PointerEvent) {
  const rect = cv.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const sx = cv.width > 0 ? cv.width / rect.width : 1;
  const sy = cv.height > 0 ? cv.height / rect.height : 1;
  return { x: (ev.clientX - rect.left) * sx, y: (ev.clientY - rect.top) * sy };
}

function maskMap(ctx: InteractionContext): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  for (const item of ctx.getPerFileMasks()) {
    if (item.enabled) m.set(item.fileKey, item.mask);
  }
  return m;
}

function ctxForLayer(
  layer: DrawLayer,
  ctxs: { bottom: CanvasRenderingContext2D; middle: CanvasRenderingContext2D; top: CanvasRenderingContext2D }
) {
  if (layer === 'bottom') return ctxs.bottom;
  if (layer === 'top') return ctxs.top;
  return ctxs.middle;
}

export function redrawDrawingLayers(ctx: InteractionContext) {
  const W = ctx.width;
  const H = ctx.height;
  const bctx = ctx.canvases.drawBottom.getContext('2d', { willReadFrequently: true });
  const mctx = ctx.canvases.drawMiddle.getContext('2d', { willReadFrequently: true });
  const tctx = ctx.canvases.drawTop.getContext('2d', { willReadFrequently: true });
  if (!bctx || !mctx || !tctx) return;

  bctx.clearRect(0, 0, W, H);
  mctx.clearRect(0, 0, W, H);
  tctx.clearRect(0, 0, W, H);

  const layerCtxs = { bottom: bctx, middle: mctx, top: tctx };
  const masks = maskMap(ctx);
  renderStrokeFills(bctx, drawingState.strokeFills, 'bottom', W, H, masks);
  renderStrokeFills(mctx, drawingState.strokeFills, 'middle', W, H, masks);
  renderStrokeFills(tctx, drawingState.strokeFills, 'top', W, H, masks);

  renderAnnotations(bctx, drawingState.annotations, 'bottom', W, drawingState.selectedIds);
  renderAnnotations(mctx, drawingState.annotations, 'middle', W, drawingState.selectedIds);
  renderAnnotations(tctx, drawingState.annotations, 'top', W, drawingState.selectedIds);

  if (previewAnn) {
    const pctx = ctxForLayer(previewAnn.layer, layerCtxs);
    renderAnnotation(pctx, previewAnn, W, false);
  }

  if (pathDraft) {
    const pctx = ctxForLayer(pathDraft.layer, layerCtxs);
    renderPathDraft(pctx, pathDraft.points, pathCursor, pathDraft.style, {
      closePreview: pathDraft.mode === 'polygon',
      fillPreview: pathDraft.mode === 'polygon' && (pathDraft.filled ?? true),
    });
  }

  for (const id of drawingState.selectedIds) {
    const ann = drawingState.annotations.find((a) => a.id === id);
    if (!ann) continue;
    renderSelectionHandles(ctxForLayer(ann.layer, layerCtxs), ann, W);
  }

  ctx.onExportRefresh();
}

function defaultLayer() {
  return drawingState.defaultLayer;
}

function notifySelection(ctx: InteractionContext) {
  ctx.onSelectionChange?.();
}

function enterEditAfterCreate(ctx: InteractionContext) {
  ctx.onEnterEdit?.();
  notifySelection(ctx);
}

function finishCreate(ctx: InteractionContext) {
  drag = { kind: 'none' };
  previewAnn = null;
  redrawDrawingLayers(ctx);
  enterEditAfterCreate(ctx);
}

function finishPathDraft(ctx: InteractionContext) {
  if (!pathDraft) {
    cancelPolygonDraft();
    redrawDrawingLayers(ctx);
    return;
  }
  const minPts = pathDraft.mode === 'polygon' ? 3 : 2;
  if (pathDraft.points.length < minPts) {
    cancelPolygonDraft();
    redrawDrawingLayers(ctx);
    return;
  }
  if (pathDraft.mode === 'polygon') {
    addAnnotation({
      kind: 'polygon',
      id: newAnnId(),
      points: pathDraft.points.map((p) => ({ ...p })),
      closed: true,
      filled: pathDraft.filled ?? true,
      layer: pathDraft.layer,
      style: { ...pathDraft.style },
    });
  } else {
    addAnnotation({
      kind: 'polyline',
      id: newAnnId(),
      points: pathDraft.points.map((p) => ({ ...p })),
      layer: pathDraft.layer,
      style: { ...pathDraft.style },
    });
  }
  cancelPolygonDraft();
  finishCreate(ctx);
}

function pathDraftActiveForTool(tool: DrawTool) {
  return pathDraft !== null && pathDraft.mode === tool;
}

function addPathVertex(x: number, y: number, shift: boolean) {
  if (!pathDraft) return;
  const last = pathDraft.points[pathDraft.points.length - 1]!;
  let px = x;
  let py = y;
  if (shift) ({ x: px, y: py } = angleSnappedPoint(last.x, last.y, x, y, 'snap16', { shift: true }));
  if (dist(px, py, last.x, last.y) >= POLYGON_MIN_VERTEX_DIST) {
    pathDraft.points.push({ x: px, y: py });
  }
  pathCursor = { x: px, y: py };
}

type ShiftConstraint = 'axis' | 'snap8' | 'snap16';

function endPoint(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  shift: boolean,
  shiftConstraint: ShiftConstraint = 'axis'
) {
  if (shift && shiftConstraint === 'snap8') return angleSnappedPoint(x0, y0, x1, y1, 'snap8', { shift: true });
  if (shift && shiftConstraint === 'snap16') return angleSnappedPoint(x0, y0, x1, y1, 'snap16', { shift: true });
  if (shift && shiftConstraint === 'axis') return constrainAxis(x0, y0, x1, y1, true);
  return { x: x1, y: y1 };
}

function handlePathToolDown(
  ctx: InteractionContext,
  tool: 'polygon' | 'polyline',
  x: number,
  y: number,
  shift: boolean
) {
  const style = currentDrawStyle();
  const layer = defaultLayer();

  if (!pathDraft || pathDraft.mode !== tool) {
    const filled = tool === 'polygon' ? (getToolPreset('polygon').filled ?? true) : undefined;
    pathDraft = { mode: tool, points: [{ x, y }], layer, style, filled };
    pathCursor = { x, y };
    drag = { kind: 'none' };
    redrawDrawingLayers(ctx);
    return;
  }

  if (tool === 'polygon') {
    const first = pathDraft.points[0]!;
    if (pathDraft.points.length >= 3 && dist(x, y, first.x, first.y) <= POLYGON_CLOSE_R) {
      finishPathDraft(ctx);
      return;
    }
  }

  addPathVertex(x, y, shift);
  drag = { kind: 'none' };
  redrawDrawingLayers(ctx);
}

export function attachDrawingInteraction(getCtx: () => InteractionContext) {
  const hit = getCtx().canvases.hit;

  hit.addEventListener('pointerdown', (ev) => {
    const ctx = getCtx();
    if (ctx.width <= 0 || ctx.height <= 0) return;
    hit.setPointerCapture(ev.pointerId);
    const { x, y } = canvasPoint(hit, ev);
    const tool = drawingState.activeTool;
    previewAnn = null;

    if (tool === 'strokeFill') {
      const masks = ctx.getPerFileMasks().filter((m) => m.enabled);
      const key = hitTestStrokeMask(x, y, ctx.width, ctx.height, masks);
      if (!key) return;
      const item = masks.find((m) => m.fileKey === key);
      const hasFill = drawingState.strokeFills.some((s) => s.fileKey === key);
      drawingState.selectedIds = new Set();

      if (ev.ctrlKey || ev.metaKey) {
        if (hasFill) {
          removeStrokeFill(key);
          drawingState.selectedStrokeKeys.delete(key);
        } else {
          drawingState.selectedStrokeKeys.add(key);
          if (item) {
            setStrokeFill(key, item.groupId, drawingState.strokeFillColor, drawingState.strokeFillLayer);
            rememberToolPresetFromStrokeFill({
              color: drawingState.strokeFillColor,
              layer: drawingState.strokeFillLayer,
            });
          }
        }
      } else {
        drawingState.selectedStrokeKeys = new Set([key]);
        if (item) {
          setStrokeFill(key, item.groupId, drawingState.strokeFillColor, drawingState.strokeFillLayer);
          rememberToolPresetFromStrokeFill({
            color: drawingState.strokeFillColor,
            layer: drawingState.strokeFillLayer,
          });
        }
      }

      redrawDrawingLayers(ctx);
      notifySelection(ctx);
      return;
    }

    if (tool === 'copyCentroid') {
      const data = ctx.getMetricsForCopy();
      const style = currentDrawStyle();
      if (data.overall?.show && data.overall.metrics.centroid) {
        const r = ctx.centroidRadii(data.overall.metrics);
        addAnnotation({
          kind: 'centroidCopy',
          id: newAnnId(),
          layer: 'top',
          style,
          x: data.overall.metrics.centroid.x,
          y: data.overall.metrics.centroid.y,
          rx: r.rx,
          ry: r.ry,
          color: data.overall.color,
        });
      }
      for (const g of data.groups) {
        if (!g.enabled || !g.metrics.centroid) continue;
        const r = ctx.centroidRadii(g.metrics);
        addAnnotation({
          kind: 'centroidCopy',
          id: newAnnId(),
          layer: 'top',
          style,
          x: g.metrics.centroid.x,
          y: g.metrics.centroid.y,
          rx: r.rx,
          ry: r.ry,
          color: g.color,
        });
      }
      redrawDrawingLayers(ctx);
      enterEditAfterCreate(ctx);
      return;
    }

    if (tool === 'copyBBox' || tool === 'copyBodyBBox') {
      const data = ctx.getMetricsForCopy();
      const style = currentDrawStyle();
      const kind = tool === 'copyBBox' ? 'bboxCopy' : 'bodyBBoxCopy';
      const rectOf =
        kind === 'bboxCopy'
          ? (m: Metrics) => m.bbox
          : (m: Metrics) => m.bodyBBox?.rect;
      copyFrameAnnotations(data, kind, rectOf, style);
      redrawDrawingLayers(ctx);
      enterEditAfterCreate(ctx);
      return;
    }

    if (tool === 'select') {
      const hitR = hitTestAnnotations(x, y, drawingState.annotations, ctx.width);
      if (hitR.kind === 'handle') {
        const ann = drawingState.annotations.find((a) => a.id === hitR.annId)!;
        beginEdit();
        drag = { kind: 'handle', annId: hitR.annId, handle: hitR.handle, startAnn: structuredClone(ann) };
        if (!drawingState.selectedIds.has(hitR.annId)) drawingState.selectedIds = new Set([hitR.annId]);
        notifySelection(ctx);
        return;
      }
      if (hitR.kind === 'move') {
        const ids =
          ev.shiftKey && drawingState.selectedIds.has(hitR.annId) ? drawingState.selectedIds : new Set([hitR.annId]);
        if (!ev.shiftKey) {
          drawingState.selectedIds = ids;
          drawingState.selectedStrokeKeys = new Set();
        }

        let bases = new Map<string, Annotation>();
        let primaryId = hitR.annId;

        if (ev.altKey) {
          pushUndo();
          const dup = duplicateAnnotationsForDrag(ids, hitR.annId);
          if (!dup) return;
          bases = dup.bases;
          primaryId = dup.primaryId;
          drawingState.selectedIds = dup.newIds;
        } else {
          for (const id of ids) {
            const a = drawingState.annotations.find((an) => an.id === id);
            if (a) bases.set(id, structuredClone(a));
          }
          beginEdit();
        }

        drag = { kind: 'move', annId: primaryId, ox: x, oy: y, bases };
        notifySelection(ctx);
        return;
      }
      drawingState.selectedIds = new Set();
      drawingState.selectedStrokeKeys = new Set();
      redrawDrawingLayers(ctx);
      notifySelection(ctx);
      return;
    }

    if (tool === 'polygon' || tool === 'polyline') {
      handlePathToolDown(ctx, tool, x, y, ev.shiftKey);
      return;
    }

    if (tool === 'crossMark' || tool === 'centroidMark' || tool === 'circleMark') {
      const preset = markIconPreset(tool);
      addAnnotation({
        kind: tool,
        id: newAnnId(),
        x,
        y,
        size: preset.size,
        layer: preset.layer,
        style: { ...preset.style },
      });
      finishCreate(ctx);
      return;
    }

    if (tool === 'annularSector') {
      const style = currentDrawStyle();
      const layer = defaultLayer();
      addAnnotation({
        kind: 'annularSector',
        id: newAnnId(),
        cx: x,
        cy: y,
        rInner: drawingState.annularInnerR,
        rOuter: drawingState.annularOuterR,
        a0: ANNULAR_DEFAULT_A0,
        a1: ANNULAR_DEFAULT_A1,
        layer,
        style,
      });
      finishCreate(ctx);
      return;
    }

    drag = { kind: 'create', tool, x0: x, y0: y, preview: null };
  });

  hit.addEventListener('pointermove', (ev) => {
    const ctx = getCtx();
    if (ctx.width <= 0 || ctx.height <= 0) return;
    const { x, y } = canvasPoint(hit, ev);
    const style = currentDrawStyle();
    const layer = defaultLayer();
    const shift = ev.shiftKey;

    if (drag.kind === 'move') {
      const dx = x - drag.ox;
      const dy = y - drag.oy;
      for (const [id, base] of drag.bases) {
        updateAnnotation(id, moveAnnotation(base, dx, dy));
      }
      previewAnn = null;
      redrawDrawingLayers(ctx);
      return;
    }

    if (drag.kind === 'handle') {
      const hd = drag;
      const ann = drawingState.annotations.find((a) => a.id === hd.annId);
      const s = hd.startAnn;
      if (!ann) return;
      if ((ann.kind === 'line' || ann.kind === 'arrow') && (s.kind === ann.kind)) {
        const ax = hd.handle === 'p0' ? ann.x1 : ann.x0;
        const ay = hd.handle === 'p0' ? ann.y1 : ann.y0;
        const { x: px, y: py } = angleSnappedPoint(ax, ay, x, y, 'snap8', { shift });
        if (hd.handle === 'p0') updateAnnotation(ann.id, { x0: px, y0: py });
        else updateAnnotation(ann.id, { x1: px, y1: py });
      } else if (ann.kind === 'proportionScale' && s.kind === 'proportionScale') {
        if (hd.handle.startsWith('split:')) {
          const idx = Number(hd.handle.slice(6));
          const ratios = effectiveProportionRatios(ann.count, ann.ratios);
          const splits = proportionSplitT(ratios);
          if (idx >= 0 && idx < splits.length) {
            let t = paramOnProportionLine(ann.x0, ann.y0, ann.x1, ann.y1, x, y);
            t = clampSplitT(splits, idx, t);
            const next = [...splits];
            next[idx] = t;
            updateAnnotation(ann.id, { ratios: ratiosFromSplitT(next) });
          }
        } else if (hd.handle === 'p0' || hd.handle === 'p1') {
          const ax = hd.handle === 'p0' ? ann.x1 : ann.x0;
          const ay = hd.handle === 'p0' ? ann.y1 : ann.y0;
          const { x: px, y: py } = angleSnappedPoint(ax, ay, x, y, 'snap8', { requireShift: false });
          if (hd.handle === 'p0') updateAnnotation(ann.id, { x0: px, y0: py });
          else updateAnnotation(ann.id, { x1: px, y1: py });
        }
      } else if (
        (ann.kind === 'rect' || ann.kind === 'square' || ann.kind === 'bboxCopy' || ann.kind === 'bodyBBoxCopy') &&
        s.kind === ann.kind
      ) {
        if (shift) {
          const ax = hd.handle === 'p0' ? ann.x1 : ann.x0;
          const ay = hd.handle === 'p0' ? ann.y1 : ann.y0;
          const c = squareCornerFromAnchor(ax, ay, x, y);
          if (hd.handle === 'p0') updateAnnotation(ann.id, { x0: c.x, y0: c.y });
          else updateAnnotation(ann.id, { x1: c.x, y1: c.y });
        } else if (hd.handle === 'p0') updateAnnotation(ann.id, { x0: x, y0: y });
        else updateAnnotation(ann.id, { x1: x, y1: y });
      } else if (ann.kind === 'equalSpacing' && s.kind === 'equalSpacing') {
        const patch =
          hd.handle === 'p0'
            ? { x0: x, y0: y, orientation: equalSpacingOrientationFromDrag(x, y, ann.x1, ann.y1) }
            : { x1: x, y1: y, orientation: equalSpacingOrientationFromDrag(ann.x0, ann.y0, x, y) };
        updateAnnotation(ann.id, patch);
      } else if (ann.kind === 'crossMark' || ann.kind === 'centroidMark' || ann.kind === 'circleMark') {
        updateAnnotation(ann.id, { size: Math.max(dist(ann.x, ann.y, x, y) * 2, 8) });
      } else if (
        (ann.kind === 'polygon' || ann.kind === 'polyline') &&
        (s.kind === 'polygon' || s.kind === 'polyline') &&
        hd.handle.startsWith('v:')
      ) {
        const idx = Number(hd.handle.slice(2));
        if (idx >= 0 && idx < ann.points.length) {
          const closed = ann.kind === 'polygon';
          const anchor = pathVertexAnchor(ann.points, idx, closed);
          const { x: px, y: py } = angleSnappedPoint(anchor.x, anchor.y, x, y, 'snap16', { shift });
          const next = ann.points.map((p, i) => (i === idx ? { x: px, y: py } : p));
          updateAnnotation(ann.id, { points: next });
        }
      } else if (ann.kind === 'annularSector' && s.kind === 'annularSector') {
        const ang = angleOnCircle(ann.cx, ann.cy, x, y);
        const r = Math.max(dist(ann.cx, ann.cy, x, y), 4);
        if (hd.handle === 'c') {
          updateAnnotation(ann.id, { cx: x, cy: y });
        } else if (hd.handle === 'is') {
          updateAnnotation(ann.id, { a0: ang, rInner: Math.min(r, ann.rOuter - 4) });
        } else if (hd.handle === 'ie') {
          updateAnnotation(ann.id, { a1: ang, rInner: Math.min(r, ann.rOuter - 4) });
        } else if (hd.handle === 'os') {
          updateAnnotation(ann.id, { a0: ang, rOuter: Math.max(r, ann.rInner + 4) });
        } else if (hd.handle === 'oe') {
          updateAnnotation(ann.id, { a1: ang, rOuter: Math.max(r, ann.rInner + 4) });
        }
      }
      previewAnn = null;
      redrawDrawingLayers(ctx);
      return;
    }

    if (drag.kind !== 'create') {
      if (drag.kind === 'none' && pathDraft && pathDraftActiveForTool(drawingState.activeTool)) {
        const last = pathDraft.points[pathDraft.points.length - 1]!;
        pathCursor = angleSnappedPoint(last.x, last.y, x, y, 'snap16', { shift });
        redrawDrawingLayers(ctx);
      }
      return;
    }

    const { x0, y0, tool } = drag;

    if (tool === 'line') {
      const p = endPoint(x0, y0, x, y, shift, 'snap8');
      previewAnn = { kind: 'line', id: '__p', x0, y0, x1: p.x, y1: p.y, layer, style } as Annotation;
    } else if (tool === 'rect') {
      const r = rectFromDrag(x0, y0, x, y, shift);
      const filled = getToolPreset('rect').filled ?? true;
      previewAnn = { kind: 'rect', id: '__p', ...r, filled, layer, style } as Annotation;
    } else if (tool === 'arrow') {
      const p = endPoint(x0, y0, x, y, shift, 'snap8');
      previewAnn = { kind: 'arrow', id: '__p', x0, y0, x1: p.x, y1: p.y, layer, style } as Annotation;
    } else if (tool === 'equalSpacing') {
      previewAnn = {
        kind: 'equalSpacing',
        id: '__p',
        orientation: equalSpacingOrientationFromDrag(x0, y0, x, y),
        count: drawingState.equalSpacingCount,
        x0,
        y0,
        x1: x,
        y1: y,
        layer,
        style,
      } as Annotation;
    } else if (tool === 'proportionScale') {
      const divCount = drawingState.proportionDividerCount;
      const p = angleSnappedPoint(x0, y0, x, y, 'snap8', { requireShift: false });
      previewAnn = {
        kind: 'proportionScale',
        id: '__p',
        x0,
        y0,
        x1: p.x,
        y1: p.y,
        count: divCount,
        ratios: equalProportionRatios(divCount),
        layer,
        style,
      } as Annotation;
    }

    redrawDrawingLayers(ctx);
  });

  hit.addEventListener('pointerup', (ev) => {
    const ctx = getCtx();
    if (ctx.width <= 0 || ctx.height <= 0) return;
    const { x, y } = canvasPoint(hit, ev);
    const style = currentDrawStyle();
    const layer = defaultLayer();

    if (drag.kind === 'move' || drag.kind === 'handle') {
      if (drag.kind === 'handle') {
        const hd = drag;
        const ann = drawingState.annotations.find((a) => a.id === hd.annId);
        if (ann) rememberToolPresetFromAnnotation(ann);
      }
      drag = { kind: 'none' };
      previewAnn = null;
      redrawDrawingLayers(ctx);
      notifySelection(ctx);
      return;
    }

    if (drag.kind === 'create') {
      if (previewAnn && previewAnn.id === '__p') {
        const { id: _id, ...rest } = previewAnn;
        addAnnotation({ ...rest, id: newAnnId() } as Annotation);
      } else {
        const { x0, y0, tool } = drag;
        const minDist = 4;
        const ex = Math.abs(x - x0) < minDist ? x0 + minDist : x;
        const ey = Math.abs(y - y0) < minDist ? y0 + minDist : y;
        if (tool === 'line') {
          const p = endPoint(x0, y0, ex, ey, ev.shiftKey, 'snap8');
          addAnnotation({ kind: 'line', id: newAnnId(), x0, y0, x1: p.x, y1: p.y, layer, style });
        } else if (tool === 'rect') {
          const r = rectFromDrag(x0, y0, ex, ey, ev.shiftKey);
          const filled = getToolPreset('rect').filled ?? true;
          addAnnotation({ kind: 'rect', id: newAnnId(), ...r, filled, layer, style });
        } else if (tool === 'arrow') {
          const p = endPoint(x0, y0, ex, ey, ev.shiftKey, 'snap8');
          addAnnotation({ kind: 'arrow', id: newAnnId(), x0, y0, x1: p.x, y1: p.y, layer, style });
        } else if (tool === 'equalSpacing') {
          addAnnotation({
            kind: 'equalSpacing',
            id: newAnnId(),
            orientation: equalSpacingOrientationFromDrag(x0, y0, ex, ey),
            count: drawingState.equalSpacingCount,
            x0,
            y0,
            x1: ex,
            y1: ey,
            layer,
            style,
          });
        } else if (tool === 'proportionScale') {
          const divCount = drawingState.proportionDividerCount;
          const p = angleSnappedPoint(x0, y0, ex, ey, 'snap8', { requireShift: false });
          addAnnotation({
            kind: 'proportionScale',
            id: newAnnId(),
            x0,
            y0,
            x1: p.x,
            y1: p.y,
            count: divCount,
            ratios: equalProportionRatios(divCount),
            layer,
            style,
          });
        }
      }
      finishCreate(ctx);
      return;
    }

    drag = { kind: 'none' };
    previewAnn = null;
  });

  hit.addEventListener('pointercancel', () => {
    drag = { kind: 'none' };
    previewAnn = null;
    redrawDrawingLayers(getCtx());
  });
}

export function setupDrawingKeyboard(getCtx: () => InteractionContext, onRedraw: () => void) {
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement)
      return;
    if (ev.key === 'Escape') {
      drag = { kind: 'none' };
      previewAnn = null;
      cancelPolygonDraft();
      onRedraw();
    } else if (ev.key === 'Enter' && pathDraft && pathDraftActiveForTool(drawingState.activeTool)) {
      ev.preventDefault();
      finishPathDraft(getCtx());
      onRedraw();
    } else if (ev.key === 'Backspace' && pathDraft && pathDraftActiveForTool(drawingState.activeTool)) {
      ev.preventDefault();
      pathDraft.points.pop();
      if (pathDraft.points.length === 0) cancelPolygonDraft();
      onRedraw();
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      removeSelected();
      onRedraw();
    } else if (ev.key === 'v' || ev.key === 'V') {
      drawingState.activeTool = 'select';
      syncToolButtons();
    } else if (ev.ctrlKey && ev.key === 'z') {
      ev.preventDefault();
      if (undo()) onRedraw();
    } else if (ev.ctrlKey && (ev.key === 'y' || (ev.shiftKey && ev.key === 'z'))) {
      ev.preventDefault();
      if (redo()) onRedraw();
    }
  });
}

let toolOptionsRefresh: (() => void) | null = null;

export function setToolOptionsRefresh(fn: () => void) {
  toolOptionsRefresh = fn;
}

export function syncToolButtons() {
  document.querySelectorAll('[data-tool]').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.tool === drawingState.activeTool);
  });
  toolOptionsRefresh?.();
}
