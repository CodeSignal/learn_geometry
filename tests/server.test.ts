// Runs the real server.js against a test config.json in a temporary folder,
// the same way production starts it (`node server.js`).
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TEST_CONFIG = {
  tools: ['line', 'polygon', 'not-a-tool'],
  showMeasurements: 'selected',
  objects: [
    { id: 'base', type: 'line', x1: 0, y1: 0, x2: 4, y2: 0, label: 'AB', locked: true },
  ],
};

let serverProcess: ChildProcess;
let baseUrl: string;
let workDir: string;
let serverOutput = '';

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), 'learn-geometry-test-'));
  copyFileSync(path.join(repoRoot, 'server.js'), path.join(workDir, 'server.js'));
  copyFileSync(path.join(repoRoot, 'intersections.js'), path.join(workDir, 'intersections.js'));
  writeFileSync(path.join(workDir, 'config.json'), JSON.stringify(TEST_CONFIG));

  const port = 40000 + Math.floor(Math.random() * 20000);
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: workDir,
    env: { ...process.env, PORT: String(port), NODE_PATH: path.join(repoRoot, 'node_modules') },
  });
  baseUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${serverOutput}`)), 10000);
    const onData = (chunk: Buffer) => {
      serverOutput += chunk.toString();
      const match = serverOutput.match(/listening on port (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };
    serverProcess.stdout?.on('data', onData);
    serverProcess.stderr?.on('data', onData);
    serverProcess.on('exit', (code) => reject(new Error(`server exited (${code}):\n${serverOutput}`)));
  });
});

afterAll(() => {
  serverProcess?.kill();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
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
    expect(serverOutput).not.toContain('Unable to read config.json');
  });
});

describe('GET /api/config', () => {
  it('returns the tool list and measurement mode, dropping unknown tools', async () => {
    const config = await (await fetch(`${baseUrl}/api/config`)).json();
    expect(config.tools).toEqual(['line', 'polygon']);
    expect(config.showMeasurements).toBe('selected');
    expect(config.objects[0].locked).toBe(true);
    expect(serverOutput).toContain('unknown tool "not-a-tool"');
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
