import {
  polygonCentroid,
  polygonWorldPoints,
  rectangleCorners,
  type GeomObject,
} from '../../lib/geometry';
import type { Handle, HandleKind } from './types';

export const HANDLE_PICK_PX = 11;

export function getHandles(object: GeomObject, viewScale = 1): Handle[] {
  switch (object.type) {
    case 'point':
      // Points have no resize handles — translate via body drag instead.
      return [];
    case 'line':
      return [
        { kind: { type: 'line-end', index: 0 }, world: [object.x1, object.y1] },
        { kind: { type: 'line-end', index: 1 }, world: [object.x2, object.y2] },
      ];
    case 'rectangle': {
      const corners = rectangleCorners(object);
      const handles: Handle[] = corners.map((world, index) => ({
        kind: { type: 'rect-corner', cornerIndex: index as 0 | 1 | 2 | 3 },
        world,
      }));
      const angle = object.rotation ?? 0;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const cx = object.x + object.w / 2;
      const cy = object.y + object.h / 2;
      const offset = 12 / Math.max(viewScale, 1e-6);
      // Place the rotation handle just outside the rectangle's math bottom-right
      // (which renders as screen bottom-right when h > 0) — adjacent to the corner
      // resize square with a small gap.
      const lx = object.x + object.w + offset;
      const ly = object.y - offset;
      const dx = lx - cx;
      const dy = ly - cy;
      handles.push({
        kind: { type: 'rect-rotate' },
        world: [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos],
      });
      return handles;
    }
    case 'circle':
      return [{ kind: { type: 'circle-radius' }, world: [object.cx + object.r, object.cy] }];
    case 'polygon': {
      const worldPoints = polygonWorldPoints(object);
      const vertexHandles: Handle[] = worldPoints.map((point, index) => ({
        kind: { type: 'polygon-vertex', index },
        world: point,
      }));
      if (worldPoints.length === 0) return vertexHandles;
      // The centroid of the local points equals the centroid of the rotated
      // world points (rotation around centroid leaves it fixed).
      const centroid = polygonCentroid(worldPoints);
      let farthestIdx = 0;
      let farthestDist = -1;
      for (let i = 0; i < worldPoints.length; i += 1) {
        const [x, y] = worldPoints[i];
        const d = Math.hypot(x - centroid[0], y - centroid[1]);
        if (d > farthestDist) {
          farthestDist = d;
          farthestIdx = i;
        }
      }
      const ref = worldPoints[farthestIdx];
      const dx = ref[0] - centroid[0];
      const dy = ref[1] - centroid[1];
      const len = Math.hypot(dx, dy);
      const offset = 14 / Math.max(viewScale, 1e-6);
      const handleWorld: [number, number] =
        len > 1e-9
          ? [ref[0] + (dx / len) * offset, ref[1] + (dy / len) * offset]
          : [centroid[0] + offset, centroid[1]];
      vertexHandles.push({
        kind: { type: 'polygon-rotate' },
        world: handleWorld,
      });
      return vertexHandles;
    }
    default:
      return [];
  }
}

export function pickHandle(handles: Handle[], world: [number, number], scale: number): Handle | null {
  let best: { handle: Handle; distance: number } | null = null;
  for (const handle of handles) {
    const distance = Math.hypot(handle.world[0] - world[0], handle.world[1] - world[1]) * scale;
    if (distance <= HANDLE_PICK_PX && (!best || distance < best.distance)) {
      best = { handle, distance };
    }
  }
  return best?.handle ?? null;
}

