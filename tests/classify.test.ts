// Shape names and side relationships only exist on the server (they feed the
// grader-facing text output), so these test intersections.js directly.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const server = require('../intersections.js');

type Vec = [number, number];

describe('classifyPolygon', () => {
  const cases: [string, Vec[]][] = [
    ['equilateral triangle', [[0, 0], [2, 0], [1, Math.sqrt(3)]]],
    ['right isosceles triangle', [[0, 0], [3, 0], [0, 3]]],
    ['right scalene triangle', [[0, 0], [4, 0], [0, 3]]],
    ['obtuse scalene triangle', [[0, 0], [5, 0], [6, 1]]],
    ['acute isosceles triangle', [[0, 0], [2, 0], [1, 3]]],
    ['degenerate triangle (collinear points)', [[0, 0], [1, 1], [3, 3]]],
    ['square', [[0, 0], [2, 0], [2, 2], [0, 2]]],
    ['rectangle', [[0, 0], [4, 0], [4, 2], [0, 2]]],
    ['rhombus', [[0, 0], [2, 1], [4, 0], [2, -1]]],
    ['parallelogram', [[0, 0], [4, 0], [5, 2], [1, 2]]],
    ['isosceles trapezoid', [[0, 0], [6, 0], [4, 2], [2, 2]]],
    ['right trapezoid', [[0, 0], [5, 0], [3, 2], [0, 2]]],
    ['trapezoid', [[0, 0], [6, 0], [4, 2], [1, 2]]],
    ['kite', [[0, 0], [2, 1], [0, 4], [-2, 1]]],
    ['concave kite', [[0, 0], [2, 3], [0, 1], [-2, 3]]],
    ['concave quadrilateral', [[0, 0], [5, 0], [2, 1], [1, 4]]],
    ['quadrilateral', [[0, 0], [5, 0], [4, 3], [1, 2]]],
    ['self-intersecting quadrilateral', [[0, 0], [2, 2], [2, 0], [0, 2]]],
    ['regular hexagon', [0, 1, 2, 3, 4, 5].map((k) => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)] as Vec)],
    ['pentagon', [[0, 0], [3, 0], [4, 2], [1, 4], [-1, 2]]],
    ['concave pentagon', [[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]]],
    ['degenerate quadrilateral (repeated vertex)', [[0, 0], [0, 0], [1, 0], [0, 1]]],
  ];

  for (const [expected, vertices] of cases) {
    it(`names ${expected}`, () => {
      expect(server.classifyPolygon(vertices)).toBe(expected);
    });
  }

  it('gives the same name regardless of vertex order direction', () => {
    for (const [, vertices] of cases) {
      expect(server.classifyPolygon([...vertices].reverse())).toBe(server.classifyPolygon(vertices));
    }
  });

  it('does not call a nearly-square shape a square', () => {
    expect(server.classifyPolygon([[0, 0], [2, 0], [2, 2.001], [0, 2]])).not.toBe('square');
  });
});

describe('side relationships', () => {
  it('lists parallel and perpendicular sides of a right trapezoid', () => {
    const vertices: Vec[] = [[0, 0], [5, 0], [3, 2], [0, 2]];
    expect(server.parallelSidePairs(vertices)).toEqual([[0, 2]]);
    expect(server.perpendicularSidePairs(vertices)).toEqual([[0, 3], [2, 3]]);
  });

  it('finds parallel, collinear and perpendicular line segments', () => {
    const objects = [
      { id: 'a', type: 'line', x1: 0, y1: 0, x2: 4, y2: 0 },
      { id: 'b', type: 'line', x1: 0, y1: 2, x2: 4, y2: 2 },
      { id: 'c', type: 'line', x1: 6, y1: 0, x2: 8, y2: 0 },
      { id: 'd', type: 'line', x1: 1, y1: -1, x2: 1, y2: 3 },
    ];
    const summary = server
      .lineRelationships(objects)
      .map((relation: { a: { id: string }; b: { id: string }; kind: string }) => `${relation.a.id}-${relation.b.id}:${relation.kind}`);
    expect(summary).toEqual([
      'a-b:parallel',
      'a-c:collinear',
      'a-d:perpendicular',
      'b-c:parallel',
      'b-d:perpendicular',
      'c-d:perpendicular',
    ]);
  });
});
