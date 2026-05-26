import { gridUnit } from './geom';
import { equalProportionRatios } from './proportionScale';
import { beginEdit, drawingState, patchStrokeFill, removeStrokeFill, updateAnnotation } from './store';
import type { Annotation, DrawLayer, StrokeFillEntry } from './types';

export type PropsPanelOptions = {
  getCanvasWidth: () => number;
  getFileLabel: (fileKey: string) => string;
  onRedraw: () => void;
};

function rgbToHex(css: string): string {
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return '#dc3c3c';
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${h(Number(m[1]))}${h(Number(m[2]))}${h(Number(m[3]))}`;
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function rgbaFromHex(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function alphaFromCss(css: string): number {
  const m = css.match(/rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([0-9.]+)\s*\)/i);
  if (m) return Number(m[1]);
  return 0.45;
}

function strokeFieldId(fileKey: string, field: string): string {
  let h = 0;
  for (let i = 0; i < fileKey.length; i++) h = (h * 31 + fileKey.charCodeAt(i)) >>> 0;
  return `sf-${h.toString(16)}-${field}`;
}

function encodeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function decodeAttr(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

const KIND_LABEL: Record<Annotation['kind'], string> = {
  line: '直线',
  rect: '方框',
  square: '方块',
  arrow: '箭头',
  equalSpacing: '等距线',
  proportionScale: '比例尺',
  annularSector: '扇形',
  crossMark: '十字',
  centroidCopy: '重心',
  bboxCopy: '外接框',
  bodyBBoxCopy: '主体框',
};

function frameCopyProps(ann: import('./types').FrameCopyAnnotation, p: string) {
  return (
    `<div class="propKind">${KIND_LABEL[ann.kind]}</div>` +
    num(`${p}-x0`, '角1 X', ann.x0) +
    num(`${p}-y0`, '角1 Y', ann.y0) +
    num(`${p}-x1`, '角2 X', ann.x1) +
    num(`${p}-y1`, '角2 Y', ann.y1) +
    colorRow(`${p}-cc`, '标记色', ann.color) +
    num(`${p}-lw`, '线宽', ann.style.lineWidth, 0.5, 0.5, 12) +
    sel(`${p}-layer`, '图层', ann.layer, [
      { v: 'under', t: '默认（字下）' },
      { v: 'top', t: '上层' },
    ])
  );
}

function num(id: string, label: string, value: number, step = 1, min?: number, max?: number) {
  const minA = min !== undefined ? ` min="${min}"` : '';
  const maxA = max !== undefined ? ` max="${max}"` : '';
  return `<div class="row propRow"><label for="${id}">${label}</label><input class="propInput" id="${id}" type="number" step="${step}" value="${Math.round(value * 100) / 100}"${minA}${maxA} /></div>`;
}

function sel(id: string, label: string, value: string, options: { v: string; t: string }[]) {
  const opts = options.map((o) => `<option value="${o.v}"${o.v === value ? ' selected' : ''}>${o.t}</option>`).join('');
  return `<div class="row propRow"><label for="${id}">${label}</label><select class="propInput" id="${id}">${opts}</select></div>`;
}

function colorRow(id: string, label: string, css: string) {
  return `<div class="row propRow propRowColor"><label for="${id}">${label}</label><input class="propInput propColorInput" id="${id}" type="color" value="${rgbToHex(css)}" title="${label}" /></div>`;
}

function textRow(id: string, label: string, value: string) {
  return `<div class="row propRow"><label for="${id}">${label}</label><input class="propInput" id="${id}" type="text" value="${value.replace(/"/g, '&quot;')}" /></div>`;
}

function styleBlock(ann: Annotation, prefix: string) {
  return (
    colorRow(`${prefix}-color`, '颜色', ann.style.color) +
    num(`${prefix}-lw`, '线宽', ann.style.lineWidth, 0.5, 0.5, 12) +
    sel(`${prefix}-layer`, '图层', ann.layer, [
      { v: 'under', t: '默认（字下）' },
      { v: 'top', t: '上层' },
    ])
  );
}

