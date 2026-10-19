// The server keeps its own copy of the geometry math in intersections.js (see
// the note at the top of that file). These tests run both copies on the same
// shapes so they can't drift apart unnoticed.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { GeomObject } from '../src/lib/geometry';
import { computeIntersections } from '../src/lib/intersections';
import * as client from '../src/lib/measurements';

const require = createRequire(import.meta.url);
const server = require('../intersections.js');

const FIXTURES: GeomObject[] = [
  { id: 'p', type: 'point', x: 1, y: 1 },
  { id: 'l1', type: 'line', x1: -5, y1: 0, x2: 5, y2: 0 },
  { id: 'l2', type: 'line', x1: 0, y1: 0, x2: 3, y2: 4 },
  { id: 'l3', type: 'line', x1: 0, y1: -4, x2: 0, y2: 4 },
  // l4 meets l2 at (3, 4); l5 meets l1 at (5, 0) and l4 at (6, 0).
  { id: 'l4', type: 'line', x1: 3, y1: 4, x2: 6, y2: 0 },
  { id: 'l5', type: 'line', x1: 5, y1: 0, x2: 6, y2: 0 },
  { id: 'c1', type: 'circle', cx: 0, cy: 0, r: 3 },
  { id: 'c2', type: 'circle', cx: 4, cy: 1, r: 2 },
  { id: 'r1', type: 'rectangle', x: -2, y: -1, w: 4, h: 3 },
  { id: 'r2', type: 'rectangle', x: 1, y: 1, w: -3, h: 2, rotation: 0.7 },
  { id: 'tri', type: 'polygon', points: [[0, 0], [4, 0], [0, 3]] },
  { id: 'arrow', type: 'polygon', points: [[0, 0], [2, 1], [4, 0], [2, 4]], rotation: 1.2 },
  { id: 'f1', type: 'function', expression: 'x^2 - 4' },
  { id: 'f2', type: 'function', expression: 'sin(x) + 1' },
];

const VIEW = { xMin: -10, xMax: 10 };

function sortPoints(points: [number, number][]): [number, number][] {
  return [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function expectPointsClose(actual: [number, number][], expected: [number, number][]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach(([x, y], index) => {
    expect(x).toBeCloseTo(expected[index][0], 9);
    expect(y).toBeCloseTo(expected[index][1], 9);
  });
}

function expectNumbersMatch(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    if (Number.isNaN(expected[index])) expect(Number.isNaN(value)).toBe(true);
    else expect(value).toBeCloseTo(expected[index], 9);
  });
}

describe('intersections: frontend and server agree', () => {
  it('on every pair of fixtures', () => {
    const fromClient = sortPoints(computeIntersections(FIXTURES, VIEW));
    const fromServer = sortPoints(server.computeIntersections(FIXTURES, VIEW));
    expect(fromClient.length).toBeGreaterThan(10);
    expectPointsClose(fromServer, fromClient);
  });

  it('pair by pair, so a mismatch names the shapes involved', () => {
    for (let i = 0; i < FIXTURES.length; i += 1) {
      for (let j = i + 1; j < FIXTURES.length; j += 1) {
        const pair = [FIXTURES[i], FIXTURES[j]];
        const label = `${pair[0].id} × ${pair[1].id}`;
        const fromClient = sortPoints(computeIntersections(pair, VIEW));
        const fromServer = sortPoints(server.computeIntersections(pair, VIEW));
        expect(fromServer.length, label).toBe(fromClient.length);
        expectPointsClose(fromServer, fromClient);
      }
    }
  });
});

describe('measurements: frontend and server agree', () => {
  for (const object of FIXTURES) {
    it(`on ${object.id} (${object.type})`, () => {
      const clientVertices = client.objectVertices(object);
      const serverVertices = server.objectVertices(object);
      if (clientVertices === null) {
        expect(serverVertices).toBeNull();
        return;
      }
      expectPointsClose(serverVertices, clientVertices);
      expectNumbersMatch(server.sideLengths(serverVertices), client.sideLengths(clientVertices));
      expectNumbersMatch(server.interiorAngles(serverVertices), client.interiorAngles(clientVertices));
      expect(server.signedArea(serverVertices)).toBeCloseTo(client.signedArea(clientVertices), 9);
    });
  }

  it('on line lengths and directions', () => {
    for (const object of FIXTURES) {
      if (object.type !== 'line') continue;
      const a: [number, number] = [object.x1, object.y1];
      const b: [number, number] = [object.x2, object.y2];
      expect(server.segmentLength(a, b)).toBeCloseTo(client.segmentLength(a, b), 12);
      expect(server.directionDeg(a, b)).toBeCloseTo(client.directionDeg(a, b), 12);
      expect(server.directionDeg(b, a)).toBeCloseTo(client.directionDeg(b, a), 12);
    }
  });

  it('on angles where segments share an endpoint', () => {
    const fromClient = client.sharedEndpointAngles(FIXTURES);
    const fromServer = server.sharedEndpointAngles(FIXTURES);
    expect(fromClient.length).toBeGreaterThan(0);
    expect(fromServer).toHaveLength(fromClient.length);
    fromServer.forEach((joint: client.JointAngle, index: number) => {
      expect(joint.lineIds).toEqual(fromClient[index].lineIds);
      expect(joint.vertex).toEqual(fromClient[index].vertex);
      expect(joint.ends).toEqual(fromClient[index].ends);
      expect(joint.degrees).toBeCloseTo(fromClient[index].degrees, 12);
    });
  });
});
