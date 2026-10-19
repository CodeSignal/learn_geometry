// Server-side geometry math: intersections (mirrors src/lib/intersections.ts)
// and measurements (mirrors src/lib/measurements.ts). The release workflow
// packs a fixed list of files (server.js, intersections.js, dist, ...), so
// server math lives here rather than in new modules; tests/parity.test.ts
// checks it against the frontend copies.
const { evaluate } = require('mathjs');

const EPS = 1e-9;
const DEDUPE_EPS = 1e-6;
const SAMPLE_COUNT = 240;
const ROOT_TOL = 1e-9;
const ROOT_ITERS = 50;

function computeIntersections(objects, viewRange) {
  const out = [];
  for (let i = 0; i < objects.length; i += 1) {
    for (let j = i + 1; j < objects.length; j += 1) {
      collectPair(objects[i], objects[j], out, viewRange);
    }
  }
  return dedupe(out);
}

function collectPair(a, b, out, viewRange) {
  const segsA = linearSegments(a);
  const segsB = linearSegments(b);
  const ca = a.type === 'circle' ? a : null;
  const cb = b.type === 'circle' ? b : null;
  const fa = a.type === 'function' ? a : null;
  const fb = b.type === 'function' ? b : null;

  for (const sa of segsA) {
    for (const sb of segsB) {
      const point = segmentSegment(sa, sb);
      if (point) out.push(point);
    }
  }
  if (ca) for (const sb of segsB) for (const p of segmentCircle(sb, ca)) out.push(p);
  if (cb) for (const sa of segsA) for (const p of segmentCircle(sa, cb)) out.push(p);
  if (ca && cb) for (const p of circleCircle(ca, cb)) out.push(p);
  if (fa && !fb) {
    for (const sb of segsB) for (const p of functionSegment(fa.expression, sb)) out.push(p);
    if (cb) for (const p of functionCircle(fa.expression, cb)) out.push(p);
  }
  if (fb && !fa) {
    for (const sa of segsA) for (const p of functionSegment(fb.expression, sa)) out.push(p);
    if (ca) for (const p of functionCircle(fb.expression, ca)) out.push(p);
  }
  if (fa && fb) {
    const range = viewRange ?? { xMin: -50, xMax: 50 };
    for (const p of functionFunction(fa.expression, fb.expression, range)) out.push(p);
  }
}

function polygonWorldPoints(poly) {
  const angle = poly.rotation ?? 0;
  if (angle === 0 || poly.points.length === 0) return poly.points;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of poly.points) {
    sx += x;
    sy += y;
  }
  const cx = sx / poly.points.length;
  const cy = sy / poly.points.length;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return poly.points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
}