function htmlForAnnotation(ann: Annotation, canvasW: number): string {
  const gu = gridUnit(canvasW);
  const p = `ann-${ann.id.slice(0, 8)}`;
  let body = `<div class="propKind">${KIND_LABEL[ann.kind]}</div>` + styleBlock(ann, p);

  switch (ann.kind) {
    case 'line':
    case 'arrow':
      body +=
        num(`${p}-x0`, '起点 X', ann.x0) +
        num(`${p}-y0`, '起点 Y', ann.y0) +
        num(`${p}-x1`, '终点 X', ann.x1) +
        num(`${p}-y1`, '终点 Y', ann.y1);
      if (ann.kind === 'line') {
        const len = Math.hypot(ann.x1 - ann.x0, ann.y1 - ann.y0);
        body += `<div class="propHint">长度 ≈ ${Math.round((len / gu) * 10) / 10}（格宽=100）</div>`;
      }
      break;
    case 'rect':
    case 'square':
      body +=
        num(`${p}-x0`, '角1 X', ann.x0) +
        num(`${p}-y0`, '角1 Y', ann.y0) +
        num(`${p}-x1`, '角2 X', ann.x1) +
        num(`${p}-y1`, '角2 Y', ann.y1);
      break;
    case 'equalSpacing':
      body +=
        sel(`${p}-orient`, '图示', ann.orientation, [
          { v: 'v', t: '竖向（横分隔线）' },
          { v: 'h', t: '横向（竖分隔线）' },
        ]) +
        num(`${p}-count`, '分隔线数', ann.count, 1, 1, 24) +
        num(`${p}-x0`, '起点 X', ann.x0) +
        num(`${p}-y0`, '起点 Y', ann.y0) +
        num(`${p}-x1`, '终点 X', ann.x1) +
        num(`${p}-y1`, '终点 Y', ann.y1);
      break;
    case 'proportionScale':
      body +=
        num(`${p}-count`, '分隔线数', ann.count, 1, 2, 24) +
        num(`${p}-x0`, '起点 X', ann.x0) +
        num(`${p}-y0`, '起点 Y', ann.y0) +
        num(`${p}-x1`, '终点 X', ann.x1) +
        num(`${p}-y1`, '终点 Y', ann.y1);
      break;
    case 'annularSector':
      body +=
        num(`${p}-cx`, '圆心 X', ann.cx) +
        num(`${p}-cy`, '圆心 Y', ann.cy) +
        num(`${p}-rInner`, '内圆半径', ann.rInner, 0.5, 1) +
        num(`${p}-rOuter`, '外圆半径', ann.rOuter, 0.5, 1) +
        num(`${p}-a0`, '起始角°', (ann.a0 * 180) / Math.PI, 1) +
        num(`${p}-a1`, '结束角°', (ann.a1 * 180) / Math.PI, 1);
      break;
    case 'crossMark':
      body += num(`${p}-x`, '中心 X', ann.x) + num(`${p}-y`, '中心 Y', ann.y) + num(`${p}-size`, '大小', ann.size, 1, 4, 200);
      break;
    case 'centroidCopy':
      body =
        `<div class="propKind">${KIND_LABEL[ann.kind]}</div>` +
        num(`${p}-x`, '中心 X', ann.x) +
        num(`${p}-y`, '中心 Y', ann.y) +
        num(`${p}-rx`, '椭圆 rx', ann.rx, 0.5, 1) +
        num(`${p}-ry`, '椭圆 ry', ann.ry, 0.5, 1) +
        colorRow(`${p}-cc`, '标记色', ann.color) +
        num(`${p}-lw`, '线宽', ann.style.lineWidth, 0.5, 0.5, 12) +
        sel(`${p}-layer`, '图层', ann.layer, [
          { v: 'under', t: '默认（字下）' },
          { v: 'top', t: '上层' },
        ]);
      break;
    case 'bboxCopy':
    case 'bodyBBoxCopy':
      body = frameCopyProps(ann, p);
      break;
  }
  return body;
}

function strokeColorRow(fileKey: string, label: string, css: string): string {
  const id = strokeFieldId(fileKey, 'color');
  return (
    `<div class="row propRow propRowColor"><label for="${id}">${label}</label>` +
    `<input class="propInput propColorInput" id="${id}" type="color" value="${rgbToHex(css)}" title="${label}" ` +
    `data-stroke-file-key="${encodeAttr(fileKey)}" /></div>`
  );
}

function strokeLayerRow(fileKey: string, layer: DrawLayer): string {
  const id = strokeFieldId(fileKey, 'layer');
  const opts = [
    { v: 'under', t: '默认（字下）' },
    { v: 'top', t: '上层' },
  ]
    .map((o) => `<option value="${o.v}"${o.v === layer ? ' selected' : ''}>${o.t}</option>`)
    .join('');
  return (
    `<div class="row propRow"><label for="${id}">图层</label>` +
    `<select class="propInput" id="${id}" data-stroke-file-key="${encodeAttr(fileKey)}">${opts}</select></div>`
  );
}

