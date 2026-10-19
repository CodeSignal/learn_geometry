import { polygonWorldPoints, rectangleCorners, type GeomObject } from './geometry';

// Everything down to sharedEndpointAngles is mirrored in ../../intersections.js
// for the server's text output; tests/parity.test.ts keeps the two in step.
// The formatting and line-editing helpers below it are frontend-only.

export type Vec = [number, number];

export type JointAngle = {
  vertex: Vec;
  lineIds: [string, string];
  // The far endpoint of each line, so callers can draw the angle's arms.
  ends: [Vec, Vec];
  degrees: number;
};

const JOINT_EPS = 1e-6;

export function segmentLength(a: Vec, b: Vec): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// Direction of a → b in degrees, counterclockwise from +x, in [0, 360).
export function directionDeg(a: Vec, b: Vec): number {
  const degrees = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

// The angle at `vertex` between the rays toward `a` and `b`, in [0, 180].
export function angleBetweenDeg(vertex: Vec, a: Vec, b: Vec): number {
  const ux = a[0] - vertex[0];
  const uy = a[1] - vertex[1];
  const vx = b[0] - vertex[0];
  const vy = b[1] - vertex[1];
  if ((ux === 0 && uy === 0) || (vx === 0 && vy === 0)) return NaN;
  return (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * 180) / Math.PI;
}

// World-space vertices of shapes that have sides, in drawing order.
export function objectVertices(object: GeomObject): Vec[] | null {
  if (object.type === 'rectangle') return rectangleCorners(object);
  if (object.type === 'polygon') return polygonWorldPoints(object);
  return null;
}

// Side i runs from vertex i to vertex i + 1 (wrapping).
export function sideLengths(vertices: Vec[]): number[] {
  return vertices.map((vertex, index) => segmentLength(vertex, vertices[(index + 1) % vertices.length]));
}

// Positive for counterclockwise vertex order.
export function signedArea(vertices: Vec[]): number {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % vertices.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

// Interior angle at each vertex in degrees, in (0, 360) so reflex angles of
// concave polygons come out above 180. NaN where a side has zero length.
export function interiorAngles(vertices: Vec[]): number[] {
  const n = vertices.length;
  if (n < 3) return vertices.map(() => NaN);
  const counterclockwise = signedArea(vertices) >= 0;
  return vertices.map((vertex, index) => {
    const prev = vertices[(index - 1 + n) % n];
    const next = vertices[(index + 1) % n];
    const toPrev = Math.atan2(prev[1] - vertex[1], prev[0] - vertex[0]);
    const toNext = Math.atan2(next[1] - vertex[1], next[0] - vertex[0]);
    if (segmentLength(vertex, prev) === 0 || segmentLength(vertex, next) === 0) return NaN;
    // Counterclockwise polygons have their interior swept from the next side
    // round to the previous one; clockwise polygons the other way.
    let sweep = counterclockwise ? toPrev - toNext : toNext - toPrev;
    sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return (sweep * 180) / Math.PI;
  });
}

// Angles formed where two line segments share an endpoint.
export function sharedEndpointAngles(objects: GeomObject[]): JointAngle[] {
  const lines = objects.filter(
    (object): object is Extract<GeomObject, { type: 'line' }> =>
      object.type === 'line' && (object.x1 !== object.x2 || object.y1 !== object.y2),
  );
  const out: JointAngle[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i];
      const b = lines[j];
      const aEnds: [Vec, Vec] = [[a.x1, a.y1], [a.x2, a.y2]];
      const bEnds: [Vec, Vec] = [[b.x1, b.y1], [b.x2, b.y2]];
      for (let ai = 0; ai < 2; ai += 1) {
        for (let bi = 0; bi < 2; bi += 1) {
          const vertex = aEnds[ai];
          const other = bEnds[bi];
          if (Math.abs(vertex[0] - other[0]) > JOINT_EPS || Math.abs(vertex[1] - other[1]) > JOINT_EPS) continue;
          const aFar = aEnds[1 - ai];
          const bFar = bEnds[1 - bi];
          // Two copies of the same segment aren't an angle.
          if (Math.abs(aFar[0] - bFar[0]) <= JOINT_EPS && Math.abs(aFar[1] - bFar[1]) <= JOINT_EPS) continue;
          out.push({
            vertex,
            lineIds: [a.id, b.id],
            ends: [aFar, bFar],
            degrees: angleBetweenDeg(vertex, aFar, bFar),
          });
        }
      }
    }
  }
  return out;
}

// Display rounding for the canvas and sidebar. The server's text output keeps
// three decimals for graders.
export function formatLength(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return String(Number(value.toFixed(2)));
}

export function formatAngle(degrees: number): string {
  if (!Number.isFinite(degrees)) return '—';
  return `${Number(degrees.toFixed(1))}°`;
}

// Drops floating-point noise such as 2.9999999999999996 from computed
// coordinates so exact lengths and grid positions stay exact.
export function cleanCoordinate(value: number): number {
  return Number(value.toFixed(10));
}

// Frontend-only helpers for the sidebar's length / angle fields (not mirrored
// on the server). The line keeps its first endpoint and moves the second.
export function lineWithLength(
  line: Extract<GeomObject, { type: 'line' }>,
  length: number,
): Extract<GeomObject, { type: 'line' }> {
  const start: Vec = [line.x1, line.y1];
  const current = segmentLength(start, [line.x2, line.y2]);
  const radians = current === 0 ? 0 : Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
  return withSecondEndpoint(line, length, radians);
}

export function lineWithDirection(
  line: Extract<GeomObject, { type: 'line' }>,
  degrees: number,
): Extract<GeomObject, { type: 'line' }> {
  const length = segmentLength([line.x1, line.y1], [line.x2, line.y2]);
  return withSecondEndpoint(line, length, (degrees * Math.PI) / 180);
}

function withSecondEndpoint(
  line: Extract<GeomObject, { type: 'line' }>,
  length: number,
  radians: number,
): Extract<GeomObject, { type: 'line' }> {
  return {
    ...line,
    x2: cleanCoordinate(line.x1 + length * Math.cos(radians)),
    y2: cleanCoordinate(line.y1 + length * Math.sin(radians)),
  };
}
