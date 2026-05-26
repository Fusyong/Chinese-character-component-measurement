import type { Annotation, DrawLayer, DrawStyle, DrawTool, StrokeFillEntry } from './types';

export type DrawingState = {
  annotations: Annotation[];
  selectedIds: Set<string>;
  strokeFills: StrokeFillEntry[];
  selectedStrokeKeys: Set<string>;
  activeTool: DrawTool;
  defaultLayer: DrawLayer;
  drawStyle: DrawStyle;
  equalSpacingCount: number;
  strokeFillColor: string;
  strokeFillLayer: DrawLayer;
  proportionDividerCount: number;
  crossMarkSize: number;
  annularInnerR: number;
  annularOuterR: number;
};

const MAX_UNDO = 30;

type Snapshot = {
  annotations: Annotation[];
  strokeFills: StrokeFillEntry[];
};

let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];

export const drawingState: DrawingState = {
  annotations: [],
  selectedIds: new Set(),
  strokeFills: [],
  selectedStrokeKeys: new Set(),
  activeTool: 'select',
  defaultLayer: 'under',
  drawStyle: { color: 'rgb(220, 60, 60)', lineWidth: 2 },
  equalSpacingCount: 3,
  strokeFillColor: 'rgba(255, 107, 107, 0.45)',
  strokeFillLayer: 'top',
  proportionDividerCount: 3,
  crossMarkSize: 40,
  annularInnerR: 100,
  annularOuterR: 300,
};

export function newAnnId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function snapshot(): Snapshot {
  return {
    annotations: drawingState.annotations.map((a) => ({ ...a })),
    strokeFills: drawingState.strokeFills.map((s) => ({ ...s })),
  };
}

export function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
}

export function undo() {
  if (undoStack.length === 0) return false;
  redoStack.push(snapshot());
  const prev = undoStack.pop()!;
  drawingState.annotations = prev.annotations;
  drawingState.strokeFills = prev.strokeFills;
  drawingState.selectedIds = new Set();
  return true;
}

export function redo() {
  if (redoStack.length === 0) return false;
  undoStack.push(snapshot());
  const next = redoStack.pop()!;
  drawingState.annotations = next.annotations;
  drawingState.strokeFills = next.strokeFills;
  drawingState.selectedIds = new Set();
  return true;
}

export function addAnnotation(ann: Annotation, skipUndo = false) {
  if (!skipUndo) pushUndo();
  drawingState.annotations.push(ann);
  drawingState.selectedIds = new Set([ann.id]);
}

export function updateAnnotation(id: string, patch: Partial<Annotation>) {
  const i = drawingState.annotations.findIndex((a) => a.id === id);
  if (i < 0) return;
  drawingState.annotations[i] = { ...drawingState.annotations[i]!, ...patch } as Annotation;
}

export function beginEdit() {
  pushUndo();
}

export function removeSelected() {
  if (drawingState.selectedIds.size === 0) return;
  pushUndo();
  const ids = drawingState.selectedIds;
  drawingState.annotations = drawingState.annotations.filter((a) => !ids.has(a.id));
  drawingState.selectedIds = new Set();
}

export function clearAnnotations() {
  if (drawingState.annotations.length === 0 && drawingState.strokeFills.length === 0) return;
  pushUndo();
  drawingState.annotations = [];
  drawingState.strokeFills = [];
  drawingState.selectedIds = new Set();
  drawingState.selectedStrokeKeys = new Set();
}

export function setStrokeFill(fileKey: string, groupId: string, color: string, layer: DrawLayer) {
  pushUndo();
  patchStrokeFill(fileKey, groupId, color, layer);
}

export function patchStrokeFill(fileKey: string, groupId: string, color: string, layer: DrawLayer) {
  const idx = drawingState.strokeFills.findIndex((s) => s.fileKey === fileKey);
  if (idx >= 0) {
    drawingState.strokeFills[idx] = { fileKey, groupId, color, layer };
  } else {
    drawingState.strokeFills.push({ fileKey, groupId, color, layer });
  }
}

export function removeStrokeFill(fileKey: string) {
  const idx = drawingState.strokeFills.findIndex((s) => s.fileKey === fileKey);
  if (idx < 0) return;
  pushUndo();
  drawingState.strokeFills.splice(idx, 1);
}

export function currentDrawStyle(): DrawStyle {
  return { ...drawingState.drawStyle };
}
