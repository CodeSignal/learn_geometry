// Backward-compatibility harness: runs a fixed set of API requests against a
// copy of server.js so the responses can be compared with a recorded
// baseline. Used by tests/compat.test.ts and tests/compat/record.mjs.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A config written the way existing tasks write it: none of the newer keys.
const LEGACY_CONFIG = {
  viewCenter: [1, 2, 80],
  sidebarOpen: true,
  objects: [
    { id: 'p1', type: 'point', x: 0, y: 0, label: 'Origin' },
    // Just below the x-axis, so an intersection prints as "-0".
    { id: 'l1', type: 'line', x1: -4, y1: -0.0001, x2: 4, y2: -0.0001 },
    { id: 'l2', type: 'line', x1: 0, y1: -3, x2: 0, y2: 5 },
    { id: 'c1', type: 'circle', cx: 1, cy: 1, r: 2.5, label: 'wheel' },
    { id: 'r1', type: 'rectangle', x: -2, y: -1, w: 3, h: 2, rotation: 0.5 },
    { id: 'poly', type: 'polygon', points: [[2, 0], [5, 0], [2, 4]] },
    { id: 'poly2', type: 'polygon', points: [[-3, 1], [-1, 1], [-1, 3], [-3, 3]], rotation: 0.3, label: 'tile' },
    { id: 'f1', type: 'function', expression: 'x^2 - 4', label: 'y = x²−4' },
  ],
  task: {
    question: 'Which shape is the wheel?',
    type: 'multiple_choice',
    options: ['Circle', 'Square', 'Triangle'],
    correctAnswer: 'Circle',
  },
};

// Segments that meet at endpoints and are parallel / perpendicular: the
// cases the newer measurement output describes.
const JOINED_SEGMENTS = [
  { id: 'a', type: 'line', x1: 0, y1: 0, x2: 4, y2: 0, label: 'AB' },
  { id: 'b', type: 'line', x1: 0, y1: 0, x2: 0, y2: 3 },
  { id: 'c', type: 'line', x1: 0, y1: 3, x2: 4, y2: 3 },
  { id: 'sq', type: 'rectangle', x: 6, y: 0, w: 2, h: 2 },
];

const FULL_FLOW = [
  { method: 'GET', path: '/api/config' },
  { method: 'GET', path: '/api/state' },
  { method: 'GET', path: '/api/state?format=text' },
  { method: 'POST', path: '/api/state', body: { objects: JOINED_SEGMENTS } },
  { method: 'GET', path: '/api/state?format=text' },
  { method: 'POST', path: '/api/state', body: { nope: true } },
  { method: 'GET', path: '/api/task' },
  { method: 'GET', path: '/api/task?format=text' },
  { method: 'POST', path: '/api/task/answer', body: { answer: 'Square' } },
  { method: 'POST', path: '/api/task/answer', body: { answer: 'Hexagon' } },
  { method: 'POST', path: '/api/task/answer', body: { answer: 5 } },
  { method: 'GET', path: '/api/task?format=text' },
];

export const SCENARIOS = [
  { name: 'legacy config with every object type and a task', config: LEGACY_CONFIG, steps: FULL_FLOW },
  {
    name: 'freeform task, no optional keys',
    config: {
      objects: [{ id: 't', type: 'polygon', points: [[0, 0], [4, 0], [0, 3]] }],
      task: { question: 'What is the area?', type: 'freeform', correctAnswer: '6' },
    },
    steps: [
      { method: 'GET', path: '/api/config' },
      { method: 'GET', path: '/api/state?format=text' },
      { method: 'POST', path: '/api/task/answer', body: { answer: '6' } },
      { method: 'GET', path: '/api/task?format=text' },
    ],
  },
  {
    name: 'malformed config.json',
    config: '{ "objects": [',
    steps: [
      { method: 'GET', path: '/api/config' },
      { method: 'GET', path: '/api/state?format=text' },
      { method: 'GET', path: '/api/task?format=text' },
    ],
  },
  {
    name: 'no config.json',
    config: null,
    steps: [
      { method: 'GET', path: '/api/config' },
      { method: 'GET', path: '/api/task' },
    ],
  },
];

// Starts server.js + intersections.js copied from `serverDir` in a temporary
// folder with the given config (an object, a raw string, or null for none).
export async function startServer(serverDir, config) {
  const workDir = mkdtempSync(path.join(tmpdir(), 'learn-geometry-compat-'));
  copyFileSync(path.join(serverDir, 'server.js'), path.join(workDir, 'server.js'));
  copyFileSync(path.join(serverDir, 'intersections.js'), path.join(workDir, 'intersections.js'));
  if (config !== null) {
    writeFileSync(path.join(workDir, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  const port = 40000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: workDir,
    env: { ...process.env, PORT: String(port), NODE_PATH: path.join(repoRoot, 'node_modules'), IS_PRODUCTION: '' },
  });
  let output = '';
  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 10000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/listening on port (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`server exited (${code}):\n${output}`)));
  });
  return {
    baseUrl,
    output: () => output,
    stop: () => {
      child.kill();
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

export async function runSteps(baseUrl, steps) {
  const results = [];
  for (const step of steps) {
    const response = await fetch(`${baseUrl}${step.path}`, {
      method: step.method,
      headers: step.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: step.body === undefined ? undefined : JSON.stringify(step.body),
    });
    results.push({
      request: `${step.method} ${step.path}`,
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: await response.text(),
    });
  }
  return results;
}

export async function runScenarios(serverDir) {
  const recorded = [];
  for (const scenario of SCENARIOS) {
    const server = await startServer(serverDir, scenario.config);
    try {
      recorded.push({ name: scenario.name, responses: await runSteps(server.baseUrl, scenario.steps) });
    } finally {
      server.stop();
    }
  }
  return recorded;
}
