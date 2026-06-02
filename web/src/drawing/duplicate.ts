import { newAnnId, drawingState } from './store';
import type { Annotation } from './types';

/** 复制指定图示（同位置），返回新 id 与拖拽基准快照 */
export function duplicateAnnotationsForDrag(ids: ReadonlySet<string>, primarySourceId: string) {
  if (ids.size === 0) return null;

  const newIds = new Set<string>();
  const bases = new Map<string, Annotation>();
  const idMap = new Map<string, string>();

  for (const id of ids) {
    const src = drawingState.annotations.find((a) => a.id === id);
    if (!src) continue;
    const nid = newAnnId();
    const ann = { ...structuredClone(src), id: nid };
    drawingState.annotations.push(ann);
    newIds.add(nid);
    idMap.set(id, nid);
    bases.set(nid, structuredClone(ann));
  }

  if (newIds.size === 0) return null;

  const primaryId = idMap.get(primarySourceId) ?? [...newIds][0]!;
  return { newIds, bases, primaryId };
}