export function applyHandleDrag(
  original: GeomObject,
  handle: HandleKind,
  cursor: [number, number],
  anchor?: [number, number],
): GeomObject {
  switch (handle.type) {
    case 'point-move':
      if (original.type !== 'point') return original;
      return { ...original, x: cursor[0], y: cursor[1] };
    case 'line-end': {
      if (original.type !== 'line') return original;
      if (handle.index === 0) return { ...original, x1: cursor[0], y1: cursor[1] };
      return { ...original, x2: cursor[0], y2: cursor[1] };
    }
    case 'rect-corner': {
      if (original.type !== 'rectangle') return original;
      const angle = original.rotation ?? 0;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const oldCx = original.x + original.w / 2;
      const oldCy = original.y + original.h / 2;
      // World position of the opposite corner — stays fixed during the drag.
      const localCorners: [number, number][] = [
        [original.x, original.y],
        [original.x + original.w, original.y],
        [original.x + original.w, original.y + original.h],
        [original.x, original.y + original.h],
      ];
      const oppLocal = localCorners[(handle.cornerIndex + 2) % 4];
      const oppWorld: [number, number] = [
        oldCx + (oppLocal[0] - oldCx) * cos - (oppLocal[1] - oldCy) * sin,
        oldCy + (oppLocal[0] - oldCx) * sin + (oppLocal[1] - oldCy) * cos,
      ];
      // Cursor in the rect's un-rotated local frame, relative to oppWorld.
      const vx = cursor[0] - oppWorld[0];
      const vy = cursor[1] - oppWorld[1];
      const localVx = vx * cos + vy * sin;
      const localVy = -vx * sin + vy * cos;
      const newW = Math.abs(localVx);
      const newH = Math.abs(localVy);
      if (!(newW > 0) || !(newH > 0)) return original;
      // The opposite corner's local offset from the new center has signs opposite to
      // the dragged corner's direction in local space.
      const sx = localVx >= 0 ? 1 : -1;
      const sy = localVy >= 0 ? 1 : -1;
      const oppLocalOffsetX = (-sx * newW) / 2;
      const oppLocalOffsetY = (-sy * newH) / 2;
      const oppWorldOffsetX = oppLocalOffsetX * cos - oppLocalOffsetY * sin;
      const oppWorldOffsetY = oppLocalOffsetX * sin + oppLocalOffsetY * cos;
      const newCx = oppWorld[0] - oppWorldOffsetX;
      const newCy = oppWorld[1] - oppWorldOffsetY;
      return {
        ...original,
        x: newCx - newW / 2,
        y: newCy - newH / 2,
        w: newW,
        h: newH,
      };
    }
    case 'rect-rotate': {
      if (original.type !== 'rectangle' || !anchor) return original;
      const cx = original.x + original.w / 2;
      const cy = original.y + original.h / 2;
      const startAngle = Math.atan2(anchor[1] - cy, anchor[0] - cx);
      const nowAngle = Math.atan2(cursor[1] - cy, cursor[0] - cx);
      return { ...original, rotation: (original.rotation ?? 0) + (nowAngle - startAngle) };
    }
    case 'circle-radius': {
      if (original.type !== 'circle') return original;
      const r = Math.hypot(cursor[0] - original.cx, cursor[1] - original.cy);
      if (!(r > 0)) return original;
      return { ...original, r };
    }
    case 'polygon-vertex': {
      if (original.type !== 'polygon') return original;
      // Rebase: bake current rotation into points, drop rotation, then set the
      // dragged vertex to the cursor's world position.
      const worldPts = polygonWorldPoints(original);
      const points: [number, number][] = worldPts.map((point, index) =>
        index === handle.index ? cursor : point,
      );
      const next: Extract<GeomObject, { type: 'polygon' }> = { ...original, points };
      if (next.rotation !== undefined) delete (next as { rotation?: number }).rotation;
      return next;
    }
    case 'polygon-rotate': {
      if (original.type !== 'polygon' || !anchor || original.points.length === 0) return original;
      const center = polygonCentroid(original.points);
      const startAngle = Math.atan2(anchor[1] - center[1], anchor[0] - center[0]);
      const nowAngle = Math.atan2(cursor[1] - center[1], cursor[0] - center[0]);
      let delta = nowAngle - startAngle;
      // Snap rotation delta to 15° increments when within 3°.
      const snapStep = Math.PI / 12;
      const snapTol = Math.PI / 60;
      const snapped = Math.round(delta / snapStep) * snapStep;
      if (Math.abs(delta - snapped) <= snapTol) delta = snapped;
      const next = (original.rotation ?? 0) + delta;
      return { ...original, rotation: next };
    }
    default:
      return original;
  }
}

export const ROTATION_SNAP_RAD = Math.PI / 12; // 15°
export const ROTATION_SNAP_TOL_RAD = Math.PI / 60; // within 3° of a snap target

export function snapRectRotation(rect: GeomObject): GeomObject {
  if (rect.type !== 'rectangle' || rect.rotation === undefined) return rect;
  const snapped = Math.round(rect.rotation / ROTATION_SNAP_RAD) * ROTATION_SNAP_RAD;
  if (Math.abs(rect.rotation - snapped) <= ROTATION_SNAP_TOL_RAD) {
    return { ...rect, rotation: snapped };
  }
  return rect;
}
