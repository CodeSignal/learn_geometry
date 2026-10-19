import {
  evaluateFunctionExpression,
  polygonWorldPoints,
  rectangleCorners,
  type GeomObject,
} from '../../lib/geometry';
import type { Size } from './types';

export const PICK_TOLERANCE_PX = 8;
export const INTERSECTION_PICK_PX = 10;

export function pickIntersection(
  intersections: [number, number][],
  world: [number, number],
  scale: number,
): [number, number] | null {
  let best: { point: [number, number]; distance: number } | null = null;
  for (const point of intersections) {
    const distance = Math.hypot(point[0] - world[0], point[1] - world[1]) * scale;
    if (distance <= INTERSECTION_PICK_PX && (!best || distance < best.distance)) {
      best = { point, distance };
    }
  }
  return best?.point ?? null;
}

export function pickObject(
  objects: GeomObject[],
  world: [number, number],
  scale: number,
  size: Size,
): GeomObject | null {
  let best: { object: GeomObject; distance: number } | null = null;
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    const distance = hitDistancePx(object, world, scale, size);
    if (distance <= PICK_TOLERANCE_PX && (!best || distance < best.distance)) {
      best = { object, distance };
    }
  }
  return best?.object ?? null;
}

export function hitDistancePx(object: GeomObject, world: [number, number], scale: number, size: Size): number {
  const [wx, wy] = world;
  switch (object.type) {
    case 'point':
      return Math.hypot(wx - object.x, wy - object.y) * scale;
    case 'circle':
      return Math.abs(Math.hypot(wx - object.cx, wy - object.cy) - object.r) * scale;
    case 'line':
      return distanceToSegment(world, [object.x1, object.y1], [object.x2, object.y2]) * scale;
    case 'rectangle': {
      const corners = rectangleCorners(object);
      let min = Infinity;
      for (let i = 0; i < 4; i += 1) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const d = distanceToSegment(world, a, b);
        if (d < min) min = d;
      }
      return min * scale;
    }
    case 'polygon': {
      const pts = polygonWorldPoints(object);
      let min = Infinity;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const d = distanceToSegment(world, a, b);
        if (d < min) min = d;
      }
      return min * scale;
    }
    case 'function': {
      const wxMin = wx - (size.width / 2) / scale;
      const wxMax = wx + (size.width / 2) / scale;
      const samples = 80;
      const range = wxMax - wxMin;
      const step = range / samples;
      let min = Infinity;
      let prev: [number, number] | null = null;
      for (let i = 0; i <= samples; i += 1) {
        const sx = wxMin + step * i;
        const sy = evaluateFunctionExpression(object.expression, sx);
        if (sy === null || !Number.isFinite(sy)) {
          prev = null;
          continue;
        }
        const point: [number, number] = [sx, sy];
        if (prev) {
          const d = distanceToSegment(world, prev, point);
          if (d < min) min = d;
        }
        prev = point;
      }
      return min * scale;
    }
    default:
      return Infinity;
  }
}

export function distanceToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}
