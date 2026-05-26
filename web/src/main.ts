import './style.css';
import { saveAs } from 'file-saver';
import type { ExportPayload, Group, GroupResult, Metrics, Rect } from './types';
import { buildMergedMaskFromFiles, buildPerFileMasks, type PerFileMask } from './mask';
import { computeBasicMetrics } from './metrics';
import { computeBodyBBoxQuantile1d, computeBodyBBoxIntegral2d, verifyRectRatio } from './bodyRange';
import { marchingSquaresContours, simplifyPolylineRDP } from './contour';
import { compositeExportBlob } from './drawing/composite';
import {
  attachDrawingInteraction,
  redrawDrawingLayers,
  setToolOptionsRefresh,
  setupDrawingKeyboard,
  syncToolButtons,
} from './drawing/interaction';
import type { DrawTool } from './drawing/types';
import { mountPropsPanel } from './drawing/propsPanel';
import { clearAnnotations, drawingState } from './drawing/store';
import { fileKey } from './mask';
import { renderGuideLayer, renderMeasureLayers, type MeasureRenderInput } from './renderPipeline';

type BodyMethod = 'quantile1d' | 'integral2d';

type AppState = {
  threshold: number; // 0..255
  invert: boolean;
  bodyRatio: number; // 0..1
  showContours: boolean;
  contourEps: number; // px
  showBBox: boolean;
  showBodyBBox: boolean;
  showCentroid: boolean;
  bodyMethod: BodyMethod;
  showGroupOverlays: boolean;
  showOverallOverlays: boolean;
  overlayAlpha: number; // 0..1
  overlayLineWidth: number; // px
  centroidAreaK: number;
};

const state: AppState = {
  threshold: 200,
  invert: false,
  bodyRatio: 0.95,
  showContours: true,
  contourEps: 2,
  showBBox: false,
  showBodyBBox: true,
  showCentroid: true,
  bodyMethod: 'quantile1d',
  showOverallOverlays: false,
  showGroupOverlays: true,
  overlayAlpha: 0.62,
  overlayLineWidth: 2,
  centroidAreaK: 0.02,
};

type GroupState = Group & { files: File[] };

type RGB = { r: number; g: number; b: number };

function rgbCss({ r, g, b }: RGB) {
  return `rgb(${r}, ${g}, ${b})`;
}