function rectangleCorners(rect) {
  const angle = rect.rotation ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const local = [
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

function linearSegments(obj) {
  switch (obj.type) {
    case 'line':
      return [[[obj.x1, obj.y1], [obj.x2, obj.y2]]];
    case 'rectangle': {
      const corners = rectangleCorners(obj);
      const segs = [];
      for (let i = 0; i < 4; i += 1) {
        segs.push([corners[i], corners[(i + 1) % 4]]);
      }
      return segs;
    }
    case 'polygon': {
      const pts = polygonWorldPoints(obj);
      const segs = [];
      for (let i = 0; i < pts.length; i += 1) {
        segs.push([pts[i], pts[(i + 1) % pts.length]]);
      }
      return segs;
    }
    default:
      return [];
  }
}

function segmentSegment(s1, s2) {
  const [[x1, y1], [x2, y2]] = s1;
  const [[x3, y3], [x4, y4]] = s2;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < EPS) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

function segmentCircle(seg, c) {
  const [[x1, y1], [x2, y2]] = seg;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - c.cx;
  const fy = y1 - c.cy;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A < EPS) return [];
  const sq = Math.sqrt(disc);
  const t1 = (-B - sq) / (2 * A);
  const t2 = (-B + sq) / (2 * A);
  const out = [];
  if (t1 >= -EPS && t1 <= 1 + EPS) out.push([x1 + t1 * dx, y1 + t1 * dy]);
  if (Math.abs(t1 - t2) > EPS && t2 >= -EPS && t2 <= 1 + EPS) {
    out.push([x1 + t2 * dx, y1 + t2 * dy]);
  }
  return out;
}

function circleCircle(c1, c2) {
  const dx = c2.cx - c1.cx;
  const dy = c2.cy - c1.cy;
  const d = Math.hypot(dx, dy);
  if (d < EPS) return [];
  if (d > c1.r + c2.r + EPS) return [];
  if (d < Math.abs(c1.r - c2.r) - EPS) return [];
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
  const px = c1.cx + (a * dx) / d;
  const py = c1.cy + (a * dy) / d;
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;
  const out = [[px + rx, py + ry]];
  if (h > EPS) out.push([px - rx, py - ry]);
  return out;
}

function functionSegment(expression, seg) {
  const [[ax, ay], [bx, by]] = seg;
  if (Math.abs(ax - bx) < EPS) {
    const y = evalAt(expression, ax);
    if (y === null) return [];
    const yLow = Math.min(ay, by) - EPS;
    const yHigh = Math.max(ay, by) + EPS;
    return y >= yLow && y <= yHigh ? [[ax, y]] : [];
  }
  const xLow = Math.min(ax, bx);
  const xHigh = Math.max(ax, bx);
  const lineY = (x) => ay + ((by - ay) * (x - ax)) / (bx - ax);
  return findRoots(expression, xLow, xHigh, (x, y) => y - lineY(x));
}

function functionCircle(expression, c) {
  return findRoots(
    expression,
    c.cx - c.r,
    c.cx + c.r,
    (x, y) => (x - c.cx) ** 2 + (y - c.cy) ** 2 - c.r * c.r,
  );
}

function functionFunction(exprA, exprB, range) {
  const xLow = range.xMin;
  const xHigh = range.xMax;
  if (!(xHigh > xLow)) return [];
  const sample = (x) => {
    const ya = evalAt(exprA, x);
    const yb = evalAt(exprB, x);
    if (ya === null || yb === null) return null;
    return ya - yb;
  };
  const out = [];
  const step = (xHigh - xLow) / SAMPLE_COUNT;
  let prevX = xLow;
  let prevH = sample(prevX);
  for (let i = 1; i <= SAMPLE_COUNT; i += 1) {
    const x = xLow + step * i;
    const h = sample(x);
    if (prevH !== null && h !== null && Math.sign(prevH) !== Math.sign(h)) {
      const root = bisect(sample, prevX, x, prevH);
      if (root !== null) {
        const y = evalAt(exprA, root);
        if (y !== null) out.push([root, y]);
      }
    }
    prevX = x;
    prevH = h;
  }
  return out;
}

function findRoots(expression, xLow, xHigh, delta) {
  if (!(xHigh > xLow)) return [];
  const sample = (x) => {
    const y = evalAt(expression, x);
    if (y === null) return null;
    return delta(x, y);
  };
  const out = [];
  const step = (xHigh - xLow) / SAMPLE_COUNT;
  let prevX = xLow;
  let prevH = sample(prevX);
  for (let i = 1; i <= SAMPLE_COUNT; i += 1) {
    const x = xLow + step * i;
    const h = sample(x);
    if (prevH !== null && h !== null && Math.sign(prevH) !== Math.sign(h)) {
      const root = bisect(sample, prevX, x, prevH);
      if (root !== null) {
        const y = evalAt(expression, root);
        if (y !== null) out.push([root, y]);
      }
    }
    prevX = x;
    prevH = h;
  }
  return out;
}

function bisect(sample, loIn, hiIn, loValIn) {
  let lo = loIn;
  let hi = hiIn;
  let loVal = loValIn;
  for (let i = 0; i < ROOT_ITERS; i += 1) {
    const mid = (lo + hi) / 2;
    const value = sample(mid);
    if (value === null) return null;
    if (Math.abs(value) < ROOT_TOL || hi - lo < ROOT_TOL) return mid;
    if (Math.sign(value) === Math.sign(loVal)) {
      lo = mid;
      loVal = value;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

function evalAt(expression, x) {
  try {
    const value = evaluate(expression, { x });
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    if (!out.some((q) => Math.abs(q[0] - p[0]) < DEDUPE_EPS && Math.abs(q[1] - p[1]) < DEDUPE_EPS)) {
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Measurements. Everything down to sharedEndpointAngles mirrors
// src/lib/measurements.ts; the rest (shape names, parallel / perpendicular
// sides, line relationships) is only used for the grader-facing text output.

const JOINT_EPS = 1e-6;
// Relative tolerance for "equal", "parallel" and "perpendicular". Tight on
// purpose: snapped or typed coordinates are exact, and a shape drawn slightly
// off shouldn't be reported as a square.
const REL_EPS = 1e-6;

function segmentLength(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function directionDeg(a, b) {
  const degrees = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

function angleBetweenDeg(vertex, a, b) {
  const ux = a[0] - vertex[0];
  const uy = a[1] - vertex[1];
  const vx = b[0] - vertex[0];
  const vy = b[1] - vertex[1];
  if ((ux === 0 && uy === 0) || (vx === 0 && vy === 0)) return NaN;
  return (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * 180) / Math.PI;
}

function objectVertices(object) {
  if (object.type === 'rectangle') return rectangleCorners(object);
  if (object.type === 'polygon') return polygonWorldPoints(object);
  return null;
}

function sideLengths(vertices) {
  return vertices.map((vertex, index) => segmentLength(vertex, vertices[(index + 1) % vertices.length]));
}

function signedArea(vertices) {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % vertices.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function interiorAngles(vertices) {
  const n = vertices.length;
  if (n < 3) return vertices.map(() => NaN);
  const counterclockwise = signedArea(vertices) >= 0;
  return vertices.map((vertex, index) => {
    const prev = vertices[(index - 1 + n) % n];
    const next = vertices[(index + 1) % n];
    const toPrev = Math.atan2(prev[1] - vertex[1], prev[0] - vertex[0]);
    const toNext = Math.atan2(next[1] - vertex[1], next[0] - vertex[0]);
    if (segmentLength(vertex, prev) === 0 || segmentLength(vertex, next) === 0) return NaN;
    let sweep = counterclockwise ? toPrev - toNext : toNext - toPrev;
    sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return (sweep * 180) / Math.PI;
  });
}

function sharedEndpointAngles(objects) {
  const lines = objects.filter(
    (object) => object.type === 'line' && (object.x1 !== object.x2 || object.y1 !== object.y2),
  );
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i];
      const b = lines[j];
      const aEnds = [[a.x1, a.y1], [a.x2, a.y2]];
      const bEnds = [[b.x1, b.y1], [b.x2, b.y2]];
      for (let ai = 0; ai < 2; ai += 1) {
        for (let bi = 0; bi < 2; bi += 1) {
          const vertex = aEnds[ai];
          const other = bEnds[bi];
          if (Math.abs(vertex[0] - other[0]) > JOINT_EPS || Math.abs(vertex[1] - other[1]) > JOINT_EPS) continue;
          const aFar = aEnds[1 - ai];
          const bFar = bEnds[1 - bi];
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

function nearlyEqual(a, b) {
  return Math.abs(a - b) <= REL_EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

function sideVector(vertices, index) {
  const a = vertices[index];
  const b = vertices[(index + 1) % vertices.length];
  return [b[0] - a[0], b[1] - a[1]];
}

function isParallel(u, v) {
  const scale = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
  return scale > 0 && Math.abs(u[0] * v[1] - u[1] * v[0]) <= REL_EPS * scale;
}

function isPerpendicular(u, v) {
  const scale = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
  return scale > 0 && Math.abs(u[0] * v[0] + u[1] * v[1]) <= REL_EPS * scale;
}

// Pairs of non-adjacent sides that are parallel, as [i, j] side indices.
function parallelSidePairs(vertices) {
  const n = vertices.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (!adjacent && isParallel(sideVector(vertices, i), sideVector(vertices, j))) out.push([i, j]);
    }
  }
  return out;
}

function perpendicularSidePairs(vertices) {
  const n = vertices.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (isPerpendicular(sideVector(vertices, i), sideVector(vertices, j))) out.push([i, j]);
    }
  }
  return out;
}

function isSelfIntersecting(vertices) {
  const n = vertices.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      const si = [vertices[i], vertices[(i + 1) % n]];
      const sj = [vertices[j], vertices[(j + 1) % n]];
      if (segmentSegment(si, sj)) return true;
    }
  }
  return false;
}

const POLYGON_NAMES = { 3: 'triangle', 4: 'quadrilateral', 5: 'pentagon', 6: 'hexagon', 7: 'heptagon', 8: 'octagon' };

function polygonBaseName(n) {
  return POLYGON_NAMES[n] ?? `${n}-sided polygon`;
}

// A plain-language name for a closed shape, e.g. "right isosceles triangle",
// "rhombus", "concave quadrilateral". Not shown to learners: it would give away
// answers to "which shape is this?" questions.
function classifyPolygon(vertices) {
  const n = vertices.length;
  if (n < 3) return 'degenerate polygon';
  const sides = sideLengths(vertices);
  if (sides.some((side) => side === 0)) return `degenerate ${polygonBaseName(n)} (repeated vertex)`;

  if (n === 3) {
    if (isParallel(sideVector(vertices, 0), sideVector(vertices, 1))) {
      return 'degenerate triangle (collinear points)';
    }
    const [a, b, c] = sides;
    const equalPairs = [nearlyEqual(a, b), nearlyEqual(b, c), nearlyEqual(c, a)].filter(Boolean).length;
    if (equalPairs === 3) return 'equilateral triangle';
    const sideKind = equalPairs >= 1 ? 'isosceles' : 'scalene';
    const right = [0, 1, 2].some((i) => isPerpendicular(sideVector(vertices, i), sideVector(vertices, (i + 1) % 3)));
    const angles = interiorAngles(vertices);
    const angleKind = right ? 'right' : angles.some((angle) => angle > 90) ? 'obtuse' : 'acute';
    return `${angleKind} ${sideKind} triangle`;
  }

  const name = polygonBaseName(n);
  if (isSelfIntersecting(vertices)) return `self-intersecting ${name}`;
  const angles = interiorAngles(vertices);
  const concave = angles.some((angle) => angle > 180 && !nearlyEqual(angle, 180));
  const allSidesEqual = sides.every((side) => nearlyEqual(side, sides[0]));

  if (n === 4) {
    const e = [0, 1, 2, 3].map((i) => sideVector(vertices, i));
    const firstPair = isParallel(e[0], e[2]);
    const secondPair = isParallel(e[1], e[3]);
    const hasRightAngle = [0, 1, 2, 3].some((i) => isPerpendicular(e[i], e[(i + 1) % 4]));
    if (firstPair && secondPair) {
      if (allSidesEqual) return hasRightAngle ? 'square' : 'rhombus';
      return hasRightAngle ? 'rectangle' : 'parallelogram';
    }
    if (firstPair || secondPair) {
      const legs = firstPair ? [sides[1], sides[3]] : [sides[0], sides[2]];
      if (nearlyEqual(legs[0], legs[1])) return 'isosceles trapezoid';
      return hasRightAngle ? 'right trapezoid' : 'trapezoid';
    }
    const kite =
      (nearlyEqual(sides[0], sides[1]) && nearlyEqual(sides[2], sides[3])) ||
      (nearlyEqual(sides[1], sides[2]) && nearlyEqual(sides[3], sides[0]));
    if (kite) return concave ? 'concave kite' : 'kite';
    return concave ? 'concave quadrilateral' : 'quadrilateral';
  }

  if (concave) return `concave ${name}`;
  const allAnglesEqual = angles.every((angle) => nearlyEqual(angle, angles[0]));
  return allSidesEqual && allAnglesEqual ? `regular ${name}` : name;
}

// Parallel, collinear and perpendicular pairs among separate line segments.
function lineRelationships(objects) {
  const lines = objects.filter(
    (object) => object.type === 'line' && (object.x1 !== object.x2 || object.y1 !== object.y2),
  );
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i];
      const b = lines[j];
      const u = [a.x2 - a.x1, a.y2 - a.y1];
      const v = [b.x2 - b.x1, b.y2 - b.y1];
      if (isParallel(u, v)) {
        const offset = [b.x1 - a.x1, b.y1 - a.y1];
        const collinear = Math.hypot(offset[0], offset[1]) === 0 || isParallel(u, offset);
        out.push({ a, b, kind: collinear ? 'collinear' : 'parallel' });
      } else if (isPerpendicular(u, v)) {
        out.push({ a, b, kind: 'perpendicular' });
      }
    }
  }
  return out;
}

module.exports = {
  computeIntersections,
  segmentLength,
  directionDeg,
  angleBetweenDeg,
  objectVertices,
  sideLengths,
  signedArea,
  interiorAngles,
  sharedEndpointAngles,
  classifyPolygon,
  parallelSidePairs,
  perpendicularSidePairs,
  lineRelationships,
};
