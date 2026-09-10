import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createObjectId,
  evaluateFunctionExpression,
  formatNumber,
  polygonCentroid,
  polygonWorldPoints,
  translateObject,
  type GeomObject,
  type Tool,
} from '../lib/geometry';
import { computeIntersections } from '../lib/intersections';

type CanvasProps = {
  objects: GeomObject[];
  activeTool: Tool;
  onAddObject: (object: GeomObject) => void;
  onUpdateObject: (object: GeomObject) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  initialViewCenter: [number, number] | null;
  initialViewZoom: number | null;
};

type HandleKind =
  | { type: 'point-move' }
  | { type: 'line-end'; index: 0 | 1 }
  | { type: 'rect-corner'; cornerIndex: 0 | 1 | 2 | 3 }
  | { type: 'rect-rotate' }
  | { type: 'circle-radius' }
  | { type: 'polygon-vertex'; index: number }
  | { type: 'polygon-rotate' }
  | { type: 'translate' };

type Handle = {
  kind: HandleKind;
  world: [number, number];
};

type Editing = {
  pointerId: number;
  handle: HandleKind;
  original: GeomObject;
  preview: GeomObject;
  anchorWorld: [number, number];
  startScreenX: number;
  startScreenY: number;
};

type View = {
  centerX: number;
  centerY: number;
  scale: number;
};

type Size = {
  width: number;
  height: number;
};

type Drawing =
  | { kind: 'idle' }
  | { kind: 'line'; start: [number, number]; current: [number, number]; pinned: boolean }
  | { kind: 'circle'; center: [number, number]; current: [number, number] }
  | { kind: 'rectangle'; start: [number, number]; current: [number, number] }
  | { kind: 'polygon'; points: [number, number][]; current: [number, number] };

const MIN_SCALE = 1e-6;
const MAX_SCALE = 1e8;
const INITIAL_SCALE = 60;
const ZOOM_PER_PIXEL = 1.0015;
const MIN_DRAG_PX = 2;
const SNAP_PX = 10;
const POLYGON_CLOSE_PX = 12;
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_PX = 6;

