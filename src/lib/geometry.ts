import { evaluate, parse } from 'mathjs/number';

// `locked` objects are givens: they can be selected and measured but not
// moved, reshaped, relabeled, or deleted.
type ObjectBase = { id: string; label?: string; locked?: boolean };

export type GeomObject =
  | (ObjectBase & { type: 'point'; x: number; y: number })
  | (ObjectBase & { type: 'circle'; cx: number; cy: number; r: number })
  | (ObjectBase & { type: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (ObjectBase & { type: 'rectangle'; x: number; y: number; w: number; h: number; rotation?: number })
  | (ObjectBase & { type: 'polygon'; points: [number, number][]; rotation?: number })
  | (ObjectBase & { type: 'function'; expression: string });

export type Tool = 'move' | 'point' | 'line' | 'circle' | 'rectangle' | 'polygon';

// Tools a config's `tools` list can enable. 'move' is always available.
export const DRAWING_TOOLS: readonly Tool[] = ['point', 'line', 'circle', 'rectangle', 'polygon'];

export type MeasurementMode = 'all' | 'selected' | 'none';

export type GeometryState = {
  objects: GeomObject[];
  sidebarOpen?: boolean;
  viewCenter?: [number, number];
  viewZoom?: number;
  tools?: Tool[];
  showMeasurements?: MeasurementMode;
};

export type ParseResult =
  | { ok: true; object: GeomObject }
  | { ok: false; error: string };

export const DEFAULT_RANGE = {
  xMin: -10,
  xMax: 10,
  yMin: -10,
  yMax: 10,
};

export function polygonCentroid(points: [number, number][]): [number, number] {
  if (points.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  return [sx / points.length, sy / points.length];
}

export function polygonWorldPoints(
  polygon: Extract<GeomObject, { type: 'polygon' }>,
): [number, number][] {
  const angle = polygon.rotation ?? 0;
  if (angle === 0 || polygon.points.length === 0) return polygon.points;
  const [cx, cy] = polygonCentroid(polygon.points);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return polygon.points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
}

export function rectangleCorners(rect: Extract<GeomObject, { type: 'rectangle' }>): [number, number][] {
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

export function translateObject(object: GeomObject, dx: number, dy: number): GeomObject {
  switch (object.type) {
    case 'point':
      return { ...object, x: object.x + dx, y: object.y + dy };
    case 'line':
      return {
        ...object,
        x1: object.x1 + dx,
        y1: object.y1 + dy,
        x2: object.x2 + dx,
        y2: object.y2 + dy,
      };
    case 'rectangle':
      return { ...object, x: object.x + dx, y: object.y + dy };
    case 'circle':
      return { ...object, cx: object.cx + dx, cy: object.cy + dy };
    case 'polygon':
      return {
        ...object,
        points: object.points.map(([x, y]) => [x + dx, y + dy] as [number, number]),
      };
    default:
      return object;
  }
}

export function createObjectId(prefix = 'obj'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const text = Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  // Tiny negatives such as -1e-16 from rotation math would otherwise show as "-0".
  return text === '-0' ? '0' : text;
}

export function objectIcon(object: GeomObject): string {
  switch (object.type) {
    case 'point':
      return '•';
    case 'circle':
      return '○';
    case 'line':
      return '／';
    case 'rectangle':
      return '▭';
    case 'polygon':
      return '⬠';
    case 'function':
      return 'ƒ';
    default:
      return '?';
  }
}

export function polygonNameByVertexCount(count: number): string {
  switch (count) {
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
      return `Polygon (${count} points)`;
  }
}

export function objectLabel(object: GeomObject): string {
  if (object.label?.trim()) {
    return object.label;
  }

  switch (object.type) {
    case 'point':
      return `Point (${formatNumber(object.x)}, ${formatNumber(object.y)})`;
    case 'circle':
      return `Circle (${formatNumber(object.cx)}, ${formatNumber(object.cy)}), r=${formatNumber(object.r)}`;
    case 'line':
      return `Line (${formatNumber(object.x1)}, ${formatNumber(object.y1)}) → (${formatNumber(object.x2)}, ${formatNumber(object.y2)})`;
    case 'rectangle':
      return 'Rectangle';
    case 'polygon':
      return polygonNameByVertexCount(object.points.length);
    case 'function':
      return `y = ${object.expression}`;
    default:
      return 'Object';
  }
}

export function parseFormula(input: string): ParseResult {
  const expression = input.trim();

  if (!expression) {
    return { ok: false, error: 'Enter a formula first.' };
  }

  const functionMatch = expression.match(/^y\s*=\s*(.+)$/i);
  if (functionMatch) {
    const rhs = functionMatch[1].trim();
    if (!rhs) {
      return { ok: false, error: 'Function formula needs a right-hand expression.' };
    }

    try {
      parse(rhs);
      return {
        ok: true,
        object: {
          id: createObjectId('fn'),
          type: 'function',
          expression: rhs,
          label: `y = ${rhs}`,
        },
      };
    } catch {
      return { ok: false, error: 'Unable to parse the function expression.' };
    }
  }

  const circle = parseCircleFormula(expression);
  if (circle) {
    return {
      ok: true,
      object: {
        id: createObjectId('circle'),
        type: 'circle',
        cx: circle.cx,
        cy: circle.cy,
        r: circle.r,
        label: `(${formatNumber(circle.cx)}, ${formatNumber(circle.cy)}), r=${formatNumber(circle.r)}`,
      },
    };
  }

  return {
    ok: false,
    error: 'Supported formulas: y = <expression> or (x-a)^2 + (y-b)^2 = r^2.',
  };
}

// Parses what a learner types while drawing a segment: a length, optionally
// followed by a comma and a direction in degrees counterclockwise from +x —
// "5", "5, 30", "3*sqrt(2), 45°".
export function parseLengthEntry(input: string): { length: number; angleDeg?: number } | null {
  const parts = input.replace(/°/g, '').split(',');
  if (parts.length > 2 || !parts[0].trim()) return null;
  const length = evaluateNumeric(parts[0]);
  if (length === null || !(length > 0)) return null;
  if (parts.length === 1 || !parts[1].trim()) return { length };
  const angleDeg = evaluateNumeric(parts[1]);
  return angleDeg === null ? null : { length, angleDeg };
}

export function evaluateFunctionExpression(expression: string, x: number): number | null {
  try {
    const value = evaluate(expression, { x });
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function parseCircleFormula(expression: string): { cx: number; cy: number; r: number } | null {
  const compact = expression.replace(/\s+/g, '');
  const patterns = [
    /^\(?x(?<xOffset>[+-][^)]+)?\)?\^2\+\(?y(?<yOffset>[+-][^)]+)?\)?\^2=(?<rhs>.+)$/i,
    /^\(?y(?<yOffset>[+-][^)]+)?\)?\^2\+\(?x(?<xOffset>[+-][^)]+)?\)?\^2=(?<rhs>.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (!match?.groups) {
      continue;
    }

    const cx = offsetToCenter(match.groups.xOffset);
    const cy = offsetToCenter(match.groups.yOffset);
    const radiusSquared = evaluateNumeric(match.groups.rhs);

    if (cx === null || cy === null || radiusSquared === null || radiusSquared <= 0) {
      return null;
    }

    return {
      cx,
      cy,
      r: Math.sqrt(radiusSquared),
    };
  }

  return null;
}

function offsetToCenter(offset?: string): number | null {
  if (!offset) {
    return 0;
  }

  const sign = offset[0];
  const magnitude = evaluateNumeric(offset.slice(1));
  if (magnitude === null) {
    return null;
  }

  return sign === '-' ? magnitude : -magnitude;
}

function evaluateNumeric(expression: string): number | null {
  try {
    const value = evaluate(expression);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
