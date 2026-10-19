import type { ReactNode } from 'react';
import type { MeasurementMode, Tool } from '../lib/geometry';

type ToolbarProps = {
  activeTool: Tool;
  onSelectTool: (tool: Tool) => void;
  onClearAll: () => void;
  hasObjects: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // null shows every tool; otherwise only these (plus Drag / Select).
  allowedTools: Tool[] | null;
  measurementMode: MeasurementMode;
};

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: 'move', label: 'Drag / Select', icon: <MoveIcon /> },
  { id: 'point', label: 'Point', icon: <PointIcon /> },
  { id: 'line', label: 'Line', icon: <LineIcon /> },
  { id: 'circle', label: 'Circle', icon: <CircleIcon /> },
  { id: 'rectangle', label: 'Rectangle', icon: <RectIcon /> },
  { id: 'polygon', label: 'Polygon', icon: <PolyIcon /> },
];

export function Toolbar({
  activeTool,
  onSelectTool,
  onClearAll,
  hasObjects,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  allowedTools,
  measurementMode,
}: ToolbarProps) {
  const visibleTools = TOOLS.filter(
    (tool) => tool.id === 'move' || allowedTools === null || allowedTools.includes(tool.id),
  );
  return (
    <header
      className="toolbar"
      onMouseDown={(event) => {
        if (event.target instanceof HTMLButtonElement) {
          event.preventDefault();
        }
      }}
    >
      <div className="history-buttons" aria-label="History">
        <button
          type="button"
          className="tool-button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title={`Undo (${MOD_KEY}Z)`}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="tool-button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
          title={`Redo (${IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z'})`}
        >
          <RedoIcon />
        </button>
      </div>
      <div className="tool-buttons" role="tablist" aria-label="Geometry tools">
        {visibleTools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`tool-button ${tool.id === activeTool ? 'is-active' : ''}`}
            onClick={() => onSelectTool(tool.id)}
            role="tab"
            aria-selected={tool.id === activeTool}
            aria-label={tool.label}
            title={tool.label}
          >
            {tool.icon}
          </button>
        ))}
      </div>
      <div className="toolbar-hint" aria-live="polite">
        {hintFor(activeTool, measurementMode !== 'none')}
      </div>
      <button
        type="button"
        className="tool-button toolbar-eraser"
        onClick={onClearAll}
        disabled={!hasObjects}
        aria-label="Clear all objects"
        title="Clear all objects"
      >
        <EraserIcon />
      </button>
    </header>
  );
}

const TYPED_LENGTH_HINT = ' Type a number for an exact length (5, or 5, 30 for 30°).';

function hintFor(tool: Tool, measuring: boolean): string {
  switch (tool) {
    case 'move':
      return 'Click to select an object, drag to pan, scroll to zoom.';
    case 'point':
      return 'Click on the canvas to place a point.';
    case 'line':
      return `Drag from one endpoint to the other.${measuring ? ' Or click once, then' + TYPED_LENGTH_HINT.toLowerCase() : ''}`;
    case 'circle':
      return 'Drag from the center outward.';
    case 'rectangle':
      return 'Drag from one corner to the opposite corner.';
    case 'polygon':
      return `Click to add vertices. Double-click or Enter to close. Esc to cancel.${measuring ? TYPED_LENGTH_HINT : ''}`;
    default:
      return '';
  }
}

function MoveIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="0.8"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 3L4 16L8 12L10.5 17L12.5 16L10 11L14.5 11Z" />
    </svg>
  );
}

function PointIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="3" fill="currentColor" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="16" x2="16" y2="4" />
      <circle cx="4" cy="16" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="16" cy="4" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="6.5" />
    </svg>
  );
}

function RectIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="5.5" width="13" height="9" />
    </svg>
  );
}

function PolyIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3.5L16.5 8L14 16H6L3.5 8Z" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 5L3 8L6 11" />
      <path d="M3 8H12.5A4.5 4.5 0 0 1 12.5 17H8" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 5L17 8L14 11" />
      <path d="M17 8H7.5A4.5 4.5 0 0 0 7.5 17H12" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3.5 12L11 4.5L16.5 10L11.5 15H7.5Z" />
      <path d="M7 8.5L12.5 14" />
      <path d="M7.5 15H17" />
    </svg>
  );
}