export function Canvas({ objects, activeTool, onAddObject, onUpdateObject, selectedId, onSelect, initialViewCenter, initialViewZoom }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ centerX: 0, centerY: 0, scale: INITIAL_SCALE });
  const initialViewAppliedRef = useRef(false);

  useEffect(() => {
    if (initialViewAppliedRef.current) return;
    if (!initialViewCenter && initialViewZoom === null) return;
    initialViewAppliedRef.current = true;
    setView((current) => ({
      centerX: initialViewCenter ? initialViewCenter[0] : current.centerX,
      centerY: initialViewCenter ? initialViewCenter[1] : current.centerY,
      scale: initialViewZoom ?? current.scale,
    }));
  }, [initialViewCenter, initialViewZoom]);
  const [drawing, setDrawing] = useState<Drawing>({ kind: 'idle' });
  const [snapHint, setSnapHint] = useState<{ world: [number, number]; kind: SnapKind } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [selectedIntersection, setSelectedIntersection] = useState<[number, number] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const lastClickRef = useRef<{ time: number; screenX: number; screenY: number } | null>(null);
  const [hoverClickable, setHoverClickable] = useState(false);
  const [labelEditing, setLabelEditing] = useState<{
    objectId: string;
    worldX: number;
    worldY: number;
    draft: string;
  } | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!labelEditing) return;
    const t = setTimeout(() => labelInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [labelEditing?.objectId]);

  function commitLabel() {
    if (!labelEditing) return;
    const { objectId, draft } = labelEditing;
    setLabelEditing(null);
    const trimmed = draft.trim();
    if (!trimmed) return;
    const target = objects.find((o) => o.id === objectId);
    if (!target) return;
    onUpdateObject({ ...target, label: trimmed });
  }

  const effectiveTool: Tool = spaceHeld ? 'move' : activeTool;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const worldToScreen = useCallback(
    (wx: number, wy: number): [number, number] => [
      size.width / 2 + (wx - view.centerX) * view.scale,
      size.height / 2 - (wy - view.centerY) * view.scale,
    ],
    [size.width, size.height, view],
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number): [number, number] => [
      (sx - size.width / 2) / view.scale + view.centerX,
      -(sy - size.height / 2) / view.scale + view.centerY,
    ],
    [size.width, size.height, view],
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;

      setView((current) => {
        const factor = Math.pow(ZOOM_PER_PIXEL, -event.deltaY);
        const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
        if (nextScale === current.scale) return current;
        const dx = sx - rect.width / 2;
        const dy = sy - rect.height / 2;
        return {
          scale: nextScale,
          centerX: current.centerX + dx / current.scale - dx / nextScale,
          centerY: current.centerY - dy / current.scale + dy / nextScale,
        };
      });
    },
    [],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Reset any in-progress drawing whenever the active tool changes (including
  // the temporary spacebar-induced switch to Move).
  useEffect(() => {
    setDrawing({ kind: 'idle' });
    setSnapHint(null);
  }, [effectiveTool]);

  // Hold spacebar to temporarily pan, regardless of the selected tool.
  useEffect(() => {
    function handleSpaceDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.repeat) return;
      if (isInteractiveTarget(event.target)) return;
      event.preventDefault();
      setSpaceHeld(true);
    }
    function handleSpaceUp(event: KeyboardEvent) {
      if (event.code !== 'Space') return;
      setSpaceHeld(false);
    }
    function handleBlur() {
      setSpaceHeld(false);
    }
    window.addEventListener('keydown', handleSpaceDown);
    window.addEventListener('keyup', handleSpaceUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleSpaceDown);
      window.removeEventListener('keyup', handleSpaceUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Keyboard shortcuts while drawing.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && drawing.kind !== 'idle') {
        event.preventDefault();
        setDrawing({ kind: 'idle' });
        return;
      }
      if (event.key === 'Enter' && drawing.kind === 'polygon' && drawing.points.length >= 3) {
        event.preventDefault();
        onAddObject(makePolygon(drawing.points));
        setDrawing({ kind: 'idle' });
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [drawing, onAddObject]);

  function eventWorldPos(event: { clientX: number; clientY: number }): [number, number] {
    const el = containerRef.current!;
    const rect = el.getBoundingClientRect();
    const raw = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (effectiveTool === 'move') return raw;
    return snapCursor(raw, view.scale, grid.step, snapTargetIntersections, snapTargetVertices).world;
  }

  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.canvas-hud')) return;

    // Middle button always pans, regardless of tool.
    if (event.button === 1) {
      event.preventDefault();
      startPan(event);
      return;
    }

    if (event.button !== 0) return;

    // Handle drag for resize: only in Drag/Select mode and only when an object
    // is selected — a click on one of its handles starts the edit.
    if (effectiveTool === 'move' && selectedObject && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const raw = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const handleHit = pickHandle(getHandles(selectedObject, view.scale), raw, view.scale);
      if (handleHit) {
        containerRef.current.setPointerCapture(event.pointerId);
        setEditing({
          pointerId: event.pointerId,
          handle: handleHit.kind,
          original: selectedObject,
          preview: selectedObject,
          anchorWorld: raw,
          startScreenX: event.clientX,
          startScreenY: event.clientY,
        });
        return;
      }
    }

    // Translate drag: clicking on the body of any (translatable) object grabs it.
    if (effectiveTool === 'move' && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const raw = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const objectHit = pickObject(objects, raw, view.scale, size);
      if (objectHit && objectHit.type !== 'function') {
        if (objectHit.id !== selectedId) onSelect(objectHit.id);
        setSelectedIntersection(null);
        containerRef.current.setPointerCapture(event.pointerId);
        setEditing({
          pointerId: event.pointerId,
          handle: { type: 'translate' },
          original: objectHit,
          preview: objectHit,
          anchorWorld: raw,
          startScreenX: event.clientX,
          startScreenY: event.clientY,
        });
        return;
      }
    }

    if (effectiveTool === 'move') {
      startPan(event);
      return;
    }

    const world = eventWorldPos(event);
    const el = containerRef.current!;

    switch (effectiveTool) {
      case 'point': {
        labelInputRef.current?.blur();
        const id = createObjectId('point');
        onAddObject({
          id,
          type: 'point',
          x: world[0],
          y: world[1],
        });
        setLabelEditing({ objectId: id, worldX: world[0], worldY: world[1], draft: '' });
        return;
      }
      case 'line': {
        // Second click of a click-then-click line: commit if the second point
        // is meaningfully separated from the first; otherwise stay pinned and
        // wait for another click.
        if (drawing.kind === 'line' && drawing.pinned) {
          const [sx, sy] = drawing.start;
          if (worldDragPixels([sx, sy], world, view.scale) >= MIN_DRAG_PX) {
            onAddObject({
              id: createObjectId('line'),
              type: 'line',
              x1: sx,
              y1: sy,
              x2: world[0],
              y2: world[1],
            });
            setDrawing({ kind: 'idle' });
          }
          return;
        }
        el.setPointerCapture(event.pointerId);
        setDrawing({ kind: 'line', start: world, current: world, pinned: false });
        return;
      }
      case 'circle':
        el.setPointerCapture(event.pointerId);
        setDrawing({ kind: 'circle', center: world, current: world });
        return;
      case 'rectangle':
        el.setPointerCapture(event.pointerId);
        setDrawing({ kind: 'rectangle', start: world, current: world });
        return;
      case 'polygon': {
        const inProgress = drawing.kind === 'polygon' ? drawing : null;
        // 1. Auto-close: click near the starting vertex with at least 3 placed.
        if (inProgress && inProgress.points.length >= 3) {
          const [fx, fy] = inProgress.points[0];
          if (Math.hypot(world[0] - fx, world[1] - fy) * view.scale <= POLYGON_CLOSE_PX) {
            onAddObject(makePolygon(inProgress.points));
            setDrawing({ kind: 'idle' });
            lastClickRef.current = null;
            return;
          }
        }
        // 2. Double-click fallback: two rapid clicks near the same screen point.
        if (inProgress && inProgress.points.length >= 3) {
          const last = lastClickRef.current;
          if (
            last &&
            event.timeStamp - last.time <= DOUBLE_CLICK_MS &&
            Math.hypot(event.clientX - last.screenX, event.clientY - last.screenY) <= DOUBLE_CLICK_PX
          ) {
            onAddObject(makePolygon(inProgress.points));
            setDrawing({ kind: 'idle' });
            lastClickRef.current = null;
            return;
          }
        }
        // 3. Normal append.
        if (inProgress) {
          setDrawing({
            kind: 'polygon',
            points: [...inProgress.points, world],
            current: world,
          });
        } else {
          setDrawing({ kind: 'polygon', points: [world], current: world });
        }
        lastClickRef.current = { time: event.timeStamp, screenX: event.clientX, screenY: event.clientY };
        return;
      }
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (editing && editing.pointerId === event.pointerId) {
      const el = containerRef.current;
      if (!el) return;
      const movedPx = Math.hypot(event.clientX - editing.startScreenX, event.clientY - editing.startScreenY);
      if (editing.handle.type === 'translate' && movedPx < 4) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const raw = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      let next: GeomObject;
      if (editing.handle.type === 'translate') {
        const dx = raw[0] - editing.anchorWorld[0];
        const dy = raw[1] - editing.anchorWorld[1];
        const isectSnap = findTranslateIntersectionSnap(
          editing.original,
          dx,
          dy,
          snapTargetIntersections,
          view.scale,
        );
        if (isectSnap) {
          next = translateObject(editing.original, isectSnap.dx, isectSnap.dy);
          setSnapHint({ world: isectSnap.intersection, kind: 'intersection' });
        } else {
          const [snapDx, snapDy] = snapDelta(dx, dy, grid.step, view.scale);
          next = translateObject(editing.original, snapDx, snapDy);
          setSnapHint(null);
        }
      } else if (editing.handle.type === 'rect-rotate') {
        // Rotation snaps the angle to 15° increments when close, not the cursor position.
        const rotated = applyHandleDrag(editing.original, editing.handle, raw, editing.anchorWorld);
        next = snapRectRotation(rotated);
        setSnapHint(null);
      } else if (editing.handle.type === 'polygon-rotate') {
        // Polygon rotation snaps the rotation delta internally; pass the raw cursor.
        next = applyHandleDrag(editing.original, editing.handle, raw, editing.anchorWorld);
        setSnapHint(null);
      } else {
        const snap = snapCursor(raw, view.scale, grid.step, snapTargetIntersections, snapTargetVertices);
        next = applyHandleDrag(editing.original, editing.handle, snap.world, editing.anchorWorld);
        setSnapHint(snap.snapped && snap.kind ? { world: snap.world, kind: snap.kind } : null);
      }
      setEditing((current) => (current ? { ...current, preview: next } : current));
      return;
    }

    const drag = dragStateRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      setView((current) => ({
        ...current,
        centerX: current.centerX - dx / current.scale,
        centerY: current.centerY + dy / current.scale,
      }));
      return;
    }

    updateSnapHint(event);
    updateHoverClickable(event);

    if (drawing.kind === 'idle') return;

    const world = eventWorldPos(event);
    setDrawing((current) => {
      switch (current.kind) {
        case 'line':
          return { ...current, current: world };
        case 'circle':
          return { ...current, current: world };
        case 'rectangle':
          return { ...current, current: world };
        case 'polygon':
          return { ...current, current: world };
        default:
          return current;
      }
    });
  }

  function updateSnapHint(event: { clientX: number; clientY: number }) {
    if (effectiveTool === 'move') {
      setSnapHint((current) => (current === null ? current : null));
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const raw = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    const snap = snapCursor(raw, view.scale, grid.step, snapTargetIntersections, snapTargetVertices);
    if (!snap.snapped || !snap.kind) {
      setSnapHint((current) => (current === null ? current : null));
      return;
    }
    setSnapHint((current) => {
      if (
        current &&
        current.kind === snap.kind &&
        current.world[0] === snap.world[0] &&
        current.world[1] === snap.world[1]
      ) {
        return current;
      }
      return { world: snap.world, kind: snap.kind! };
    });
  }

  function handlePointerLeave() {
    setSnapHint(null);
    setHoverClickable(false);
  }

  function updateHoverClickable(event: { clientX: number; clientY: number }) {
    if (effectiveTool !== 'move' || dragStateRef.current || editing) {
      if (hoverClickable) setHoverClickable(false);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const raw = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (selectedObject) {
      const handleHit = pickHandle(getHandles(selectedObject, view.scale), raw, view.scale);
      if (handleHit) {
        if (hoverClickable) setHoverClickable(false);
        return;
      }
    }
    const onIntersection = pickIntersection(intersections, raw, view.scale);
    const onObject = pickObject(objects, raw, view.scale, size);
    const next = !!(onIntersection || onObject);
    if (next !== hoverClickable) setHoverClickable(next);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const el = containerRef.current;
    if (editing && editing.pointerId === event.pointerId) {
      el?.releasePointerCapture(event.pointerId);
      const { original, preview, anchorWorld, handle, startScreenX, startScreenY } = editing;
      const movedPx = Math.hypot(event.clientX - startScreenX, event.clientY - startScreenY);
      setEditing(null);
      setSnapHint(null);
      if (geometryChanged(original, preview)) {
        onUpdateObject(preview);
        return;
      }
      // No-movement click on an object body — let intersection points take priority
      // so clicking an intersection that sits on a shape still shows its coords.
      if (handle.type === 'translate' && movedPx < 4) {
        const intersectionHit = pickIntersection(intersections, anchorWorld, view.scale);
        if (intersectionHit) {
          setSelectedIntersection(intersectionHit);
          onSelect(null);
        }
      }
      return;
    }
    const drag = dragStateRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      el?.releasePointerCapture(event.pointerId);
      dragStateRef.current = null;
      const moved = Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY);
      if (moved < 4 && effectiveTool === 'move' && el) {
        const rect = el.getBoundingClientRect();
        const sx = drag.startX - rect.left;
        const sy = drag.startY - rect.top;
        const world = screenToWorld(sx, sy);
        const intersectionHit = pickIntersection(intersections, world, view.scale);
        if (intersectionHit) {
          setSelectedIntersection(intersectionHit);
          onSelect(null);
        } else {
          setSelectedIntersection(null);
          const hit = pickObject(objects, world, view.scale, size);
          onSelect(hit ? hit.id : null);
        }
      }
      return;
    }

    if (drawing.kind === 'idle') return;

    el?.releasePointerCapture(event.pointerId);
    const world = eventWorldPos(event);

    if (drawing.kind === 'line') {
      const [sx, sy] = drawing.start;
      if (worldDragPixels([sx, sy], world, view.scale) >= MIN_DRAG_PX) {
        // Released after a real drag — commit the line.
        onAddObject({
          id: createObjectId('line'),
          type: 'line',
          x1: sx,
          y1: sy,
          x2: world[0],
          y2: world[1],
        });
        setDrawing({ kind: 'idle' });
      } else {
        // Released without a real drag — first click of click-then-click mode.
        // Keep the anchor and wait for the second click.
        setDrawing({ kind: 'line', start: drawing.start, current: world, pinned: true });
      }
      return;
    }
    if (drawing.kind === 'circle') {
      const [cx, cy] = drawing.center;
      const r = Math.hypot(world[0] - cx, world[1] - cy);
      if (r * view.scale >= MIN_DRAG_PX) {
        onAddObject({
          id: createObjectId('circle'),
          type: 'circle',
          cx,
          cy,
          r,
        });
      }
      setDrawing({ kind: 'idle' });
      return;
    }
    if (drawing.kind === 'rectangle') {
      const [sx, sy] = drawing.start;
      const w = world[0] - sx;
      const h = world[1] - sy;
      if (Math.abs(w) * view.scale >= MIN_DRAG_PX && Math.abs(h) * view.scale >= MIN_DRAG_PX) {
        onAddObject({
          id: createObjectId('rect'),
          type: 'rectangle',
          x: sx,
          y: sy,
          w,
          h,
        });
      }
      setDrawing({ kind: 'idle' });
      return;
    }
    // Polygon: pointerup is a no-op; commit happens via double-click or Enter.
  }

  function resetView() {
    const [cx, cy] = initialViewCenter ?? [0, 0];
    setView({ centerX: cx, centerY: cy, scale: initialViewZoom ?? INITIAL_SCALE });
  }

  function zoomBy(factor: number) {
    setView((current) => {
      const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      if (nextScale === current.scale) return current;
      return { ...current, scale: nextScale };
    });
  }

  const grid = useMemo(() => buildGrid(view, size), [view, size]);
  const selectedObject = useMemo(
    () => (selectedId ? objects.find((object) => object.id === selectedId) ?? null : null),
    [objects, selectedId],
  );
  const previewObjects = useMemo(() => {
    if (!editing) return objects;
    return objects.map((object) => (object.id === editing.preview.id ? editing.preview : object));
  }, [objects, editing]);
  const viewXRange = useMemo(() => {
    if (size.width === 0) return undefined;
    const half = size.width / 2 / view.scale;
    return { xMin: view.centerX - half, xMax: view.centerX + half };
  }, [size.width, view.centerX, view.scale]);
  const intersections = useMemo(
    () => computeIntersections(previewObjects, viewXRange),
    [previewObjects, viewXRange],
  );
  // Snap candidates exclude the object being edited so its own moving
  // intersections don't dominate the cursor's snap target. Recomputes only
  // when the edit identity (or committed objects) change, not on every drag.
  const editingId = editing?.original.id ?? null;
  const snapTargetIntersections = useMemo(() => {
    if (editingId === null) return intersections;
    return computeIntersections(
      objects.filter((object) => object.id !== editingId),
      viewXRange,
    );
  }, [intersections, objects, editingId, viewXRange]);
  // Collect snap-able vertices from every object except the one being edited:
  // rect corners (rotated), polygon vertices (rotated), line endpoints, circle
  // centers, point positions. Function curves contribute nothing.
  const snapTargetVertices = useMemo(() => {
    const out: [number, number][] = [];
    for (const object of objects) {
      if (editingId !== null && object.id === editingId) continue;
      out.push(...translateAnchorPoints(object));
    }
    return out;
  }, [objects, editingId]);
  const handles = useMemo(() => {
    if (!selectedObject) return [] as Handle[];
    if (editing) return getHandles(editing.preview, view.scale);
    return getHandles(selectedObject, view.scale);
  }, [selectedObject, editing, view.scale]);

  useEffect(() => {
    if (!selectedIntersection) return;
    const [sx, sy] = selectedIntersection;
    const stillExists = intersections.some(([x, y]) => Math.abs(x - sx) < 1e-6 && Math.abs(y - sy) < 1e-6);
    if (!stillExists) setSelectedIntersection(null);
  }, [intersections, selectedIntersection]);
  const zoomLabel = formatScale(view.scale);
  const surfaceClass = [
    'canvas-surface',
    `tool-${effectiveTool}`,
    drawing.kind !== 'idle' ? 'is-drawing' : '',
    editing?.handle.type === 'translate' ? 'is-translating' : '',
    hoverClickable && !editing && !dragStateRef.current ? 'hover-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={containerRef}
      className={surfaceClass}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {size.width > 0 && size.height > 0 && (
        <svg
          className="canvas-svg"
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          <g className="grid-minor">
            {grid.minorVertical.map((line) => (
              <line key={`mv-${line.value}`} x1={line.screen} y1={0} x2={line.screen} y2={size.height} />
            ))}
            {grid.minorHorizontal.map((line) => (
              <line key={`mh-${line.value}`} x1={0} y1={line.screen} x2={size.width} y2={line.screen} />
            ))}
          </g>
          <g className="grid-major">
            {grid.majorVertical.map((line) => (
              <line key={`Mv-${line.value}`} x1={line.screen} y1={0} x2={line.screen} y2={size.height} />
            ))}
            {grid.majorHorizontal.map((line) => (
              <line key={`Mh-${line.value}`} x1={0} y1={line.screen} x2={size.width} y2={line.screen} />
            ))}
          </g>
          <g className="axes">
            {grid.axisX !== null && (
              <line x1={0} y1={grid.axisX} x2={size.width} y2={grid.axisX} />
            )}
            {grid.axisY !== null && (
              <line x1={grid.axisY} y1={0} x2={grid.axisY} y2={size.height} />
            )}
          </g>
          <g className="grid-labels">
            {grid.majorVertical.map((line) =>
              line.value === 0 ? null : (
                <text
                  key={`lvx-${line.value}`}
                  x={line.screen + 4}
                  y={(grid.axisX ?? 16) - 4}
                  className="grid-label"
                >
                  {formatGridValue(line.value, grid.step)}
                </text>
              ),
            )}
            {grid.majorHorizontal.map((line) =>
              line.value === 0 ? null : (
                <text
                  key={`lhy-${line.value}`}
                  x={(grid.axisY ?? 4) + 4}
                  y={line.screen - 4}
                  className="grid-label"
                >
                  {formatGridValue(line.value, grid.step)}
                </text>
              ),
            )}
            {grid.axisX !== null && grid.axisY !== null && (
              <text x={grid.axisY + 4} y={grid.axisX - 4} className="grid-label origin-label">
                0
              </text>
            )}
          </g>
          <g className="objects-layer">
            {previewObjects.map((object) => (
              <GeometryObject
                key={object.id}
                object={object}
                view={view}
                size={size}
                worldToScreen={worldToScreen}
                isSelected={object.id === selectedId}
                onEditLabel={(target) => {
                  if (target.type !== 'point') return;
                  setLabelEditing({
                    objectId: target.id,
                    worldX: target.x,
                    worldY: target.y,
                    draft: target.label ?? '',
                  });
                }}
              />
            ))}
          </g>
          {handles.length > 0 && (
            <g className="handles-layer">
              {handles.map((handle, index) => {
                const [hx, hy] = worldToScreen(handle.world[0], handle.world[1]);
                if (handle.kind.type === 'rect-rotate' || handle.kind.type === 'polygon-rotate') {
                  return (
                    <circle
                      key={`handle-${index}`}
                      cx={hx}
                      cy={hy}
                      r={5}
                      className="rotate-handle"
                    />
                  );
                }
                return (
                  <rect
                    key={`handle-${index}`}
                    x={hx - 4.5}
                    y={hy - 4.5}
                    width={9}
                    height={9}
                    className="edit-handle"
                  />
                );
              })}
            </g>
          )}
          <g className="intersections-layer">
            {intersections.map(([wx, wy], index) => {
              const [sx, sy] = worldToScreen(wx, wy);
              const isSelected =
                !!selectedIntersection &&
                Math.abs(selectedIntersection[0] - wx) < 1e-6 &&
                Math.abs(selectedIntersection[1] - wy) < 1e-6;
              return (
                <g key={`isect-${index}`}>
                  <circle cx={sx} cy={sy} r={isSelected ? 8 : 6} className="intersection-halo" />
                  <circle cx={sx} cy={sy} r={isSelected ? 4 : 3} className="intersection-dot" />
                  {isSelected && (
                    <text x={sx + 10} y={sy - 10} className="intersection-label">
                      ({formatNumber(wx)}, {formatNumber(wy)})
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          <DrawingPreview drawing={drawing} worldToScreen={worldToScreen} view={view} />
          {snapHint && (
            <SnapIndicator world={snapHint.world} kind={snapHint.kind} worldToScreen={worldToScreen} />
          )}
        </svg>
      )}
      {labelEditing && (() => {
        const [lx, ly] = worldToScreen(labelEditing.worldX, labelEditing.worldY);
        return (
          <div
            className="point-label-editor"
            style={{ left: lx + 10, top: ly - 28 }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <input
              ref={labelInputRef}
              value={labelEditing.draft}
              onChange={(event) =>
                setLabelEditing((current) =>
                  current ? { ...current, draft: event.target.value } : current,
                )
              }
              onBlur={commitLabel}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setLabelEditing(null);
                }
              }}
              placeholder="label"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        );
      })()}
      <div
        className="canvas-hud"
        onMouseDown={(event) => {
          if (event.target instanceof HTMLButtonElement) {
            event.preventDefault();
          }
        }}
      >
        <button
          type="button"
          className="hud-button hud-icon"
          onClick={() => zoomBy(1 / 1.5)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="zoom-value" aria-live="polite">{zoomLabel}</span>
        <button
          type="button"
          className="hud-button hud-icon"
          onClick={() => zoomBy(1.5)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <span className="hud-divider" aria-hidden="true" />
        <button type="button" className="hud-button" onClick={resetView} title="Reset view">
          Reset view
        </button>
      </div>
    </div>
  );
}

type DrawingPreviewProps = {
  drawing: Drawing;
  worldToScreen: (x: number, y: number) => [number, number];
  view: View;
};

function DrawingPreview({ drawing, worldToScreen, view }: DrawingPreviewProps) {
  if (drawing.kind === 'idle') return null;

  if (drawing.kind === 'line') {
    const [x1, y1] = worldToScreen(drawing.start[0], drawing.start[1]);
    const [x2, y2] = worldToScreen(drawing.current[0], drawing.current[1]);
    return (
      <g className="drawing-preview">
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="preview-stroke" />
        <circle cx={x1} cy={y1} r={3} className="preview-anchor" />
        <circle cx={x2} cy={y2} r={3} className="preview-anchor" />
      </g>
    );
  }

  if (drawing.kind === 'circle') {
    const [cx, cy] = worldToScreen(drawing.center[0], drawing.center[1]);
    const r = Math.hypot(drawing.current[0] - drawing.center[0], drawing.current[1] - drawing.center[1]) * view.scale;
    const [px, py] = worldToScreen(drawing.current[0], drawing.current[1]);
    return (
      <g className="drawing-preview">
        <circle cx={cx} cy={cy} r={r} className="preview-stroke" />
        <line x1={cx} y1={cy} x2={px} y2={py} className="preview-helper" />
        <circle cx={cx} cy={cy} r={3} className="preview-anchor" />
      </g>
    );
  }

  if (drawing.kind === 'rectangle') {
    const [sx, sy] = worldToScreen(drawing.start[0], drawing.start[1]);
    const [ex, ey] = worldToScreen(drawing.current[0], drawing.current[1]);
    const x = Math.min(sx, ex);
    const y = Math.min(sy, ey);
    const w = Math.abs(ex - sx);
    const h = Math.abs(ey - sy);
    return (
      <g className="drawing-preview">
        <rect x={x} y={y} width={w} height={h} className="preview-stroke" />
        <circle cx={sx} cy={sy} r={3} className="preview-anchor" />
        <circle cx={ex} cy={ey} r={3} className="preview-anchor" />
      </g>
    );
  }

  if (drawing.kind === 'polygon') {
    const placedScreen = drawing.points.map(([x, y]) => worldToScreen(x, y));
    const [cx, cy] = worldToScreen(drawing.current[0], drawing.current[1]);
    const linePoints = [...placedScreen.map(([x, y]) => `${x},${y}`), `${cx},${cy}`].join(' ');
    let closeHint: { x: number; y: number } | null = null;
    if (drawing.points.length >= 3) {
      const first = drawing.points[0];
      const distPx = Math.hypot(drawing.current[0] - first[0], drawing.current[1] - first[1]) * view.scale;
      if (distPx <= POLYGON_CLOSE_PX) {
        const [fx, fy] = placedScreen[0];
        closeHint = { x: fx, y: fy };
      }
    }
    return (
      <g className="drawing-preview">
        {placedScreen.length >= 1 && (
          <polyline points={linePoints} className="preview-stroke" />
        )}
        {placedScreen.map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r={3} className="preview-anchor" />
        ))}
        <circle cx={cx} cy={cy} r={2.5} className="preview-cursor" />
        {closeHint && <circle cx={closeHint.x} cy={closeHint.y} r={9} className="preview-close-target" />}
      </g>
    );
  }

  return null;
}

type GeometryObjectProps = {
  object: GeomObject;
  view: View;
  size: Size;
  worldToScreen: (x: number, y: number) => [number, number];
  isSelected: boolean;
  onEditLabel?: (object: GeomObject) => void;
};

function GeometryObject({ object, view, size, worldToScreen, isSelected, onEditLabel }: GeometryObjectProps) {
  const fillClass = `shape-fill${isSelected ? ' is-selected' : ''}`;
  const strokeClass = `shape-stroke${isSelected ? ' is-selected' : ''}`;
  switch (object.type) {
    case 'point': {
      const [sx, sy] = worldToScreen(object.x, object.y);
      return (
        <g>
          <circle cx={sx} cy={sy} r={isSelected ? 5 : 4} className={`point-marker${isSelected ? ' is-selected' : ''}`} />
          <ObjectLabel
            screenX={sx}
            screenY={sy}
            label={object.label}
            onDoubleClick={onEditLabel ? () => onEditLabel(object) : undefined}
          />
        </g>
      );
    }
    case 'circle': {
      const [sx, sy] = worldToScreen(object.cx, object.cy);
      return (
        <g>
          <circle cx={sx} cy={sy} r={object.r * view.scale} className={strokeClass} />
          <ObjectLabel screenX={sx} screenY={sy} label={object.label} />
        </g>
      );
    }
    case 'line': {
      const [x1, y1] = worldToScreen(object.x1, object.y1);
      const [x2, y2] = worldToScreen(object.x2, object.y2);
      return (
        <g>
          <line x1={x1} y1={y1} x2={x2} y2={y2} className={strokeClass} />
          <ObjectLabel screenX={(x1 + x2) / 2} screenY={(y1 + y2) / 2} label={object.label} />
        </g>
      );
    }
    case 'rectangle': {
      const corners = rectangleCorners(object);
      const screenCorners = corners.map(([wx, wy]) => worldToScreen(wx, wy));
      const cx = object.x + object.w / 2;
      const cy = object.y + object.h / 2;
      const [labelX, labelY] = worldToScreen(cx, cy);
      return (
        <g>
          <polygon
            points={screenCorners.map(([x, y]) => `${x},${y}`).join(' ')}
            className={strokeClass}
          />
          <ObjectLabel screenX={labelX} screenY={labelY} label={object.label} />
        </g>
      );
    }
    case 'polygon': {
      const points = polygonWorldPoints(object).map(([x, y]) => worldToScreen(x, y));
      const [first] = points;
      return (
        <g>
          <polygon
            points={points.map(([x, y]) => `${x},${y}`).join(' ')}
            className={`${strokeClass} polygon-fill`}
          />
          {first && <ObjectLabel screenX={first[0]} screenY={first[1]} label={object.label} />}
        </g>
      );
    }
    case 'function': {
      const labelPosition = object.label?.trim()
        ? functionLabelPosition(object.expression, view, size, worldToScreen)
        : null;
      return (
        <g>
          <path
            d={functionPath(object.expression, view, size, worldToScreen)}
            className={`function-path${isSelected ? ' is-selected' : ''}`}
          />
          {labelPosition && (
            <ObjectLabel
              screenX={labelPosition[0]}
              screenY={labelPosition[1]}
              label={object.label}
            />
          )}
        </g>
      );
    }
    default:
      return null;
  }
}

function ObjectLabel({
  screenX,
  screenY,
  label,
  onDoubleClick,
}: {
  screenX: number;
  screenY: number;
  label?: string;
  onDoubleClick?: () => void;
}) {
  if (!label?.trim()) return null;
  return (
    <text
      x={screenX + 10}
      y={screenY - 10}
      className={`object-label${onDoubleClick ? ' is-editable' : ''}`}
      onDoubleClick={onDoubleClick ? (event) => { event.stopPropagation(); onDoubleClick(); } : undefined}
      onPointerDown={onDoubleClick ? (event) => event.stopPropagation() : undefined}
    >
      {label}
    </text>
  );
}

function functionPath(
  expression: string,
  view: View,
  size: Size,
  worldToScreen: (x: number, y: number) => [number, number],
): string {
  const samples = Math.max(160, Math.min(1200, Math.floor(size.width)));
  const wxMin = view.centerX - size.width / 2 / view.scale;
  const wxMax = view.centerX + size.width / 2 / view.scale;
  const step = (wxMax - wxMin) / samples;
  let path = '';
  let penDown = false;
  let lastY: number | null = null;
  const yLimit = size.height * 8;

  for (let index = 0; index <= samples; index += 1) {
    const x = wxMin + step * index;
    const y = evaluateFunctionExpression(expression, x);

    if (y === null || !Number.isFinite(y)) {
      penDown = false;
      lastY = null;
      continue;
    }

    const [sx, sy] = worldToScreen(x, y);
    if (Math.abs(sy) > yLimit) {
      penDown = false;
      lastY = null;
      continue;
    }

    if (lastY !== null && Math.abs(sy - lastY) > size.height) {
      penDown = false;
    }
    path += `${penDown ? 'L' : 'M'} ${sx} ${sy} `;
    penDown = true;
    lastY = sy;
  }

  return path.trim();
}

function functionLabelPosition(
  expression: string,
  view: View,
  size: Size,
  worldToScreen: (x: number, y: number) => [number, number],
): [number, number] | null {
  if (size.width <= 0 || size.height <= 0) return null;

  const horizontalPadding = Math.min(120, size.width * 0.15);
  const verticalPadding = Math.min(32, size.height * 0.1);
  const left = horizontalPadding;
  const right = size.width - horizontalPadding;
  const preferredScreenX = Math.min(right, Math.max(left, size.width / 2 + 48));
  const samplesPerSide = 40;

  // Prefer a point just right of center so labels stay clear of the axes and
  // HUD, then search outward in alternating directions for a visible point.
  for (let index = 0; index <= samplesPerSide * 2; index += 1) {
    const step = Math.ceil(index / 2);
    const direction = index % 2 === 1 ? 1 : -1;
    const fraction = step / samplesPerSide;
    const screenX = direction === 1
      ? preferredScreenX + (right - preferredScreenX) * fraction
      : preferredScreenX - (preferredScreenX - left) * fraction;
    const worldX = view.centerX + (screenX - size.width / 2) / view.scale;
    const worldY = evaluateFunctionExpression(expression, worldX);
    if (worldY === null || !Number.isFinite(worldY)) continue;

    const [sx, sy] = worldToScreen(worldX, worldY);
    if (sy >= verticalPadding && sy <= size.height - verticalPadding) {
      return [sx, sy];
    }
  }

  return null;
}

type GridLine = { value: number; screen: number };

type Grid = {
  step: number;
  majorVertical: GridLine[];
  majorHorizontal: GridLine[];
  minorVertical: GridLine[];
  minorHorizontal: GridLine[];
  axisX: number | null;
  axisY: number | null;
};

function buildGrid(view: View, size: Size): Grid {
  if (size.width === 0 || size.height === 0) {
    return {
      step: 1,
      majorVertical: [],
      majorHorizontal: [],
      minorVertical: [],
      minorHorizontal: [],
      axisX: null,
      axisY: null,
    };
  }

  const targetPx = 90;
  const targetUnits = targetPx / view.scale;
  const exp = Math.floor(Math.log10(targetUnits));
  const base = Math.pow(10, exp);
  const remainder = targetUnits / base;
  let major: number;
  if (remainder < 1.5) major = base;
  else if (remainder < 3.5) major = 2 * base;
  else if (remainder < 7.5) major = 5 * base;
  else major = 10 * base;

  const minor = major / 5;

  const wxMin = view.centerX - size.width / 2 / view.scale;
  const wxMax = view.centerX + size.width / 2 / view.scale;
  const wyMin = view.centerY - size.height / 2 / view.scale;
  const wyMax = view.centerY + size.height / 2 / view.scale;

  const majorVertical = collectLines(wxMin, wxMax, major, (wx) => screenX(wx, view, size));
  const majorHorizontal = collectLines(wyMin, wyMax, major, (wy) => screenY(wy, view, size));
  const minorVertical = collectLines(wxMin, wxMax, minor, (wx) => screenX(wx, view, size)).filter(
    (line) => Math.abs(line.value / major - Math.round(line.value / major)) > 1e-6,
  );
  const minorHorizontal = collectLines(wyMin, wyMax, minor, (wy) => screenY(wy, view, size)).filter(
    (line) => Math.abs(line.value / major - Math.round(line.value / major)) > 1e-6,
  );

  const axisXScreen = screenY(0, view, size);
  const axisYScreen = screenX(0, view, size);

  return {
    step: major,
    majorVertical,
    majorHorizontal,
    minorVertical,
    minorHorizontal,
    axisX: axisXScreen >= 0 && axisXScreen <= size.height ? axisXScreen : null,
    axisY: axisYScreen >= 0 && axisYScreen <= size.width ? axisYScreen : null,
  };
}

function collectLines(min: number, max: number, step: number, project: (value: number) => number): GridLine[] {
  const lines: GridLine[] = [];
  const start = Math.ceil(min / step) * step;
  const maxLines = 400;
  let count = 0;
  for (let value = start; value <= max && count < maxLines; value += step, count += 1) {
    const snapped = Math.round(value / step) * step;
    lines.push({ value: snapped, screen: project(snapped) });
  }
  return lines;
}

function screenX(wx: number, view: View, size: Size): number {
  return size.width / 2 + (wx - view.centerX) * view.scale;
}

function screenY(wy: number, view: View, size: Size): number {
  return size.height / 2 - (wy - view.centerY) * view.scale;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatGridValue(value: number, step: number): string {
  if (step >= 1) return formatNumber(Math.round(value));
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
  const rounded = Number(value.toFixed(decimals));
  return formatNumber(rounded);
}

function formatScale(scale: number): string {
  if (scale >= 1) return `${scale >= 100 ? scale.toFixed(0) : scale.toFixed(1)}×`;
  return `1/${(1 / scale).toFixed(scale > 0.01 ? 1 : 0)}×`;
}

function worldDragPixels(a: [number, number], b: [number, number], scale: number): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * scale;
}

const PICK_TOLERANCE_PX = 8;
const INTERSECTION_PICK_PX = 10;

function pickIntersection(
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

function pickObject(
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

function hitDistancePx(object: GeomObject, world: [number, number], scale: number, size: Size): number {
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

function distanceToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

const HANDLE_PICK_PX = 11;

function getHandles(object: GeomObject, viewScale = 1): Handle[] {
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

function makePolygon(points: [number, number][]): GeomObject {
  const label = defaultPolygonLabel(points.length);
  const polygon: GeomObject = { id: createObjectId('poly'), type: 'polygon', points };
  if (label) polygon.label = label;
  return polygon;
}

function defaultPolygonLabel(vertexCount: number): string | undefined {
  switch (vertexCount) {
    case 3:
      return 'Triangle';
    case 4:
      return 'Quadrilateral';
    case 5:
      return 'Pentagon';
    case 6:
      return 'Hexagon';
    case 7:
      return 'Heptagon';
    case 8:
      return 'Octagon';
    default:
      return undefined;
  }
}

function rectangleCorners(rect: Extract<GeomObject, { type: 'rectangle' }>): [number, number][] {
  const angle = rect.rotation ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const local: [number, number][] = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
  return local.map(([px, py]) => {
    const dx = px - cx;
    const dy = py - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
}

function pickHandle(handles: Handle[], world: [number, number], scale: number): Handle | null {
  let best: { handle: Handle; distance: number } | null = null;
  for (const handle of handles) {
    const distance = Math.hypot(handle.world[0] - world[0], handle.world[1] - world[1]) * scale;
    if (distance <= HANDLE_PICK_PX && (!best || distance < best.distance)) {
      best = { handle, distance };
    }
  }
  return best?.handle ?? null;
}

function applyHandleDrag(
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

function geometryChanged(a: GeomObject, b: GeomObject): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}


function snapDelta(dx: number, dy: number, step: number, scale: number): [number, number] {
  if (!(step > 0)) return [dx, dy];
  const sx = Math.round(dx / step) * step;
  const sy = Math.round(dy / step) * step;
  const offsetPx = Math.hypot(dx - sx, dy - sy) * scale;
  if (offsetPx <= SNAP_PX) return [sx, sy];
  return [dx, dy];
}

const ROTATION_SNAP_RAD = Math.PI / 12; // 15°
const ROTATION_SNAP_TOL_RAD = Math.PI / 60; // within 3° of a snap target

function snapRectRotation(rect: GeomObject): GeomObject {
  if (rect.type !== 'rectangle' || rect.rotation === undefined) return rect;
  const snapped = Math.round(rect.rotation / ROTATION_SNAP_RAD) * ROTATION_SNAP_RAD;
  if (Math.abs(rect.rotation - snapped) <= ROTATION_SNAP_TOL_RAD) {
    return { ...rect, rotation: snapped };
  }
  return rect;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
  return target.isContentEditable;
}

type SnapKind = 'grid' | 'intersection';

type SnapResult = {
  world: [number, number];
  snapped: boolean;
  kind: SnapKind | null;
};

function translateAnchorPoints(object: GeomObject): [number, number][] {
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

function findTranslateIntersectionSnap(
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

function snapCursor(
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

type SnapIndicatorProps = {
  world: [number, number];
  kind: SnapKind;
  worldToScreen: (x: number, y: number) => [number, number];
};

function SnapIndicator({ world, kind, worldToScreen }: SnapIndicatorProps) {
  const [sx, sy] = worldToScreen(world[0], world[1]);
  return (
    <g className={`snap-indicator is-${kind}`}>
      <circle cx={sx} cy={sy} r={kind === 'intersection' ? 7 : 6} className="snap-ring" />
      <circle cx={sx} cy={sy} r={1.5} className="snap-dot" />
    </g>
  );
}
