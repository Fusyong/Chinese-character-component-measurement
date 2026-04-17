export type Rect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type Point = { x: number; y: number };

export type ContourPolyline = {
  closed: boolean;
  points: Point[];
};

export type Metrics = {
  width: number;
  height: number;

  /** Foreground pixel count after merging masks. */
  area: number;

  /** Centroid in pixel coordinates (floating). Undefined if area=0. */
  centroid?: Point;

  /** Axis-aligned bounding box of all foreground pixels. Undefined if area=0. */
  bbox?: Rect;

  /** Body range box: minimal-ish axis-aligned box covering bodyRatio of mass. */
  bodyBBox?: {
    ratio: number;
    method: 'quantile1d' | 'integral2d';
    rect?: Rect;
    /** Verified mass ratio inside rect against the full-res mask. */
    achievedRatio?: number;
  };

  contours?: {
    method: 'marchingSquares';
    simplifyEpsilonPx: number;
    polylines: ContourPolyline[];
  };

  sources: {
    files: Array<{
      name: string;
      lastModified: number;
      size: number;
    }>;
    binarize: {
      mode: 'alpha' | 'lumaThreshold';
      threshold?: number;
      invert?: boolean;
    };
    mergedBy: 'or';
  };
};

export type Group = {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
};

export type GroupResult = {
  group: Group;
  metrics: Metrics;
};

export type ExportPayload = {
  version: 1;
  createdAt: string;
  sharedSettings: {
    threshold: number;
    invert: boolean;
    bodyRatio: number;
    bodyMethod: 'quantile1d' | 'integral2d';
    contourEps: number;
  };
  overall: Metrics;
  groups: GroupResult[];
};

