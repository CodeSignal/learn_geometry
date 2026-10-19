import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from './components/Canvas';
import { Sidebar } from './components/Sidebar';
import { TaskPanelMount } from './components/TaskPanelMount';
import { Toolbar } from './components/Toolbar';
import { fetchConfig, postState } from './lib/api';
import { translateObject, type GeomObject, type MeasurementMode, type Tool } from './lib/geometry';

const NUDGE_BY_ARROW: Record<string, [number, number]> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
};

export default function App() {
  const [objects, setObjects] = useState<GeomObject[]>([]);
  const [past, setPast] = useState<GeomObject[][]>([]);
  const [future, setFuture] = useState<GeomObject[][]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>('move');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [initialSidebarOpen, setInitialSidebarOpen] = useState<boolean | null>(null);
  const [initialViewCenter, setInitialViewCenter] = useState<[number, number] | null>(null);
  const [initialViewZoom, setInitialViewZoom] = useState<number | null>(null);
  const [allowedTools, setAllowedTools] = useState<Tool[] | null>(null);
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('none');

  useEffect(() => {
    let active = true;

    fetchConfig()
      .then((state) => {
        if (active) {
          setObjects(state.objects);
          setInitialSidebarOpen(state.sidebarOpen === true);
          setInitialViewCenter(state.viewCenter ?? null);
          setInitialViewZoom(state.viewZoom ?? null);
          setAllowedTools(state.tools ?? null);
          setMeasurementMode(state.showMeasurements ?? 'none');
          setStatus(null);
        }
      })
      .catch((error) => {
        if (active) {
          setStatus(error instanceof Error ? error.message : 'Unable to load config.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  // Mirrors `objects` synchronously so multiple commits in the same handler
  // compose instead of overwriting each other via stale closures.
  const objectsRef = useRef(objects);
  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  const sync = useCallback((next: GeomObject[]) => {
    objectsRef.current = next;
    setObjects(next);
    postState(next)
      .then(() => setStatus(null))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Unable to sync state.');
      });
  }, []);

  const commit = useCallback(
    (next: GeomObject[]) => {
      setPast((p) => [...p, objectsRef.current]);
      setFuture([]);
      sync(next);
    },
    [sync],
  );

  function addObject(object: GeomObject) {
    commit([...objectsRef.current, object]);
  }

  function deleteObject(id: string) {
    if (objectsRef.current.some((object) => object.id === id && object.locked)) return;
    if (selectedId === id) setSelectedId(null);
    commit(objectsRef.current.filter((object) => object.id !== id));
  }

  function updateObject(updated: GeomObject) {
    commit(objectsRef.current.map((object) => (object.id === updated.id ? updated : object)));
  }

  // Clearing keeps locked objects: they're the lesson's givens.
  function clearAll() {
    const kept = objects.filter((object) => object.locked);
    if (kept.length === objects.length) return;
    if (!kept.some((object) => object.id === selectedId)) setSelectedId(null);
    commit(kept);
  }

  useEffect(() => {
    if (selectedId && !objects.some((object) => object.id === selectedId)) {
      setSelectedId(null);
    }
  }, [objects, selectedId]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([objects, ...future]);
    sync(previous);
  }, [past, future, objects, sync]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, objects]);
    sync(next);
  }, [past, future, objects, sync]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        if (objects.some((object) => object.id === selectedId && object.locked)) return;
        const id = selectedId;
        setSelectedId(null);
        commit(objects.filter((object) => object.id !== id));
        return;
      }
      const arrowDelta = NUDGE_BY_ARROW[event.key];
      if (arrowDelta && selectedId) {
        const selected = objects.find((object) => object.id === selectedId);
        if (selected && selected.type !== 'function' && !selected.locked) {
          event.preventDefault();
          const multiplier = event.shiftKey ? 5 : 1;
          const [dx, dy] = arrowDelta;
          const updated = translateObject(selected, dx * multiplier, dy * multiplier);
          commit(objects.map((object) => (object.id === selectedId ? updated : object)));
          return;
        }
      }
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [undo, redo, selectedId, objects, commit]);

  return (
    <div className="app-shell">
      <Sidebar
        objects={objects}
        onAddObject={addObject}
        onUpdateObject={updateObject}
        onDeleteObject={deleteObject}
        initialOpen={initialSidebarOpen}
        selectedId={selectedId}
        onSelect={setSelectedId}
        measurementMode={measurementMode}
      />
      <div className="main-area">
        <Toolbar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          onClearAll={clearAll}
          hasObjects={objects.some((object) => !object.locked)}
          allowedTools={allowedTools}
          measurementMode={measurementMode}
          onUndo={undo}
          onRedo={redo}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
        />
        <Canvas
          objects={objects}
          activeTool={activeTool}
          onAddObject={addObject}
          onUpdateObject={updateObject}
          selectedId={selectedId}
          onSelect={setSelectedId}
          initialViewCenter={initialViewCenter}
          initialViewZoom={initialViewZoom}
          measurementMode={measurementMode}
        />
      </div>
      {(loading || status) && (
        <div className={`status-pill ${status ? 'is-error' : ''}`}>
          {loading ? 'Loading…' : status}
        </div>
      )}
      <TaskPanelMount />
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}