function applyStrokeFillFromForm(fileKey: string) {
  const fill = drawingState.strokeFills.find((f) => f.fileKey === fileKey);
  if (!fill) return;
  const colorEl = document.getElementById(strokeFieldId(fileKey, 'color')) as HTMLInputElement | null;
  const layerEl = document.getElementById(strokeFieldId(fileKey, 'layer')) as HTMLSelectElement | null;
  if (!colorEl || !layerEl) return;
  patchStrokeFill(fileKey, fill.groupId, rgbaFromHex(colorEl.value, alphaFromCss(fill.color)), layerEl.value as DrawLayer);
}

function htmlForStrokeFill(fill: StrokeFillEntry, label: string): string {
  return (
    `<div class="propKind">笔画涂色</div>` +
    `<div class="propHint">${label}</div>` +
    strokeColorRow(fill.fileKey, '颜色', fill.color) +
    strokeLayerRow(fill.fileKey, fill.layer) +
    `<div class="btns" style="margin-top:6px"><button type="button" class="propRemoveStroke" data-file-key="${encodeAttr(fill.fileKey)}">移除涂色</button></div>`
  );
}

function readNum(id: string): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? Number(el.value) : NaN;
}

function readText(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el?.value ?? '';
}

function applyStyleFromForm(annId: string, prefix: string) {
  const color = hexToRgb((document.getElementById(`${prefix}-color`) as HTMLInputElement).value);
  const lineWidth = readNum(`${prefix}-lw`);
  const layer = (document.getElementById(`${prefix}-layer`) as HTMLSelectElement).value as DrawLayer;
  updateAnnotation(annId, { style: { color, lineWidth }, layer });
}

function applyAnnotationFromForm(ann: Annotation) {
  const p = `ann-${ann.id.slice(0, 8)}`;
  applyStyleFromForm(ann.id, p);

  switch (ann.kind) {
    case 'line':
      updateAnnotation(ann.id, {
        x0: readNum(`${p}-x0`),
        y0: readNum(`${p}-y0`),
        x1: readNum(`${p}-x1`),
        y1: readNum(`${p}-y1`),
      });
      break;
    case 'arrow':
      updateAnnotation(ann.id, {
        x0: readNum(`${p}-x0`),
        y0: readNum(`${p}-y0`),
        x1: readNum(`${p}-x1`),
        y1: readNum(`${p}-y1`),
      });
      break;
    case 'rect':
    case 'square':
      updateAnnotation(ann.id, {
        x0: readNum(`${p}-x0`),
        y0: readNum(`${p}-y0`),
        x1: readNum(`${p}-x1`),
        y1: readNum(`${p}-y1`),
      });
      break;
    case 'equalSpacing':
      updateAnnotation(ann.id, {
        orientation: (document.getElementById(`${p}-orient`) as HTMLSelectElement).value as 'h' | 'v',
        count: Math.max(1, Math.round(readNum(`${p}-count`))),
        x0: readNum(`${p}-x0`),
        y0: readNum(`${p}-y0`),
        x1: readNum(`${p}-x1`),
        y1: readNum(`${p}-y1`),
      });
      break;
    case 'proportionScale': {
      const count = Math.max(2, Math.round(readNum(`${p}-count`)));
      const countChanged = count !== ann.count;
      updateAnnotation(ann.id, {
        x0: readNum(`${p}-x0`),
        y0: readNum(`${p}-y0`),
        x1: readNum(`${p}-x1`),
        y1: readNum(`${p}-y1`),
        count,
        ratios: countChanged ? equalProportionRatios(count) : ann.ratios,
      });
      break;
    }
    case 'annularSector':
      updateAnnotation(ann.id, {
        cx: readNum(`${p}-cx`),
        cy: readNum(`${p}-cy`),
        rInner: readNum(`${p}-rInner`),
        rOuter: readNum(`${p}-rOuter`),
        a0: (readNum(`${p}-a0`) * Math.PI) / 180,
        a1: (readNum(`${p}-a1`) * Math.PI) / 180,
      });
      break;
    case 'crossMark':
      updateAnnotation(ann.id, {
        x: readNum(`${p}-x`),
        y: readNum(`${p}-y`),
        size: readNum(`${p}-size`),
      });
      break;
    case 'centroidCopy': {
      const cc = hexToRgb((document.getElementById(`${p}-cc`) as HTMLInputElement).value);
      updateAnnotation(ann.id, {
        x: readNum(`${p}-x`),
        y: readNum(`${p}-y`),
        rx: readNum(`${p}-rx`),
        ry: readNum(`${p}-ry`),
        color: cc,
        style: { color: cc, lineWidth: readNum(`${p}-lw`) },
        layer: (document.getElementById(`${p}-layer`) as HTMLSelectElement).value as DrawLayer,
      });
      break;
    }
    case 'bboxCopy':
    case 'bodyBBoxCopy': {
      const cc = hexToRgb((document.getElementById(`${p}-cc`) as HTMLInputElement).value);
      updateAnnotation(ann.id, {
        x0: readNum(`${p}-x0`),
        y0: readNum(`${p}-y0`),
        x1: readNum(`${p}-x1`),
        y1: readNum(`${p}-y1`),
        color: cc,
        style: { color: cc, lineWidth: readNum(`${p}-lw`) },
        layer: (document.getElementById(`${p}-layer`) as HTMLSelectElement).value as DrawLayer,
      });
      break;
    }
  }
}

