import { describe, expect, it } from 'vitest';
import { parseLengthEntry, type GeomObject } from '../src/lib/geometry';
import {
  angleBetweenDeg,
  cleanCoordinate,
  directionDeg,
  formatAngle,
  formatLength,
  interiorAngles,
  lineWithDirection,
  lineWithLength,
  objectVertices,
  sharedEndpointAngles,
  sideLengths,
  type Vec,
} from '../src/lib/measurements';

function expectAllClose(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 9));
}

describe('sideLengths and interiorAngles', () => {
  it('measures a 3-4-5 right triangle', () => {
    const triangle: Vec[] = [[0, 0], [4, 0], [0, 3]];
    expectAllClose(sideLengths(triangle), [4, 5, 3]);
    expectAllClose(interiorAngles(triangle), [90, 36.86989764584402, 53.13010235415598]);
  });

  it('gives the same interior angles for clockwise and counterclockwise order', () => {
    const counterclockwise: Vec[] = [[0, 0], [2, 0], [2, 1], [0, 1]];
    const clockwise = [...counterclockwise].reverse();
    expectAllClose(interiorAngles(counterclockwise), [90, 90, 90, 90]);
    expectAllClose(interiorAngles(clockwise), [90, 90, 90, 90]);
  });

  it('reports a reflex angle at the dent of a concave polygon', () => {
    // An arrowhead: the vertex at (2, 1) points into the shape.
    const arrow: Vec[] = [[0, 0], [2, 1], [4, 0], [2, 4]];
    const angles = interiorAngles(arrow);
    expect(angles[1]).toBeGreaterThan(180);
    expect(angles.reduce((sum, angle) => sum + angle, 0)).toBeCloseTo(360, 9);
  });

  it('returns NaN at a repeated vertex instead of a misleading angle', () => {
    const angles = interiorAngles([[0, 0], [0, 0], [1, 0], [0, 1]]);
    expect(Number.isNaN(angles[0])).toBe(true);
    expect(Number.isNaN(angles[1])).toBe(true);
  });
});

describe('objectVertices', () => {
  it('applies rectangle rotation', () => {
    const rect: GeomObject = { id: 'r', type: 'rectangle', x: -1, y: -1, w: 2, h: 2, rotation: Math.PI / 4 };
    const vertices = objectVertices(rect)!;
    expectAllClose(sideLengths(vertices), [2, 2, 2, 2]);
    expect(vertices[0][0]).toBeCloseTo(0, 9);
    expect(vertices[0][1]).toBeCloseTo(-Math.SQRT2, 9);
  });

  it('returns null for shapes without sides', () => {
    expect(objectVertices({ id: 'c', type: 'circle', cx: 0, cy: 0, r: 1 })).toBeNull();
    expect(objectVertices({ id: 'l', type: 'line', x1: 0, y1: 0, x2: 1, y2: 0 })).toBeNull();
  });
});

describe('directionDeg and angleBetweenDeg', () => {
  it('measures direction counterclockwise from +x in [0, 360)', () => {
    expect(directionDeg([0, 0], [1, 0])).toBe(0);
    expect(directionDeg([0, 0], [0, 1])).toBe(90);
    expect(directionDeg([0, 0], [-1, 0])).toBe(180);
    expect(directionDeg([0, 0], [0, -1])).toBe(270);
  });

  it('measures the smaller angle between two rays', () => {
    expect(angleBetweenDeg([0, 0], [1, 0], [0, 1])).toBeCloseTo(90, 9);
    expect(angleBetweenDeg([0, 0], [1, 0], [-1, -1])).toBeCloseTo(135, 9);
    expect(Number.isNaN(angleBetweenDeg([0, 0], [0, 0], [1, 1]))).toBe(true);
  });
});

describe('sharedEndpointAngles', () => {
  it('finds the angle where two segments meet, whichever ends touch', () => {
    const objects: GeomObject[] = [
      { id: 'a', type: 'line', x1: 0, y1: 0, x2: 5, y2: 0 },
      { id: 'b', type: 'line', x1: 3, y1: 3, x2: 0, y2: 0 },
      { id: 'c', type: 'line', x1: 10, y1: 10, x2: 11, y2: 10 },
    ];
    const joints = sharedEndpointAngles(objects);
    expect(joints).toHaveLength(1);
    expect(joints[0].lineIds).toEqual(['a', 'b']);
    expect(joints[0].vertex).toEqual([0, 0]);
    expect(joints[0].degrees).toBeCloseTo(45, 9);
  });

  it('ignores duplicate segments and zero-length lines', () => {
    const objects: GeomObject[] = [
      { id: 'a', type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 },
      { id: 'b', type: 'line', x1: 1, y1: 1, x2: 0, y2: 0 },
      { id: 'dot', type: 'line', x1: 0, y1: 0, x2: 0, y2: 0 },
    ];
    expect(sharedEndpointAngles(objects)).toEqual([]);
  });
});

describe('formatting', () => {
  it('rounds lengths to 2 decimals and angles to 1, trimming zeros', () => {
    expect(formatLength(5)).toBe('5');
    expect(formatLength(Math.SQRT2)).toBe('1.41');
    expect(formatAngle(36.86989764584402)).toBe('36.9°');
    expect(formatAngle(90)).toBe('90°');
    expect(formatAngle(NaN)).toBe('—');
  });

  it('cleans floating-point noise from computed coordinates', () => {
    expect(cleanCoordinate(2.9999999999999996)).toBe(3);
    expect(cleanCoordinate(3 * Math.cos(Math.PI / 2))).toBe(0);
    expect(cleanCoordinate(0.1 + 0.2)).toBe(0.3);
  });
});

describe('parseLengthEntry', () => {
  it('reads a length, with an optional direction in degrees', () => {
    expect(parseLengthEntry('5')).toEqual({ length: 5 });
    expect(parseLengthEntry('5, 30')).toEqual({ length: 5, angleDeg: 30 });
    expect(parseLengthEntry(' 2.5 ,-45° ')).toEqual({ length: 2.5, angleDeg: -45 });
    expect(parseLengthEntry('5,')).toEqual({ length: 5 });
  });

  it('accepts expressions such as square roots', () => {
    expect(parseLengthEntry('3*sqrt(2), 45')!.length).toBeCloseTo(3 * Math.SQRT2, 12);
  });

  it('rejects empty, zero, negative and malformed input', () => {
    for (const input of ['', ' ', '0', '-3', 'abc', '5, x', '1, 2, 3', ', 30']) {
      expect(parseLengthEntry(input), input).toBeNull();
    }
  });
});

describe('lineWithLength and lineWithDirection', () => {
  const line: Extract<GeomObject, { type: 'line' }> = { id: 'l', type: 'line', x1: 1, y1: 1, x2: 4, y2: 5 };

  it('changes length along the same direction, keeping the first endpoint', () => {
    expect(lineWithLength(line, 10)).toEqual({ ...line, x2: 7, y2: 9 });
  });

  it('turns the segment around its first endpoint, keeping its length', () => {
    expect(lineWithDirection(line, 90)).toEqual({ ...line, x2: 1, y2: 6 });
    expect(lineWithDirection(line, 180)).toEqual({ ...line, x2: -4, y2: 1 });
  });

  it('points a zero-length segment along +x when given a length', () => {
    const dot = { ...line, x2: 1, y2: 1 };
    expect(lineWithLength(dot, 2)).toEqual({ ...line, x2: 3, y2: 1 });
  });
});
