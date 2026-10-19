import { polygonWorldPoints, rectangleCorners, type GeomObject } from '../../lib/geometry';

export const SNAP_PX = 10;

export function snapDelta(dx: number, dy: number, step: number, scale: number): [number, number] {
  if (!(step > 0)) return [dx, dy];
  const sx = Math.round(dx / step) * step;
  const sy = Math.round(dy / step) * step;
  const offsetPx = Math.hypot(dx - sx, dy - sy) * scale;
  if (offsetPx <= SNAP_PX) return [sx, sy];
  return [dx, dy];
}

export type SnapKind = 'grid' | 'intersection';

export type SnapResult = {
  world: [number, number];
  snapped: boolean;
  kind: SnapKind | null;
};

export function translateAnchorPoints(object: GeomObject): [number, number][] {
  switch (object.type) {
    case 'point':
      return [[object.x, object.y]];
    case 'line':
      return [
        [object.x1, object.y1],
        [object.x2, object.y2],
      ];
    case 'circle':
      return [[object.cx, object.cy]];
    case 'rectangle':
      return rectangleCorners(object);
    case 'polygon':
      return polygonWorldPoints(object);
    default:
      return [];
  }
}

export function findTranslateIntersectionSnap(
  object: GeomObject,
  dx: number,
  dy: number,
  intersections: [number, number][],
  scale: number,
): { dx: number; dy: number; intersection: [number, number] } | null {
  if (intersections.length === 0) return null;
  const anchors = translateAnchorPoints(object);
  let best: {
    dx: number;
    dy: number;
    intersection: [number, number];
    distancePx: number;
  } | null = null;
  for (const [ax, ay] of anchors) {
    const projectedX = ax + dx;
    const projectedY = ay + dy;
    for (const isect of intersections) {
      const distPx = Math.hypot((projectedX - isect[0]) * scale, (projectedY - isect[1]) * scale);
      if (distPx > SNAP_PX) continue;
      if (!best || distPx < best.distancePx) {
        best = {
          dx: isect[0] - ax,
          dy: isect[1] - ay,
          intersection: isect,
          distancePx: distPx,
        };
      }
    }
  }
  return best ? { dx: best.dx, dy: best.dy, intersection: best.intersection } : null;
}

export function snapCursor(
  world: [number, number],
  scale: number,
  step: number,
  intersections: [number, number][],
  vertices: [number, number][] = [],
): SnapResult {
  // Intersection and vertex points beat grid as long as they're not markedly
  // farther. Among meaningful points, the strictly closer one wins.
  let best: { world: [number, number]; distance: number; kind: SnapKind } | null = null;

  if (step > 0) {
    const gx = Math.round(world[0] / step) * step;
    const gy = Math.round(world[1] / step) * step;
    const gridDist = Math.hypot((world[0] - gx) * scale, (world[1] - gy) * scale);
    if (gridDist <= SNAP_PX) {
      best = { world: [gx, gy], distance: gridDist, kind: 'grid' };
    }
  }

  const considerMeaningful = (px: number, py: number) => {
    const dist = Math.hypot((world[0] - px) * scale, (world[1] - py) * scale);
    if (dist > SNAP_PX) return;
    const slack = best?.kind === 'grid' ? 3 : 0;
    if (!best || dist <= best.distance + slack) {
      best = { world: [px, py], distance: dist, kind: 'intersection' };
    }
  };

  for (const [ix, iy] of intersections) considerMeaningful(ix, iy);
  for (const [vx, vy] of vertices) considerMeaningful(vx, vy);

  if (best) return { world: best.world, snapped: true, kind: best.kind };
  return { world, snapped: false, kind: null };
}
