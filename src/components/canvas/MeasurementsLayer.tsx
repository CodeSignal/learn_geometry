import type { GeomObject, MeasurementMode } from '../../lib/geometry';
import {
  formatAngle,
  formatLength,
  interiorAngles,
  objectVertices,
  segmentLength,
  sharedEndpointAngles,
  sideLengths,
  signedArea,
  type Vec,
} from '../../lib/measurements';

type WorldToScreen = (x: number, y: number) => [number, number];

type MeasurementsLayerProps = {
  objects: GeomObject[];
  selectedId: string | null;
  mode: MeasurementMode;
  scale: number;
  worldToScreen: WorldToScreen;
};

const LABEL_OFFSET_PX = 12;
const MIN_SIDE_PX = 24;
const ARC_RADIUS_PX = 16;
const MIN_ARC_RADIUS_PX = 6;
const RIGHT_ANGLE_PX = 9;
const RIGHT_ANGLE_TOLERANCE_DEG = 0.05;

// Side lengths, interior angles, segment lengths, radii, and the angles where
// two segments meet. Purely visual: the layer ignores pointer events.
export function MeasurementsLayer({ objects, selectedId, mode, scale, worldToScreen }: MeasurementsLayerProps) {
  if (mode === 'none') return null;
  const targets = mode === 'all' ? objects : objects.filter((object) => object.id === selectedId);
  const joints = sharedEndpointAngles(objects).filter(
    (joint) => mode === 'all' || (selectedId !== null && joint.lineIds.includes(selectedId)),
  );
  return (
    <g className="measurements-layer">
      {targets.map((object) => (
        <ObjectMeasurements key={object.id} object={object} scale={scale} worldToScreen={worldToScreen} />
      ))}
      {joints.map((joint) => {
        const [a, b] = joint.ends;
        const start = Math.atan2(a[1] - joint.vertex[1], a[0] - joint.vertex[0]);
        const end = Math.atan2(b[1] - joint.vertex[1], b[0] - joint.vertex[0]);
        const sweep = normalizeSigned(end - start);
        const armPx = Math.min(segmentLength(joint.vertex, a), segmentLength(joint.vertex, b)) * scale;
        return (
          <AngleMarker
            key={`joint-${joint.lineIds.join('-')}-${joint.vertex.join(',')}`}
            vertex={joint.vertex}
            start={start}
            sweep={sweep}
            degrees={joint.degrees}
            maxRadiusPx={armPx * 0.4}
            scale={scale}
            worldToScreen={worldToScreen}
          />
        );
      })}
    </g>
  );
}

type ObjectMeasurementsProps = {
  object: GeomObject;
  scale: number;
  worldToScreen: WorldToScreen;
};

function ObjectMeasurements({ object, scale, worldToScreen }: ObjectMeasurementsProps) {
  if (object.type === 'line') {
    const a: Vec = [object.x1, object.y1];
    const b: Vec = [object.x2, object.y2];
    return <LengthLabel a={a} b={b} outward={null} scale={scale} worldToScreen={worldToScreen} />;
  }

  if (object.type === 'circle') {
    const diagonal = Math.SQRT1_2 * object.r;
    const [cx, cy] = worldToScreen(object.cx, object.cy);
    const [ex, ey] = worldToScreen(object.cx + diagonal, object.cy + diagonal);
    if (object.r * scale < MIN_SIDE_PX) return null;
    return (
      <g>
        <line x1={cx} y1={cy} x2={ex} y2={ey} className="measure-radius" />
        <text
          x={(cx + ex) / 2 + LABEL_OFFSET_PX * Math.SQRT1_2}
          y={(cy + ey) / 2 + LABEL_OFFSET_PX * Math.SQRT1_2}
          className="measure-label"
        >
          r = {formatLength(object.r)}
        </text>
      </g>
    );
  }

  const vertices = objectVertices(object);
  if (!vertices || vertices.length < 3) return null;
  const n = vertices.length;
  const counterclockwise = signedArea(vertices) >= 0;
  const sides = sideLengths(vertices);
  const angles = interiorAngles(vertices);
  return (
    <g>
      {vertices.map((vertex, index) => (
        <LengthLabel
          key={`side-${index}`}
          a={vertex}
          b={vertices[(index + 1) % n]}
          outward={counterclockwise ? 1 : -1}
          scale={scale}
          worldToScreen={worldToScreen}
        />
      ))}
      {vertices.map((vertex, index) => {
        const prev = vertices[(index - 1 + n) % n];
        const next = vertices[(index + 1) % n];
        const toPrev = Math.atan2(prev[1] - vertex[1], prev[0] - vertex[0]);
        const toNext = Math.atan2(next[1] - vertex[1], next[0] - vertex[0]);
        const degrees = angles[index];
        if (!Number.isFinite(degrees)) return null;
        // Same orientation rule as interiorAngles: sweep counterclockwise from
        // the next side for counterclockwise polygons, from the previous side
        // otherwise.
        const shortestSidePx = Math.min(sides[index], sides[(index - 1 + n) % n]) * scale;
        return (
          <AngleMarker
            key={`angle-${index}`}
            vertex={vertex}
            start={counterclockwise ? toNext : toPrev}
            sweep={(degrees * Math.PI) / 180}
            degrees={degrees}
            maxRadiusPx={shortestSidePx * 0.4}
            scale={scale}
            worldToScreen={worldToScreen}
          />
        );
      })}
    </g>
  );
}

