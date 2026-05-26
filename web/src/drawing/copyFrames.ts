import type { Metrics } from '../types';
import type { DrawStyle, FrameCopyAnnotation } from './types';
import { addAnnotation, newAnnId } from './store';

export type MetricsCopySource = {
  overall?: { metrics: Metrics; color: string; show: boolean };
  groups: { metrics: Metrics; color: string; enabled: boolean }[];
};

export function copyFrameAnnotations(
  data: MetricsCopySource,
  kind: FrameCopyAnnotation['kind'],
  rectOf: (m: Metrics) => { x0: number; y0: number; x1: number; y1: number } | undefined,
  style: DrawStyle
) {
  const base = { kind, layer: 'top' as const, style };
  if (data.overall?.show) {
    const rect = rectOf(data.overall.metrics);
    if (rect) {
      addAnnotation({
        ...base,
        id: newAnnId(),
        ...rect,
        color: data.overall.color,
      });
    }
  }
  for (const g of data.groups) {
    if (!g.enabled) continue;
    const rect = rectOf(g.metrics);
    if (rect) {
      addAnnotation({
        ...base,
        id: newAnnId(),
        ...rect,
        color: g.color,
      });
    }
  }
}
