// Runs the real server.js against a test config.json in a temporary folder,
// the same way production starts it (`node server.js`).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from './compat/harness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TEST_CONFIG = {
  tools: ['line', 'polygon', 'not-a-tool'],
  showMeasurements: 'selected',
  detailedTextState: true,
  objects: [
    { id: 'base', type: 'line', x1: 0, y1: 0, x2: 4, y2: 0, label: 'AB', locked: true },
  ],
};

let server: Awaited<ReturnType<typeof startServer>>;
let baseUrl: string;

beforeAll(async () => {
  server = await startServer(repoRoot, TEST_CONFIG);
  baseUrl = server.baseUrl;
});

afterAll(() => {
  server?.stop();
});

async function postState(objects: unknown[]) {
  const response = await fetch(`${baseUrl}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objects }),
  });
  expect(response.ok).toBe(true);
}

async function textState(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/state?format=text`);
  return response.text();
}

describe('startup', () => {
  it('seeds the in-memory state from config.json', async () => {
    const objects = await (await fetch(`${baseUrl}/api/state`)).json();
    expect(objects).toEqual(TEST_CONFIG.objects);
    expect(server.output()).not.toContain('Unable to read config.json');
  });
});

describe('GET /api/config', () => {
  it('returns the tool list and measurement mode, dropping unknown tools', async () => {
    const config = await (await fetch(`${baseUrl}/api/config`)).json();
    expect(config.tools).toEqual(['line', 'polygon']);
    expect(config.showMeasurements).toBe('selected');
    expect(config.objects[0].locked).toBe(true);
    expect(server.output()).toContain('unknown tool "not-a-tool"');
  });
});

describe('GET /api/state?format=text', () => {
  it('reports line length, direction and the locked flag', async () => {
    await postState(TEST_CONFIG.objects);
    expect(await textState()).toBe('Line (AB) from (0, 0) to (4, 0), length 4, direction 0° [locked]');
  });

  it('describes a triangle’s vertices, sides, angles and shape', async () => {
    await postState([{ id: 't', type: 'polygon', points: [[0, 0], [4, 0], [0, 3]] }]);
    expect((await textState()).split('\n')).toEqual([
      'Polygon with points (0, 0), (4, 0), (0, 3) and rotation 0 radians (0 degrees)',
      '  Vertices: A (0, 0), B (4, 0), C (0, 3)',
      '  Sides: AB = 4, BC = 5, CA = 3',
      '  Angles: A = 90°, B = 36.87°, C = 53.13°',
      '  Shape: right scalene triangle',
      '  Perpendicular sides: AB ⊥ CA',
    ]);
  });

  it('names a rotated square and lists its parallel sides', async () => {
    await postState([
      { id: 'sq', type: 'rectangle', x: -2, y: -2, w: 4, h: 4, rotation: Math.PI / 4, label: 'diamond' },
    ]);
    const text = await textState();
    expect(text).toContain('  Vertices: A (0, -2.828), B (2.828, 0), C (0, 2.828), D (-2.828, 0)');
    expect(text).toContain('  Shape: square');
    expect(text).toContain('  Parallel sides: AB ∥ CD, BC ∥ DA');
  });

  it('lists relationships and joint angles between separate segments', async () => {
    await postState([
      { id: 'a', type: 'line', x1: 0, y1: 0, x2: 4, y2: 0, label: 'AB' },
      { id: 'b', type: 'line', x1: 0, y1: 0, x2: 0, y2: 3 },
      { id: 'c', type: 'line', x1: 0, y1: 3, x2: 4, y2: 3 },
    ]);
    const text = await textState();
    expect(text).toContain('Relationships (5):');
    expect(text).toContain('  Line (AB) is perpendicular to Line from (0, 0) to (0, 3)');
    expect(text).toContain('  Line (AB) is parallel to Line from (0, 3) to (4, 3)');
    expect(text).toContain('  Angle between Line (AB) and Line from (0, 0) to (0, 3) at (0, 0): 90°');
    expect(text).toContain('  Angle between Line from (0, 0) to (0, 3) and Line from (0, 3) to (4, 3) at (0, 3): 90°');
    // Existing sections still follow.
    expect(text).toContain('Intersections (');
  });

  it('leaves points, circles and functions as they were', async () => {
    await postState([
      { id: 'p', type: 'point', x: 1, y: 2, label: 'P' },
      { id: 'c', type: 'circle', cx: 10, cy: 10, r: 1 },
      { id: 'f', type: 'function', expression: 'x^2 + 100' },
    ]);
    expect((await textState()).split('\n')).toEqual([
      'Point (P) at (1, 2)',
      'Circle at (10, 10) with radius 1',
      'Function: y = x^2 + 100',
    ]);
  });
});

describe('detailedTextState', () => {
  const objects = [
    { id: 'a', type: 'line', x1: 0, y1: 0, x2: 4, y2: 0, label: 'AB' },
    { id: 'b', type: 'line', x1: 0, y1: 0, x2: 0, y2: 3 },
    { id: 'r', type: 'rectangle', x: -1, y: -1, w: 2, h: 3, rotation: 0.4 },
    { id: 't', type: 'polygon', points: [[5, 0], [9, 0], [5, 3]], label: 'T' },
    { id: 'c', type: 'circle', cx: 2, cy: 2, r: 1 },
  ];

  async function textFor(config: Record<string, unknown>) {
    const plain = await startServer(repoRoot, { objects, ...config });
    try {
      return await (await fetch(`${plain.baseUrl}/api/state?format=text`)).text();
    } finally {
      plain.stop();
    }
  }

  it('is off by default: no measurements in the text', async () => {
    const text = await textFor({});
    expect(text).not.toContain('length');
    expect(text).not.toContain('  Sides:');
    expect(text).not.toContain('Relationships');
  });

  it('only adds to the default text, never changes it', async () => {
    const plainLines = (await textFor({})).split('\n');
    const detailedLines = (await textFor({ detailedTextState: true })).split('\n');
    // Every default line survives in order; on the detailed side it may only
    // gain a suffix (line measurements) and new lines may appear between.
    let cursor = 0;
    for (const line of plainLines) {
      while (cursor < detailedLines.length && !detailedLines[cursor].startsWith(line)) cursor += 1;
      expect(cursor, `default line missing from detailed output: ${line}`).toBeLessThan(detailedLines.length);
      cursor += 1;
    }
    expect(detailedLines.length).toBeGreaterThan(plainLines.length);
  });

  it('ignores a non-boolean value with a warning', async () => {
    const odd = await startServer(repoRoot, { objects, detailedTextState: 'yes' });
    try {
      const text = await (await fetch(`${odd.baseUrl}/api/state?format=text`)).text();
      expect(text).not.toContain('  Sides:');
      expect(odd.output()).toContain('"detailedTextState" must be true or false');
    } finally {
      odd.stop();
    }
  });
});