type LengthLabelProps = {
  a: Vec;
  b: Vec;
  // 1 or -1 puts the label on the outside of a counterclockwise / clockwise
  // shape; null (a lone segment) puts it below the segment on screen, away
  // from the object's own label, which sits above and to the right.
  outward: 1 | -1 | null;
  scale: number;
  worldToScreen: WorldToScreen;
};

function LengthLabel({ a, b, outward, scale, worldToScreen }: LengthLabelProps) {
  const length = segmentLength(a, b);
  if (length * scale < MIN_SIDE_PX) return null;
  const [ax, ay] = worldToScreen(a[0], a[1]);
  const [bx, by] = worldToScreen(b[0], b[1]);
  const dx = bx - ax;
  const dy = by - ay;
  const screenLength = Math.hypot(dx, dy);
  // Screen-space normal to the right of a → b. Screen y points down, so for a
  // counterclockwise shape (in math coordinates) that's the outside.
  let nx = -dy / screenLength;
  let ny = dx / screenLength;
  if (outward === -1 || (outward === null && ny < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return (
    <text
      x={(ax + bx) / 2 + nx * LABEL_OFFSET_PX}
      y={(ay + by) / 2 + ny * LABEL_OFFSET_PX}
      className="measure-label is-centered"
    >
      {formatLength(length)}
    </text>
  );
}

type AngleMarkerProps = {
  vertex: Vec;
  // World-space angle of the first arm, in radians, and the signed sweep to
  // the second arm (positive = counterclockwise).
  start: number;
  sweep: number;
  degrees: number;
  maxRadiusPx: number;
  scale: number;
  worldToScreen: WorldToScreen;
};

function AngleMarker({ vertex, start, sweep, degrees, maxRadiusPx, scale, worldToScreen }: AngleMarkerProps) {
  const radiusPx = Math.min(ARC_RADIUS_PX, maxRadiusPx);
  if (radiusPx < MIN_ARC_RADIUS_PX) return null;
  const at = (radians: number, px: number): [number, number] =>
    worldToScreen(vertex[0] + (Math.cos(radians) * px) / scale, vertex[1] + (Math.sin(radians) * px) / scale);

  let marker: string;
  if (Math.abs(degrees - 90) <= RIGHT_ANGLE_TOLERANCE_DEG) {
    // Textbook right-angle square instead of an arc.
    const size = Math.min(RIGHT_ANGLE_PX, radiusPx);
    const [x1, y1] = at(start, size);
    const [x3, y3] = at(start + sweep, size);
    const [vx, vy] = worldToScreen(vertex[0], vertex[1]);
    marker = `M ${x1} ${y1} L ${x1 + x3 - vx} ${y1 + y3 - vy} L ${x3} ${y3}`;
  } else {
    const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
    const points: string[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const [x, y] = at(start + (sweep * i) / steps, radiusPx);
      points.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
    }
    marker = points.join(' ');
  }

  const [lx, ly] = at(start + sweep / 2, radiusPx + LABEL_OFFSET_PX + 4);
  return (
    <g>
      <path d={marker} className="measure-arc" />
      <text x={lx} y={ly} className="measure-label is-centered">
        {formatAngle(degrees)}
      </text>
    </g>
  );
}

function normalizeSigned(radians: number): number {
  let value = radians % (2 * Math.PI);
  if (value > Math.PI) value -= 2 * Math.PI;
  if (value <= -Math.PI) value += 2 * Math.PI;
  return value;
}
