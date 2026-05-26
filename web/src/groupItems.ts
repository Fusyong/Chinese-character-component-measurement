import type { StrokeRaster } from './font/extractStrokes';
import { fileKey } from './mask';
import { applyPngContentOffset } from './strokeCanvas';
import type { Group } from './types';

export type GroupItemSource = 'png' | 'font';

export type GroupItem = {
  id: string;
  file: File;
  source: GroupItemSource;
  displayName: string;
  fontChar?: string;
  strokeIndex?: number;
};

export type GroupState = Group & { items: GroupItem[] };

export function newItemId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function groupFiles(g: Pick<GroupState, 'items'>): File[] {
  return g.items.map((i) => i.file);
}

export function itemKey(item: GroupItem): string {
  return fileKey(item.file);
}

export function formatItemNames(items: GroupItem[]): string {
  if (items.length === 0) return '未添加图元';
  if (items.length === 1) return items[0]!.displayName;
  if (items.length <= 3) return items.map((i) => i.displayName).join('、');
  return `${items[0]!.displayName} 等 ${items.length} 个`;
}

/** 800×800 PNG，导入时施加固定平移（右 5%、下 6%）。 */
export async function appendPngFiles(g: GroupState, files: File[]) {
  for (const f of files) {
    const shifted = await applyPngContentOffset(f);
    g.items.push({
      id: newItemId(),
      file: shifted,
      source: 'png',
      displayName: f.name,
    });
  }
}

export function fontItemFromStroke(char: string, stroke: StrokeRaster): GroupItem {
  return {
    id: newItemId(),
    file: stroke.file,
    source: 'font',
    displayName: `${char}·笔画${stroke.index}`,
    fontChar: char,
    strokeIndex: stroke.index,
  };
}

export function toggleFontStroke(g: GroupState, char: string, stroke: StrokeRaster): 'added' | 'removed' {
  const idx = g.items.findIndex(
    (i) => i.source === 'font' && i.fontChar === char && i.strokeIndex === stroke.index
  );
  if (idx >= 0) {
    g.items.splice(idx, 1);
    return 'removed';
  }
  g.items.push(fontItemFromStroke(char, stroke));
  return 'added';
}

export function hasFontStroke(g: GroupState, char: string, strokeIndex: number): boolean {
  return g.items.some(
    (i) => i.source === 'font' && i.fontChar === char && i.strokeIndex === strokeIndex
  );
}

export function removeItem(g: GroupState, itemId: string) {
  g.items = g.items.filter((i) => i.id !== itemId);
}

export function clearGroupItems(g: GroupState) {
  g.items = [];
}

export function exportFileEntries(items: GroupItem[]) {
  return items.map((i) => ({
    name: i.file.name,
    lastModified: i.file.lastModified,
    size: i.file.size,
    source: i.source,
    displayName: i.displayName,
  }));
}