function parseRGBA(css: string): { rgb: RGB; a: number } {
  const m = css
    .trim()
    .match(/^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (!m) throw new Error(`无法解析颜色：${css}`);
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const a = m[4] !== undefined ? Number(m[4]) : 1;
  return { rgb: { r, g, b }, a: Number.isFinite(a) ? a : 1 };
}

function parseRGB(css: string): RGB {
  // Supports: rgb(r,g,b) / rgba(r,g,b,a)
  const m = css
    .trim()
    .match(/^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (!m) throw new Error(`无法解析颜色：${css}`);
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  return { r, g, b };
}

function overlayStyleFromBaseColor(baseCss: string) {
  const rgb = parseRGB(baseCss);
  return {
    color: rgbCss(rgb),
    alpha: state.overlayAlpha,
    lineWidth: state.overlayLineWidth,
    dash: undefined as number[] | undefined,
  };
}

function guideStyleFromCanvasBorder(canvas: HTMLCanvasElement) {
  const cs = getComputedStyle(canvas);
  const borderColor = cs.borderTopColor || cs.borderColor;
  const borderWidth = cs.borderTopWidth || cs.borderWidth;

  const { rgb, a } = parseRGBA(borderColor);
  const lw = Math.max(1, Math.round(parseFloat(borderWidth) || 1));

  return {
    color: rgbCss(rgb),
    alpha: a,
    lineWidth: lw,
    dash: [8, 6] as number[],
  };
}

// 每组的“基色”（不含透明度），渲染时派生浅/深两档。
const groupColors = [
  'rgb(255, 107, 107)', // red
  'rgb(122, 162, 255)', // blue
  'rgb(255, 203, 107)', // amber
  'rgb(141, 233, 199)', // mint
  'rgb(201, 143, 255)', // purple
  'rgb(255, 154, 219)', // pink
];

// 整体（overall）固定颜色：0.3 灰（更接近深灰）
const overallBaseColor = 'rgb(77, 77, 77)';

function newId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function formatFileNames(files: File[]): string {
  if (files.length === 0) return '未选择文件';
  if (files.length === 1) return files[0].name;
  if (files.length <= 3) return files.map((f) => f.name).join('、');
  return `${files[0].name} 等 ${files.length} 个文件`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let groups: GroupState[] = [
  { id: newId(), name: '组 1', color: groupColors[0], enabled: true, files: [] },
];

const appEl = document.querySelector<HTMLDivElement>('#app');
if (!appEl) throw new Error('Missing #app');

appEl.innerHTML = `
  <div class="app">
    <div class="panel compact" id="leftPanel">
      <h2>组（多组共享同一套设置）</h2>
      <div id="groupList"></div>
      <div class="btns">
        <button id="addGroup">添加组</button>
      </div>

      <h2 style="margin-top:14px">阈值（仅在无透明时生效）</h2>

      <div class="row">
        <label>二值阈值</label>
        <div><small id="thrVal"></small></div>
      </div>
      <input id="thr" type="range" min="0" max="255" step="1" />

      <div class="row">
        <label>反相（把黑当 1）</label>
        <input id="invert" type="checkbox" />
      </div>

      <h2 style="margin-top:14px">主体范围</h2>
      <div class="row">
        <label>主体比例</label>
        <div><small id="ratioVal"></small></div>
      </div>
      <input id="ratio" type="range" min="0.5" max="0.99" step="0.01" />

      <div class="row">
        <label>主体范围算法</label>
        <select id="bodyMethod">
          <option value="quantile1d">快速（1D 分位裁剪）</option>
          <option value="integral2d">更接近最小矩形（降采样 2D 搜索）</option>
        </select>
      </div>

      <h2 style="margin-top:14px">显示</h2>
      <div class="row">
        <label>标记透明度</label>
        <div><small id="alphaVal"></small></div>
      </div>
      <input id="alpha" type="range" min="0.05" max="1" step="0.01" />

      <div class="row">
        <label>线条粗细</label>
        <div><small id="lwVal"></small></div>
      </div>
      <input id="lw" type="range" min="1" max="6" step="0.5" />

      <div class="row">
        <label>重心圆面积比例</label>
        <div><small id="ckVal"></small></div>
      </div>
      <input id="ck" type="range" min="0" max="0.08" step="0.001" />

      <div class="row"><label>显示整体标记</label><input id="showOverallOverlays" type="checkbox" /></div>
      <div class="row"><label>显示组标记</label><input id="showGroupOverlays" type="checkbox" /></div>
      <div class="row"><label>轮廓</label><input id="showContours" type="checkbox" /></div>
      <div class="row"><label>轮廓简化 ε（像素）</label><div><small id="epsVal"></small></div></div>
      <input id="eps" type="range" min="0" max="8" step="0.5" />

      <div class="row"><label>外接框 bbox</label><input id="showBBox" type="checkbox" /></div>
      <div class="row"><label>主体框 body bbox</label><input id="showBodyBBox" type="checkbox" /></div>
      <div class="row"><label>重心</label><input id="showCentroid" type="checkbox" /></div>

      <div class="btns">
        <button id="exportJSON" disabled>导出 metrics.json</button>
        <button id="exportPNG" disabled>导出标注图 PNG</button>
        <button id="clear" class="danger">清空</button>
      </div>
      <div class="warn" id="warn"></div>
    </div>

    <div class="canvasWrap">
      <canvas id="guideCv" class="layerCanvas layer0"></canvas>
      <canvas id="drawUnderCv" class="layerCanvas layer1"></canvas>
      <canvas id="measureCv" class="layerCanvas layer2"></canvas>
      <canvas id="glyphCv" class="layerCanvas layer3"></canvas>
      <canvas id="measureOverCv" class="layerCanvas layer4"></canvas>
      <canvas id="drawTopCv" class="layerCanvas layer5"></canvas>
      <canvas id="hitCv" class="hitLayer"></canvas>
    </div>

    <div class="panel" id="rightPanel">
      <div class="drawToolbar" id="drawToolbar">
        <h2>手动画图</h2>
        <div class="toolGrid" id="toolGrid">
        <button type="button" class="toolBtn" data-tool="strokeFill">笔画涂色</button>
        <button type="button" class="toolBtn" data-tool="line">直线</button>
        <button type="button" class="toolBtn" data-tool="arrow">箭头</button>
        <button type="button" class="toolBtn" data-tool="rect">方框</button>
        <button type="button" class="toolBtn" data-tool="square">方块</button>
        <button type="button" class="toolBtn" data-tool="annularSector">扇形</button>
        <button type="button" class="toolBtn" data-tool="equalSpacing">等距线</button>
        <button type="button" class="toolBtn" data-tool="proportionScale">比例尺</button>
        <button type="button" class="toolBtn" data-tool="crossMark">十字</button>
        <button type="button" class="toolBtn" data-tool="copyCentroid">复制重心</button>
        <button type="button" class="toolBtn" data-tool="copyBBox">复制外接框</button>
        <button type="button" class="toolBtn" data-tool="copyBodyBBox">复制主体框</button>
        <button type="button" class="toolBtn toolBtnFull active" data-tool="select">选择并调整图形</button>
        </div>
        <div class="toolOpts" id="toolOpts">
          <p id="toolOptHint" class="toolOptHint" hidden></p>
          <div id="drawStyleOpts" class="toolOptGroup">
            <div class="row propRowColor"><label for="drawColor">图示颜色</label><input id="drawColor" class="propColorInput" type="color" value="#dc3c3c" /></div>
            <div class="row"><label>线宽</label><input id="drawLw" type="range" min="1" max="6" step="0.5" value="2" /></div>
            <div class="row"><label>新建图层</label>
              <select id="drawLayer">
                <option value="under">默认（字下）</option>
                <option value="top">上层</option>
              </select>
            </div>
          </div>
          <div id="equalOpts" class="toolOptGroup" hidden>
            <div class="row"><label>分隔线数</label><input id="eqCount" type="number" min="1" max="24" value="3" /></div>
            <p class="toolOptHint" style="margin:4px 0 0">拖拽矩形：较长边定方向（竖→横线，横→竖线），较短边为线宽。</p>
          </div>
          <div id="proportionOpts" class="toolOptGroup" hidden>
            <div class="row"><label>分隔线数</label><input id="propDivCount" type="number" min="2" max="24" value="3" /></div>
            <p class="toolOptHint" style="margin:4px 0 0">默认各段等比例；拖拽后可拖中间分割线微调。</p>
          </div>
          <div id="crossOpts" class="toolOptGroup" hidden>
            <div class="row"><label>大小</label><input id="crossSize" type="number" min="4" max="200" value="40" /></div>
            <p class="toolOptHint" style="margin:4px 0 0">点击画布放置十字，大小与拖拽无关。</p>
          </div>
          <div id="strokeOpts" class="toolOptGroup" hidden>
            <div class="row propRowColor"><label for="strokeColor">涂色</label><input id="strokeColor" class="propColorInput" type="color" value="#ff6b6b" /></div>
            <div class="row"><label>涂色层</label>
              <select id="strokeLayer"><option value="under">默认（字下）</option><option value="top" selected>上层</option></select>
            </div>
          </div>
        </div>
        <div class="btns">
          <button type="button" id="clearDrawings">清空图示</button>
        </div>
        <div class="annProps" id="annProps">
          <h3>选中参数</h3>
          <div id="annPropsBody"></div>
        </div>
      </div>
      <h2>状态</h2>
      <div id="statusPanel">
        <div class="kv"><div>状态</div><div><code id="status">未选择文件</code></div></div>
        <div class="kv"><div>尺寸</div><div><code id="dim">—</code></div></div>
      </div>
      <h2>测量结果</h2>
      <div id="metrics"></div>
    </div>
  </div>
`;

const el = {
  groupList: document.querySelector<HTMLDivElement>('#groupList')!,
  addGroup: document.querySelector<HTMLButtonElement>('#addGroup')!,
  thr: document.querySelector<HTMLInputElement>('#thr')!,
  thrVal: document.querySelector<HTMLElement>('#thrVal')!,
  invert: document.querySelector<HTMLInputElement>('#invert')!,
  ratio: document.querySelector<HTMLInputElement>('#ratio')!,
  ratioVal: document.querySelector<HTMLElement>('#ratioVal')!,
  bodyMethod: document.querySelector<HTMLSelectElement>('#bodyMethod')!,
  alpha: document.querySelector<HTMLInputElement>('#alpha')!,
  alphaVal: document.querySelector<HTMLElement>('#alphaVal')!,
  lw: document.querySelector<HTMLInputElement>('#lw')!,
  lwVal: document.querySelector<HTMLElement>('#lwVal')!,
  ck: document.querySelector<HTMLInputElement>('#ck')!,
  ckVal: document.querySelector<HTMLElement>('#ckVal')!,
  showOverallOverlays: document.querySelector<HTMLInputElement>('#showOverallOverlays')!,
  showGroupOverlays: document.querySelector<HTMLInputElement>('#showGroupOverlays')!,
  showContours: document.querySelector<HTMLInputElement>('#showContours')!,
  eps: document.querySelector<HTMLInputElement>('#eps')!,
  epsVal: document.querySelector<HTMLElement>('#epsVal')!,
  showBBox: document.querySelector<HTMLInputElement>('#showBBox')!,
  showBodyBBox: document.querySelector<HTMLInputElement>('#showBodyBBox')!,
  showCentroid: document.querySelector<HTMLInputElement>('#showCentroid')!,
  exportJSON: document.querySelector<HTMLButtonElement>('#exportJSON')!,
  exportPNG: document.querySelector<HTMLButtonElement>('#exportPNG')!,
  clear: document.querySelector<HTMLButtonElement>('#clear')!,
  warn: document.querySelector<HTMLElement>('#warn')!,
  statusPanel: document.querySelector<HTMLElement>('#statusPanel')!,
  status: document.querySelector<HTMLElement>('#status')!,
  dim: document.querySelector<HTMLElement>('#dim')!,
  metrics: document.querySelector<HTMLElement>('#metrics')!,
  guideCanvas: document.querySelector<HTMLCanvasElement>('#guideCv')!,
  drawUnderCanvas: document.querySelector<HTMLCanvasElement>('#drawUnderCv')!,
  measureCanvas: document.querySelector<HTMLCanvasElement>('#measureCv')!,
  glyphCanvas: document.querySelector<HTMLCanvasElement>('#glyphCv')!,
  measureOverCanvas: document.querySelector<HTMLCanvasElement>('#measureOverCv')!,
  drawTopCanvas: document.querySelector<HTMLCanvasElement>('#drawTopCv')!,
  hitCanvas: document.querySelector<HTMLCanvasElement>('#hitCv')!,
  drawColor: document.querySelector<HTMLInputElement>('#drawColor')!,
  drawLw: document.querySelector<HTMLInputElement>('#drawLw')!,
  drawLayer: document.querySelector<HTMLSelectElement>('#drawLayer')!,
  toolOptHint: document.querySelector<HTMLElement>('#toolOptHint')!,
  drawStyleOpts: document.querySelector<HTMLElement>('#drawStyleOpts')!,
  equalOpts: document.querySelector<HTMLElement>('#equalOpts')!,
  proportionOpts: document.querySelector<HTMLElement>('#proportionOpts')!,
  propDivCount: document.querySelector<HTMLInputElement>('#propDivCount')!,
  eqCount: document.querySelector<HTMLInputElement>('#eqCount')!,
  strokeOpts: document.querySelector<HTMLElement>('#strokeOpts')!,
  crossOpts: document.querySelector<HTMLElement>('#crossOpts')!,
  crossSize: document.querySelector<HTMLInputElement>('#crossSize')!,
  strokeColor: document.querySelector<HTMLInputElement>('#strokeColor')!,
  strokeLayer: document.querySelector<HTMLSelectElement>('#strokeLayer')!,
  clearDrawings: document.querySelector<HTMLButtonElement>('#clearDrawings')!,
  annPropsBody: document.querySelector<HTMLDivElement>('#annPropsBody')!,
};

function setWarn(msg: string) {
  el.warn.textContent = msg;
}

function fmt(n?: number) {
  if (n === undefined) return '—';
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100) / 100}`;
}

function updateControlsFromState() {
  el.thr.value = String(state.threshold);
  el.thrVal.textContent = `${state.threshold}`;
  el.invert.checked = state.invert;

  el.ratio.value = String(state.bodyRatio);
  el.ratioVal.textContent = `${Math.round(state.bodyRatio * 100)}%`;
  el.bodyMethod.value = state.bodyMethod;

  el.showContours.checked = state.showContours;
  el.eps.value = String(state.contourEps);
  el.epsVal.textContent = `${state.contourEps}px`;
  el.showBBox.checked = state.showBBox;
  el.showBodyBBox.checked = state.showBodyBBox;
  el.showCentroid.checked = state.showCentroid;
  el.showGroupOverlays.checked = state.showGroupOverlays;
  el.showOverallOverlays.checked = state.showOverallOverlays;

  el.alpha.value = String(state.overlayAlpha);
  el.alphaVal.textContent = `${Math.round(state.overlayAlpha * 100)}%`;
  el.lw.value = String(state.overlayLineWidth);
  el.lwVal.textContent = `${state.overlayLineWidth}px`;

  el.ck.value = String(state.centroidAreaK);
  el.ckVal.textContent = `${Math.round(state.centroidAreaK * 1000) / 1000}`;
}

let lastExport: ExportPayload | null = null;
let lastAnnotatedBlob: Blob | null = null;

type GroupPerFileCache = {
  groupId: string;
  enabled: boolean;
  perFile: PerFileMask[];
};

let lastPerFileMasks: GroupPerFileCache[] = [];
let canvasSize = { w: 0, h: 0 };

function setAllCanvasSize(w: number, h: number) {
  canvasSize = { w, h };
  for (const cv of [
    el.guideCanvas,
    el.drawUnderCanvas,
    el.measureCanvas,
    el.glyphCanvas,
    el.measureOverCanvas,
    el.drawTopCanvas,
    el.hitCanvas,
  ]) {
    cv.width = w;
    cv.height = h;
  }
}

function clearAllLayers() {
  for (const cv of [
    el.guideCanvas,
    el.drawUnderCanvas,
    el.measureCanvas,
    el.glyphCanvas,
    el.measureOverCanvas,
    el.drawTopCanvas,
  ]) {
    const ctx = cv.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  }
}

async function refreshExportBlob() {
  if (canvasSize.w <= 0) {
    lastAnnotatedBlob = null;
    return;
  }
  lastAnnotatedBlob = await compositeExportBlob({
    drawUnder: el.drawUnderCanvas,
    measure: el.measureCanvas,
    glyph: el.glyphCanvas,
    measureOver: el.measureOverCanvas,
    drawTop: el.drawTopCanvas,
  });
}

function interactionCtx() {
  return {
    width: canvasSize.w,
    height: canvasSize.h,
    canvases: {
      drawUnder: el.drawUnderCanvas,
      drawTop: el.drawTopCanvas,
      hit: el.hitCanvas,
    },
    getPerFileMasks: () =>
      lastPerFileMasks.flatMap((g) =>
        g.perFile.map((pf) => ({
          fileKey: pf.fileKey,
          groupId: g.groupId,
          mask: pf.mask.mask,
          enabled: g.enabled,
        }))
      ),
    getMetricsForCopy: () => ({
      overall: lastExport
        ? {
            metrics: lastExport.overall,
            color: overallBaseColor,
            show: state.showOverallOverlays,
          }
        : undefined,
      groups:
        lastExport?.groups.map((gr) => ({
          id: gr.group.id,
          metrics: gr.metrics,
          color: gr.group.color,
          enabled: gr.group.enabled && state.showGroupOverlays,
        })) ?? [],
    }),
    centroidRadii: (m: Metrics) => centroidEllipseRadiiPx(m, state.centroidAreaK),
    onExportRefresh: () => void refreshExportBlob(),
    onSelectionChange: () => refreshPropsPanel(),
  };
}

function fileLabelForKey(key: string): string {
  for (const g of groups) {
    for (const f of g.files) {
      if (fileKey(f) === key) return f.name;
    }
  }
  return key.split(':')[0] ?? key;
}

let refreshPropsPanel: () => void = () => {};

function redrawCanvasOnly() {
  if (canvasSize.w > 0) redrawDrawingLayers(interactionCtx());
}

function redrawAll() {
  redrawCanvasOnly();
  refreshPropsPanel();
}

function renderMetricsPanel(payload: ExportPayload | null) {
  if (!payload) {
    el.metrics.innerHTML = `<div class="kv"><div>状态</div><div><code>—</code></div></div>`;
    return;
  }

  const m = payload.overall;
  const bodyRect = m.bodyBBox?.rect;
  const achieved = m.bodyBBox?.achievedRatio;

  el.metrics.innerHTML = `
    <div class="kv"><div>尺寸</div><div><code>${m.width}×${m.height}</code></div></div>
    <div class="kv"><div>面积（像素数）</div><div><code>${m.area}</code></div></div>
    <div class="kv"><div>重心 (x,y)</div><div><code>${m.centroid ? `${fmt(m.centroid.x)}, ${fmt(m.centroid.y)}` : '—'}</code></div></div>
    <div class="kv"><div>bbox</div><div><code>${m.bbox ? `${m.bbox.x0},${m.bbox.y0},${m.bbox.x1},${m.bbox.y1}` : '—'}</code></div></div>
    <div class="kv"><div>主体框（${Math.round((m.bodyBBox?.ratio ?? 0) * 100)}%）</div><div><code>${
      bodyRect ? `${bodyRect.x0},${bodyRect.y0},${bodyRect.x1},${bodyRect.y1}` : '—'
    }</code></div></div>
    <div class="kv"><div>主体框达成比例</div><div><code>${
      achieved !== undefined ? `${Math.round(achieved * 10000) / 100}%` : '—'
    }</code></div></div>
    <div class="kv"><div>主体算法</div><div><code>${m.bodyBBox?.method ?? '—'}</code></div></div>
    <div class="kv"><div>轮廓数量</div><div><code>${m.contours?.polylines.length ?? '—'}</code></div></div>
    <div class="kv"><div>轮廓简化 ε</div><div><code>${m.contours ? `${m.contours.simplifyEpsilonPx}px` : '—'}</code></div></div>
    <div class="kv"><div>显示组标记数</div><div><code>${payload.groups.filter((g) => g.group.enabled).length} / ${payload.groups.length}</code></div></div>
  `;
}

function renderGroupList() {
  const rows = groups
    .map((g, idx) => {
      const fileCount = g.files.length;
      const fileNames = escapeHtml(formatFileNames(g.files));
      const st = overlayStyleFromBaseColor(g.color);
      return `
        <div class="groupCard">
          <div class="groupHeader">
            <label title="仅控制该组外框/主体框/重心的显示；不影响该组轮廓线与整体合并/整体测量">
              <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${st.color}"></span>
              <input type="checkbox" data-act="toggleEnabled" data-id="${g.id}" ${g.enabled ? 'checked' : ''} />
              <span data-act="rename" data-id="${g.id}">${g.name}</span>
            </label>
            <small>${fileCount} 个</small>
            <button data-act="removeGroup" data-id="${g.id}" ${groups.length <= 1 ? 'disabled' : ''}>移除</button>
          </div>
          <div class="groupFilesRow">
            <div class="miniLabel">PNG</div>
            <label class="filePicker">
              <input class="fileInput" data-act="pickFiles" data-id="${g.id}" type="file" accept="image/png" multiple />
              <span class="filePickerBtn">浏览…</span>
              <span class="filePickerNames" title="${fileNames}">${fileNames}</span>
            </label>
          </div>
        </div>
      `;
    })
    .join('');
  el.groupList.innerHTML = rows;
}

async function recomputeAndRender() {
  setWarn('');

  const groupsWithFiles = groups.filter((g) => g.files.length > 0);
  const anyFiles = groupsWithFiles.length > 0;
  if (!anyFiles) {
    el.status.textContent = '未选择文件';
    el.dim.textContent = '';
    lastExport = null;
    lastAnnotatedBlob = null;
    renderMetricsPanel(null);
    lastPerFileMasks = [];
    clearAllLayers();
    el.exportJSON.disabled = true;
    el.exportPNG.disabled = true;
    return;
  }

  const totalFiles = groupsWithFiles.reduce((acc, g) => acc + g.files.length, 0);
  el.status.textContent = `处理中：${groupsWithFiles.length} 组 / ${totalFiles} 个文件`;

  const maskOpts = { threshold: state.threshold, invert: state.invert };
  const groupMerged = await Promise.all(
    groupsWithFiles.map(async (g) => ({
      group: g,
      merged: await buildMergedMaskFromFiles(g.files, maskOpts),
      perFile: await buildPerFileMasks(g.files, maskOpts),
    }))
  );

  lastPerFileMasks = groupMerged.map((gm) => ({
    groupId: gm.group.id,
    enabled: gm.group.enabled,
    perFile: gm.perFile,
  }));

  // Determine canvas size from the first non-empty group.
  const firstNonEmpty = groupMerged.find((x) => x.merged.width > 0 && x.merged.height > 0);
  if (!firstNonEmpty) throw new Error('没有可处理的文件');

  const W = firstNonEmpty.merged.width;
  const H = firstNonEmpty.merged.height;

  // Ensure all groups share the same size.
  for (const gm of groupMerged) {
    if (gm.merged.width === 0 && gm.merged.height === 0) continue;
    if (gm.merged.width !== W || gm.merged.height !== H) {
      throw new Error(`不同组的图片尺寸不一致：期望 ${W}×${H}，但遇到 ${gm.merged.width}×${gm.merged.height}`);
    }
  }

  // Overall merge by OR across all groups (with files). Group switch only controls overlay visibility.
  const overallMask = new Uint8Array(W * H);
  let overallBinarizeMode: 'alpha' | 'lumaThreshold' = 'alpha';
  for (const gm of groupMerged) {
    const m = gm.merged;
    if (m.mask.length === 0) continue;
    overallBinarizeMode = overallBinarizeMode === 'alpha' && m.binarizeMode === 'alpha' ? 'alpha' : 'lumaThreshold';
    for (let i = 0; i < overallMask.length; i++) {
      overallMask[i] = overallMask[i] | m.mask[i];
    }
  }

  const overallMerged = { width: W, height: H, mask: overallMask, binarizeMode: overallBinarizeMode } as const;

  setAllCanvasSize(W, H);
  el.dim.textContent = `${W}×${H}`;

  const gctx = el.guideCanvas.getContext('2d');
  if (gctx) {
    const guideStyle = guideStyleFromCanvasBorder(el.glyphCanvas);
    renderGuideLayer(gctx, W, H, guideStyle);
  }

  const overallBasic = computeBasicMetrics(overallMerged.mask, W, H);

  let bodyRect: Rect | undefined;
  if (overallBasic.area > 0) {
    if (state.bodyMethod === 'quantile1d') {
      bodyRect = computeBodyBBoxQuantile1d(overallMerged.mask, W, H, state.bodyRatio);
    } else {
      bodyRect = computeBodyBBoxIntegral2d(overallMerged.mask, W, H, state.bodyRatio, {
        downsampleToMax: 220,
      });
    }
  }

  const achievedRatio =
    overallBasic.area > 0 && bodyRect ? verifyRectRatio(overallMerged.mask, W, H, bodyRect, overallBasic.area) : undefined;

  const contours =
    state.showContours && overallBasic.area > 0
      ? (() => {
          const raw = marchingSquaresContours(overallMerged.mask, W, H);
          const simplified = state.contourEps > 0 ? raw.map((pl) => simplifyPolylineRDP(pl, state.contourEps)) : raw;
          return { method: 'marchingSquares' as const, simplifyEpsilonPx: state.contourEps, polylines: simplified };
        })()
      : undefined;

  const overallMetrics: Metrics = {
    width: W,
    height: H,
    area: overallBasic.area,
    centroid: overallBasic.centroid,
    bbox: overallBasic.bbox,
    bodyBBox: {
      ratio: state.bodyRatio,
      method: state.bodyMethod,
      rect: bodyRect,
      achievedRatio,
    },
    contours,
    sources: {
      files: groupsWithFiles.flatMap((g) => g.files.map((f) => ({ name: f.name, lastModified: f.lastModified, size: f.size }))),
      binarize: {
        mode: overallMerged.binarizeMode,
        threshold: overallMerged.binarizeMode === 'lumaThreshold' ? state.threshold : undefined,
        invert: overallMerged.binarizeMode === 'lumaThreshold' ? state.invert : undefined,
      },
      mergedBy: 'or',
    },
  };

  // Per-group metrics
  const groupResults: GroupResult[] = groupMerged
    .filter((gm) => gm.group.files.length > 0)
    .map((gm) => {
      const gBasic = computeBasicMetrics(gm.merged.mask, W, H);

      let gBody: Rect | undefined;
      if (gBasic.area > 0) {
        if (state.bodyMethod === 'quantile1d') gBody = computeBodyBBoxQuantile1d(gm.merged.mask, W, H, state.bodyRatio);
        else gBody = computeBodyBBoxIntegral2d(gm.merged.mask, W, H, state.bodyRatio, { downsampleToMax: 220 });
      }

      const gAchieved = gBasic.area > 0 && gBody ? verifyRectRatio(gm.merged.mask, W, H, gBody, gBasic.area) : undefined;

      const gContours =
        state.showContours && gBasic.area > 0
          ? (() => {
              const raw = marchingSquaresContours(gm.merged.mask, W, H);
              const simplified = state.contourEps > 0 ? raw.map((pl) => simplifyPolylineRDP(pl, state.contourEps)) : raw;
              return { method: 'marchingSquares' as const, simplifyEpsilonPx: state.contourEps, polylines: simplified };
            })()
          : undefined;

      const m: Metrics = {
        width: W,
        height: H,
        area: gBasic.area,
        centroid: gBasic.centroid,
        bbox: gBasic.bbox,
        bodyBBox: {
          ratio: state.bodyRatio,
          method: state.bodyMethod,
          rect: gBody,
          achievedRatio: gAchieved,
        },
        contours: gContours,
        sources: {
          files: gm.group.files.map((f) => ({ name: f.name, lastModified: f.lastModified, size: f.size })),
          binarize: {
            mode: gm.merged.binarizeMode,
            threshold: gm.merged.binarizeMode === 'lumaThreshold' ? state.threshold : undefined,
            invert: gm.merged.binarizeMode === 'lumaThreshold' ? state.invert : undefined,
          },
          mergedBy: 'or',
        },
      };

      return {
        group: { id: gm.group.id, name: gm.group.name, color: gm.group.color, enabled: gm.group.enabled },
        metrics: m,
      };
    });

  const payload: ExportPayload = {
    version: 1,
    createdAt: new Date().toISOString(),
    sharedSettings: {
      threshold: state.threshold,
      invert: state.invert,
      bodyRatio: state.bodyRatio,
      bodyMethod: state.bodyMethod,
      contourEps: state.contourEps,
    },
    overall: overallMetrics,
    groups: groupResults,
  };

  lastExport = payload;

  const overlayOpts = {
    showBBox: state.showBBox,
    showBodyBBox: state.showBodyBBox,
    showCentroid: state.showCentroid,
    showContours: state.showContours,
  };

  const measureInput: MeasureRenderInput = {
    width: W,
    height: H,
    overallMerged,
    overallMetrics,
    groupResults,
    overlayOpts,
    showOverallOverlays: state.showOverallOverlays,
    showGroupOverlays: state.showGroupOverlays,
    overallStyle: overlayStyleFromBaseColor(overallBaseColor),
    groupStyle: (color) => overlayStyleFromBaseColor(color),
    centroidRadii: (m) => centroidEllipseRadiiPx(m, state.centroidAreaK),
  };

  renderMeasureLayers(
    {
      guide: null,
      measure: el.measureCanvas.getContext('2d'),
      glyph: el.glyphCanvas.getContext('2d', { willReadFrequently: true }),
      measureOver: el.measureOverCanvas.getContext('2d'),
    },
    measureInput
  );

  redrawAll();
  await refreshExportBlob();

  el.status.textContent = `完成：${groupsWithFiles.length} 组 / ${totalFiles} 个文件`;
  renderMetricsPanel(payload);
  el.exportJSON.disabled = false;
  el.exportPNG.disabled = false;

  if (
    overallMetrics.bodyBBox?.rect &&
    overallMetrics.bodyBBox.achievedRatio !== undefined &&
    overallMetrics.bodyBBox.achievedRatio + 1e-9 < overallMetrics.bodyBBox.ratio
  ) {
    setWarn(
      `警告：整体主体框达成比例为 ${Math.round(overallMetrics.bodyBBox.achievedRatio * 10000) / 100}%，小于目标 ${Math.round(
        overallMetrics.bodyBBox.ratio * 100
      )}%。可尝试切换算法或调整阈值/反相。`
    );
  }
}

function scheduleRecompute() {
  void recomputeAndRender().catch((err) => {
    console.error(err);
    setWarn(String(err?.message ?? err));
  });
}

function centroidEllipseRadiiPx(metrics: Metrics, k: number): { rx: number; ry: number } {
  const area = metrics.area;
  if (area <= 0 || k <= 0) return { rx: 0, ry: 0 };

  const r = metrics.bodyBBox?.rect ?? metrics.bbox;
  let aspect = 1;
  if (r) {
    const w = Math.max(1, r.x1 - r.x0 + 1);
    const h = Math.max(1, r.y1 - r.y0 + 1);
    aspect = w / h;
  }
  if (!Number.isFinite(aspect) || aspect <= 0) aspect = 1;

  // π*rx*ry = k*area and rx/ry = aspect
  const rxRaw = Math.sqrt((k * area * aspect) / Math.PI);
  const ryRaw = Math.sqrt((k * area) / (Math.PI * aspect));

  const minR = 3;
  const maxR = 48;
  const rx = Math.max(minR, Math.min(maxR, rxRaw));
  const ry = Math.max(minR, Math.min(maxR, ryRaw));
  return { rx, ry };
}

// Wire up UI
updateControlsFromState();
renderGroupList();
renderMetricsPanel(null);

el.groupList.addEventListener('change', (ev) => {
  const t = ev.target as HTMLElement;
  const act = t.getAttribute('data-act');
  const id = t.getAttribute('data-id');
  if (!act || !id) return;

  const g = groups.find((x) => x.id === id);
  if (!g) return;

  if (act === 'toggleEnabled' && t instanceof HTMLInputElement) {
    g.enabled = t.checked;
    scheduleRecompute();
  } else if (act === 'pickFiles' && t instanceof HTMLInputElement) {
    g.files = Array.from(t.files ?? []);
    renderGroupList(); // refresh file counts
    scheduleRecompute();
  }
});

el.groupList.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  const act = t.getAttribute('data-act');
  const id = t.getAttribute('data-id');
  if (!act || !id) return;

  if (act === 'removeGroup') {
    if (groups.length <= 1) return;
    groups = groups.filter((g) => g.id !== id);
    renderGroupList();
    scheduleRecompute();
  }
});

el.addGroup.addEventListener('click', () => {
  const idx = groups.length;
  const color = groupColors[idx % groupColors.length];
  groups.push({ id: newId(), name: `组 ${idx + 1}`, color, enabled: true, files: [] });
  renderGroupList();
});

el.thr.addEventListener('input', () => {
  state.threshold = Number(el.thr.value);
  el.thrVal.textContent = `${state.threshold}`;
  scheduleRecompute();
});

el.invert.addEventListener('change', () => {
  state.invert = el.invert.checked;
  scheduleRecompute();
});

el.ratio.addEventListener('input', () => {
  state.bodyRatio = Number(el.ratio.value);
  el.ratioVal.textContent = `${Math.round(state.bodyRatio * 100)}%`;
  scheduleRecompute();
});

el.bodyMethod.addEventListener('change', () => {
  state.bodyMethod = el.bodyMethod.value as BodyMethod;
  scheduleRecompute();
});

el.alpha.addEventListener('input', () => {
  state.overlayAlpha = Number(el.alpha.value);
  el.alphaVal.textContent = `${Math.round(state.overlayAlpha * 100)}%`;
  renderGroupList();
  scheduleRecompute();
});

el.lw.addEventListener('input', () => {
  state.overlayLineWidth = Number(el.lw.value);
  el.lwVal.textContent = `${state.overlayLineWidth}px`;
  renderGroupList();
  scheduleRecompute();
});

el.ck.addEventListener('input', () => {
  state.centroidAreaK = Number(el.ck.value);
  el.ckVal.textContent = `${Math.round(state.centroidAreaK * 1000) / 1000}`;
  scheduleRecompute();
});

el.showOverallOverlays.addEventListener('change', () => {
  state.showOverallOverlays = el.showOverallOverlays.checked;
  scheduleRecompute();
});

el.showGroupOverlays.addEventListener('change', () => {
  state.showGroupOverlays = el.showGroupOverlays.checked;
  scheduleRecompute();
});

el.showContours.addEventListener('change', () => {
  state.showContours = el.showContours.checked;
  scheduleRecompute();
});

el.eps.addEventListener('input', () => {
  state.contourEps = Number(el.eps.value);
  el.epsVal.textContent = `${state.contourEps}px`;
  scheduleRecompute();
});

el.showBBox.addEventListener('change', () => {
  state.showBBox = el.showBBox.checked;
  scheduleRecompute();
});

el.showBodyBBox.addEventListener('change', () => {
  state.showBodyBBox = el.showBodyBBox.checked;
  scheduleRecompute();
});

el.showCentroid.addEventListener('change', () => {
  state.showCentroid = el.showCentroid.checked;
  scheduleRecompute();
});

el.clear.addEventListener('click', () => {
  groups = groups.map((g) => ({ ...g, files: [] }));
  renderGroupList();
  scheduleRecompute();
});

el.exportJSON.addEventListener('click', () => {
  if (!lastExport) return;
  const blob = new Blob([JSON.stringify(lastExport, null, 2)], { type: 'application/json;charset=utf-8' });
  saveAs(blob, 'metrics.json');
});

el.exportPNG.addEventListener('click', () => {
  if (!lastAnnotatedBlob) return;
  saveAs(lastAnnotatedBlob, 'annotated.png');
});

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function updateDrawStyleFromUI() {
  const c = hexToRgb(el.drawColor.value);
  drawingState.drawStyle = {
    color: `rgb(${c.r}, ${c.g}, ${c.b})`,
    lineWidth: Number(el.drawLw.value),
  };
}

const DRAW_SHAPE_TOOLS = new Set<DrawTool>([
  'line',
  'rect',
  'square',
  'arrow',
  'equalSpacing',
  'proportionScale',
  'annularSector',
  'crossMark',
]);

const TOOL_HINTS: Partial<Record<DrawTool, string>> = {
  select: '点击图示选中；拖拽移动。Delete 删除，Shift 约束方向。',
  line: '拖拽画直线；按住 Shift 八向吸附。',
  arrow: '拖拽画箭头：起点横/竖短线（贴主方向一侧）标锐角；末端三角箭头。Shift 八向吸附。',
  strokeFill: '点击笔画涂色；Ctrl+点击已涂色笔画可移除。',
  copyCentroid: '点击画布，将当前可见的整体/组重心复制到上层。',
  copyBBox: '点击画布，将当前可见的整体/组外接框复制到上层。',
  copyBodyBBox: '点击画布，将当前可见的整体/组主体框复制到上层。',
  annularSector: '点击放置扇形；拖拽圆心、内外圆上四点调整。默认内圆 r100、外圆 r300、左下四分之一环。',
  equalSpacing: '设分隔线数后拖拽矩形；沿较长边等分，分隔线横跨较短边。',
  proportionScale: '设分隔线数后拖拽；八向吸附，默认等比例，标注实际格宽。',
  crossMark: '点击放置十字；大小由工具选项设定，与拖拽无关。',
};

function updateToolOptionPanels() {
  const t = drawingState.activeTool;

  el.drawStyleOpts.hidden = !DRAW_SHAPE_TOOLS.has(t);
  el.equalOpts.hidden = t !== 'equalSpacing';
  el.proportionOpts.hidden = t !== 'proportionScale';
  el.crossOpts.hidden = t !== 'crossMark';
  el.strokeOpts.hidden = t !== 'strokeFill';

  const hint = TOOL_HINTS[t];
  if (hint) {
    el.toolOptHint.hidden = false;
    el.toolOptHint.textContent = hint;
  } else {
    el.toolOptHint.hidden = true;
    el.toolOptHint.textContent = '';
  }
}

document.querySelectorAll('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tool = (btn as HTMLElement).dataset.tool as import('./drawing/types').DrawTool;
    drawingState.activeTool = tool;
    syncToolButtons();
  });
});

el.drawColor.addEventListener('input', updateDrawStyleFromUI);
el.drawLw.addEventListener('input', updateDrawStyleFromUI);
el.drawLayer.addEventListener('change', () => {
  drawingState.defaultLayer = el.drawLayer.value as 'under' | 'top';
});
el.eqCount.addEventListener('change', () => {
  drawingState.equalSpacingCount = Math.max(1, Number(el.eqCount.value) || 3);
});
el.propDivCount.addEventListener('change', () => {
  drawingState.proportionDividerCount = Math.max(2, Number(el.propDivCount.value) || 3);
});
el.crossSize.addEventListener('change', () => {
  drawingState.crossMarkSize = Math.max(4, Number(el.crossSize.value) || 40);
});
el.strokeColor.addEventListener('input', () => {
  const c = hexToRgb(el.strokeColor.value);
  drawingState.strokeFillColor = `rgba(${c.r}, ${c.g}, ${c.b}, 0.45)`;
});
el.strokeLayer.addEventListener('change', () => {
  drawingState.strokeFillLayer = el.strokeLayer.value as 'under' | 'top';
});
el.clearDrawings.addEventListener('click', () => {
  clearAnnotations();
  redrawAll();
});

updateDrawStyleFromUI();
updateToolOptionPanels();
setToolOptionsRefresh(updateToolOptionPanels);

refreshPropsPanel = mountPropsPanel(el.annPropsBody, {
  getCanvasWidth: () => canvasSize.w,
  getFileLabel: fileLabelForKey,
  onRedraw: () => redrawCanvasOnly(),
});

attachDrawingInteraction(() => interactionCtx());
setupDrawingKeyboard(() => redrawAll());