export function mountPropsPanel(container: HTMLElement, opts: PropsPanelOptions): () => void {
  let editStarted = false;

  container.innerHTML = `<div class="annPropsEmpty">选中图示后可编辑参数</div>`;

  container.addEventListener('focusin', () => {
    if (!editStarted) {
      beginEdit();
      editStarted = true;
    }
  });

  container.addEventListener('focusout', (ev) => {
    const rel = ev.relatedTarget as Node | null;
    if (!rel || !container.contains(rel)) editStarted = false;
  });

  const onPropFieldChange = (ev: Event) => {
    const t = ev.target as HTMLElement;
    const strokeKeyAttr = t.getAttribute('data-stroke-file-key');
    if (strokeKeyAttr !== null) {
      applyStrokeFillFromForm(decodeAttr(strokeKeyAttr));
      opts.onRedraw();
      return;
    }

    if (!t.classList.contains('propInput')) return;

    const annIds = [...drawingState.selectedIds];
    if (annIds.length === 1) {
      const ann = drawingState.annotations.find((a) => a.id === annIds[0]);
      if (ann) applyAnnotationFromForm(ann);
      opts.onRedraw();
    }
  };

  container.addEventListener('input', onPropFieldChange);
  container.addEventListener('change', onPropFieldChange);

  container.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('.propRemoveStroke');
    if (!btn) return;
    const keyAttr = btn.getAttribute('data-file-key');
    if (!keyAttr) return;
    const key = decodeAttr(keyAttr);
    removeStrokeFill(key);
    drawingState.selectedStrokeKeys.delete(key);
    opts.onRedraw();
    refresh();
  });

  function refresh() {
    const annIds = [...drawingState.selectedIds];
    const strokeKeys = [...drawingState.selectedStrokeKeys];
    const canvasW = opts.getCanvasWidth();

    if (annIds.length === 0 && strokeKeys.length === 0) {
      container.innerHTML = `<div class="annPropsEmpty">选中图示后可编辑参数</div>`;
      return;
    }

    if (annIds.length > 1) {
      container.innerHTML =
        `<div class="propKind">已选 ${annIds.length} 个图示</div>` +
        `<div class="propHint">请单选以编辑几何参数；可多选后拖拽移动。</div>`;
      return;
    }

    if (annIds.length === 1) {
      const ann = drawingState.annotations.find((a) => a.id === annIds[0]);
      if (!ann) {
        container.innerHTML = `<div class="annPropsEmpty">选中图示后可编辑参数</div>`;
        return;
      }
      container.innerHTML = `<div class="annPropsForm">${htmlForAnnotation(ann, canvasW)}</div>`;
      return;
    }

    if (strokeKeys.length >= 1) {
      const key = strokeKeys[strokeKeys.length - 1]!;
      const fill = drawingState.strokeFills.find((f) => f.fileKey === key);
      if (!fill) {
        container.innerHTML = `<div class="annPropsEmpty">点击笔画以涂色</div>`;
        return;
      }
      container.innerHTML = `<div class="annPropsForm">${htmlForStrokeFill(fill, opts.getFileLabel(key))}</div>`;
    }
  }

  return refresh;
}
