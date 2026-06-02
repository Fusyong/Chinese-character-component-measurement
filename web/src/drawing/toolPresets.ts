import { defaultLayerForTool } from './store';
import type { Annotation, DrawLayer, DrawStyle, DrawTool, StrokeFillEntry } from './types';
import { MARK_ICON_KINDS, polygonAnnotationFilled, rectAnnotationFilled, type MarkIconKind } from './types';
export type ConfigurableDrawTool = Exclude<DrawTool, 'select'>;

export type ToolPreset = {
  style: DrawStyle;
  layer: DrawLayer;
  filled?: boolean;
  markSize?: number;
  equalSpacingCount?: number;
  proportionDividerCount?: number;
  annularInnerR?: number;
  annularOuterR?: number;
  strokeFillColor?: string;
};

const DEFAULT_STYLE: DrawStyle = { color: 'rgb(220, 60, 60)', lineWidth: 2 };

const CONFIGURABLE_TOOLS: ConfigurableDrawTool[] = [
  'strokeFill',
  'line',
  'rect',
  'arrow',
  'polygon',
  'polyline',
  'equalSpacing',
  'proportionScale',
  'annularSector',
  'crossMark',
  'centroidMark',
  'circleMark',
  'copyCentroid',
  'copyBBox',
  'copyBodyBBox',
];

function createDefaultPreset(tool: ConfigurableDrawTool): ToolPreset {
  const preset: ToolPreset = {
    style: { ...DEFAULT_STYLE },
    layer: defaultLayerForTool(tool),
  };
  if (tool === 'strokeFill') {
    preset.strokeFillColor = 'rgba(255, 107, 107, 0.45)';
    preset.layer = 'top';
  }
  if ((MARK_ICON_KINDS as readonly string[]).includes(tool)) {
    preset.markSize = 40;
  }
  if (tool === 'equalSpacing') preset.equalSpacingCount = 3;
  if (tool === 'proportionScale') preset.proportionDividerCount = 3;
  if (tool === 'rect' || tool === 'polygon') preset.filled = true;
  if (tool === 'annularSector') {
    preset.annularInnerR = 100;
    preset.annularOuterR = 300;
  }
  return preset;
}

const toolPresets: Record<ConfigurableDrawTool, ToolPreset> = Object.fromEntries(
  CONFIGURABLE_TOOLS.map((t) => [t, createDefaultPreset(t)])
) as Record<ConfigurableDrawTool, ToolPreset>;

export function isConfigurableDrawTool(tool: DrawTool): tool is ConfigurableDrawTool {
  return tool !== 'select';
}

export function getToolPreset(tool: ConfigurableDrawTool): ToolPreset {
  const p = toolPresets[tool];
  return {
    style: { ...p.style },
    layer: p.layer,
    filled: p.filled,
    markSize: p.markSize,
    equalSpacingCount: p.equalSpacingCount,
    proportionDividerCount: p.proportionDividerCount,
    annularInnerR: p.annularInnerR,
    annularOuterR: p.annularOuterR,
    strokeFillColor: p.strokeFillColor,
  };
}

export function setToolPreset(tool: ConfigurableDrawTool, patch: Partial<ToolPreset>) {
  const cur = toolPresets[tool];
  toolPresets[tool] = {
    style: patch.style ? { ...patch.style } : { ...cur.style },
    layer: patch.layer ?? cur.layer,
    filled: patch.filled ?? cur.filled,
    markSize: patch.markSize ?? cur.markSize,
    equalSpacingCount: patch.equalSpacingCount ?? cur.equalSpacingCount,
    proportionDividerCount: patch.proportionDividerCount ?? cur.proportionDividerCount,
    annularInnerR: patch.annularInnerR ?? cur.annularInnerR,
    annularOuterR: patch.annularOuterR ?? cur.annularOuterR,
    strokeFillColor: patch.strokeFillColor ?? cur.strokeFillColor,
  };
}

function toolForAnnotationKind(kind: Annotation['kind']): ConfigurableDrawTool | null {
  switch (kind) {
    case 'line':
    case 'rect':
    case 'arrow':
    case 'polygon':
    case 'polyline':
    case 'equalSpacing':
    case 'proportionScale':
    case 'annularSector':
    case 'crossMark':
    case 'centroidMark':
    case 'circleMark':
      return kind;
    case 'square':
      return 'rect';
    case 'centroidCopy':
      return 'copyCentroid';
    case 'bboxCopy':
      return 'copyBBox';
    case 'bodyBBoxCopy':
      return 'copyBodyBBox';
    default:
      return null;
  }
}

export function rememberToolPresetFromAnnotation(ann: Annotation) {
  const tool = toolForAnnotationKind(ann.kind);
  if (!tool) return;

  const patch: Partial<ToolPreset> = {
    style: { ...ann.style },
    layer: ann.layer,
  };

  switch (ann.kind) {
    case 'rect':
    case 'square':
      patch.filled = rectAnnotationFilled(ann);
      break;
    case 'polygon':
      patch.filled = polygonAnnotationFilled(ann);
      break;
    case 'crossMark':
    case 'centroidMark':
    case 'circleMark':
      patch.markSize = ann.size;
      break;
    case 'equalSpacing':
      patch.equalSpacingCount = ann.count;
      break;
    case 'proportionScale':
      patch.proportionDividerCount = ann.count;
      break;
    case 'annularSector':
      patch.annularInnerR = ann.rInner;
      patch.annularOuterR = ann.rOuter;
      break;
    case 'centroidCopy':
    case 'bboxCopy':
    case 'bodyBBoxCopy':
      patch.style = { color: ann.color, lineWidth: ann.style.lineWidth };
      break;
  }

  setToolPreset(tool, patch);
}

export function rememberToolPresetFromStrokeFill(fill: Pick<StrokeFillEntry, 'color' | 'layer'>) {
  setToolPreset('strokeFill', {
    strokeFillColor: fill.color,
    layer: fill.layer,
    style: toolPresets.strokeFill.style,
  });
}

export function applyToolPresetToDrawingState(
  tool: ConfigurableDrawTool,
  state: {
    drawStyle: DrawStyle;
    defaultLayer: DrawLayer;
    equalSpacingCount: number;
    proportionDividerCount: number;
    annularInnerR: number;
    annularOuterR: number;
    strokeFillColor: string;
    strokeFillLayer: DrawLayer;
  }
): ToolPreset {
  const preset = getToolPreset(tool);

  if (tool === 'strokeFill') {
    if (preset.strokeFillColor) state.strokeFillColor = preset.strokeFillColor;
    state.strokeFillLayer = preset.layer;
    return preset;
  }

  state.drawStyle = { ...preset.style };
  state.defaultLayer = preset.layer;
  if (preset.equalSpacingCount != null) state.equalSpacingCount = preset.equalSpacingCount;
  if (preset.proportionDividerCount != null) state.proportionDividerCount = preset.proportionDividerCount;
  if (preset.annularInnerR != null) state.annularInnerR = preset.annularInnerR;
  if (preset.annularOuterR != null) state.annularOuterR = preset.annularOuterR;

  return preset;
}

export function markIconPreset(tool: MarkIconKind) {
  const p = getToolPreset(tool);
  return {
    size: p.markSize ?? 40,
    style: p.style,
    layer: p.layer,
  };
}
