const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  computeIntersections,
  segmentLength,
  directionDeg,
  objectVertices,
  sideLengths,
  interiorAngles,
  sharedEndpointAngles,
  classifyPolygon,
  parallelSidePairs,
  perpendicularSidePairs,
  lineRelationships,
} = require('./intersections');

const app = express();
const port = Number(process.env.PORT) || 3000;
const configPath = path.join(__dirname, 'config.json');
const distPath = path.join(__dirname, 'dist');
// Declared before readConfig() first runs (just below) — see parseTools().
const DRAWING_TOOLS = ['point', 'line', 'circle', 'rectangle', 'polygon'];
const MEASUREMENT_MODES = ['all', 'selected', 'none'];

let state = { objects: readConfig().objects };
let submittedAnswer = '';

app.use(express.json({ limit: '1mb' }));

app.get('/api/config', (_request, response) => {
  const cfg = readConfig();
  response.json({
    objects: cfg.objects,
    sidebarOpen: cfg.sidebarOpen,
    viewCenter: cfg.viewCenter,
    tools: cfg.tools,
    showMeasurements: cfg.showMeasurements,
  });
});

app.get('/api/state', (request, response) => {
  const format = request.query.format === 'text' ? 'text' : 'json';

  if (format === 'text') {
    const lines = state.objects.map(summarizeObject);
    const relationships = describeRelationships(state.objects);
    if (relationships.length > 0) {
      lines.push('');
      lines.push(`Relationships (${relationships.length}):`);
      for (const relationship of relationships) {
        lines.push(`  ${relationship}`);
      }
    }
    const intersections = computeIntersections(state.objects);
    if (intersections.length > 0) {
      lines.push('');
      lines.push(`Intersections (${intersections.length}):`);
      for (const [x, y] of intersections) {
        lines.push(`  (${formatNumber(x)}, ${formatNumber(y)})`);
      }
    }
    response.type('text/plain').send(lines.join('\n'));
    return;
  }

  response.json(state.objects);
});

app.post('/api/state', (request, response) => {
  const objects = request.body?.objects;

  if (!Array.isArray(objects)) {
    response.status(400).json({ error: 'Expected body shape: { objects: GeomObject[] }' });
    return;
  }

  state = { objects };
  response.json({ ok: true, objects: state.objects });
});

app.get('/api/task', (request, response) => {
  const format = request.query.format === 'text' ? 'text' : 'json';
  const task = readConfig().task;

  if (format === 'text') {
    if (!task) {
      response.type('text/plain').send('(no task configured)');
      return;
    }
    const lines = [];
    lines.push(`Question: ${task.question}`);
    lines.push(`Type: ${task.type}`);
    if (task.type === 'multiple_choice') {
      lines.push(`Options: ${task.options.join(', ')}`);
    }
    lines.push(`Correct answer: ${task.correctAnswer}`);
    lines.push(`Learner's answer: ${submittedAnswer}`);
    response.type('text/plain').send(lines.join('\n'));
    return;
  }

  response.json({ task: task ?? null, submittedAnswer });
});

app.post('/api/task/answer', (request, response) => {
  const answer = request.body?.answer;

  if (typeof answer !== 'string') {
    response.status(400).json({ error: 'Expected body shape: { answer: string }' });
    return;
  }

  const task = readConfig().task;
  if (task && task.type === 'multiple_choice' && answer !== '' && !task.options.includes(answer)) {
    response.status(400).json({ error: 'Answer must be one of the configured options' });
    return;
  }

  submittedAnswer = answer;
  response.json({ ok: true, submittedAnswer });
});

if (process.env.IS_PRODUCTION === 'true') {
  app.use(express.static(distPath));
  app.get('*', (_request, response) => {
    response.sendFile(path.join(distPath, 'index.html'));
  });
}

const maxPortAttempts = 10;

function startServer(desiredPort, attemptsLeft) {
  const server = app.listen(desiredPort, () => {
    console.log(`learn-geometry server listening on port ${desiredPort}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const nextPort = desiredPort + 1;
      console.warn(`Port ${desiredPort} is already in use, trying port ${nextPort} instead...`);
      startServer(nextPort, attemptsLeft - 1);
      return;
    }

    if (error.code === 'EADDRINUSE') {
      console.error(`Unable to find a free port after ${maxPortAttempts} attempts (started at ${port}). Is another instance already running?`);
    } else {
      console.error(`Failed to start server: ${error.message}`);
    }
    process.exit(1);
  });
}

startServer(port, maxPortAttempts);

function readConfig() {
  try {
    if (!fs.existsSync(configPath)) {
      return { objects: [], task: null, sidebarOpen: false };
    }

    const contents = fs.readFileSync(configPath, 'utf8').trim();
    if (!contents) {
      return { objects: [], task: null, sidebarOpen: false };
    }

    const parsed = JSON.parse(contents);
    return normalizeConfig(parsed);
  } catch (error) {
    console.warn(`Unable to read config.json: ${error.message}`);
    return { objects: [], task: null };
  }
}

function normalizeConfig(value) {
  if (!value || typeof value !== 'object') {
    return { objects: [], task: null, sidebarOpen: false };
  }

  const objects = Array.isArray(value.objects) ? value.objects : [];
  const task = 'task' in value ? validateTask(value.task) : null;
  const sidebarOpen = typeof value.sidebarOpen === 'boolean' ? value.sidebarOpen : false;
  const viewCenter = parseViewCenter(value.viewCenter);
  const tools = parseTools(value.tools);
  const showMeasurements = parseMeasurementMode(value.showMeasurements);
  return { objects, task, sidebarOpen, viewCenter, tools, showMeasurements };
}

// `tools` lists which drawing tools the toolbar shows; Drag / Select is always
// shown. Omitted means every tool, as before.
function parseTools(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    console.warn('Config: "tools" must be an array of tool names — showing every tool');
    return undefined;
  }
  for (const tool of value) {
    if (!DRAWING_TOOLS.includes(tool)) {
      console.warn(`Config: unknown tool ${JSON.stringify(tool)} in "tools" — ignoring it`);
    }
  }
  return DRAWING_TOOLS.filter((tool) => value.includes(tool));
}

// Omitted means "none", so a config without the key behaves as before.
function parseMeasurementMode(value) {
  if (value === undefined) return 'none';
  if (!MEASUREMENT_MODES.includes(value)) {
    console.warn(`Config: "showMeasurements" must be one of ${MEASUREMENT_MODES.join(', ')} (got ${JSON.stringify(value)}) — using "none"`);
    return 'none';
  }
  return value;
}

function parseViewCenter(value) {
  if (!Array.isArray(value)) return undefined;
  if (value.length !== 2 && value.length !== 3) return undefined;
  if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) return undefined;
  const result = [value[0], value[1]];
  if (value.length === 3 && Number.isFinite(value[2]) && value[2] > 0) {
    result.push(value[2]);
  }
  return result;
}

function validateTask(task) {
  if (task === null || task === undefined) return null;
  if (typeof task !== 'object') {
    console.warn('Task validation: task must be an object — ignoring');
    return null;
  }
  if (typeof task.question !== 'string' || !task.question.trim()) {
    console.warn('Task validation: missing or empty "question" — ignoring');
    return null;
  }
  if (task.type !== 'freeform' && task.type !== 'multiple_choice') {
    console.warn(`Task validation: type must be "freeform" or "multiple_choice" (got ${JSON.stringify(task.type)}) — ignoring`);
    return null;
  }
  if (typeof task.correctAnswer !== 'string') {
    console.warn('Task validation: "correctAnswer" must be a string — ignoring');
    return null;
  }
  if (task.type === 'multiple_choice') {
    if (!Array.isArray(task.options) || task.options.length < 2 || task.options.length > 4) {
      console.warn('Task validation: multiple_choice "options" must be an array of 2–4 strings — ignoring');
      return null;
    }
    if (task.options.some((option) => typeof option !== 'string')) {
      console.warn('Task validation: multiple_choice "options" must all be strings — ignoring');
      return null;
    }
    if (!task.options.includes(task.correctAnswer)) {
      console.warn('Task validation: multiple_choice "correctAnswer" must be one of "options" — ignoring');
      return null;
    }
    return {
      question: task.question,
      type: 'multiple_choice',
      options: [...task.options],
      correctAnswer: task.correctAnswer,
    };
  }
  return {
    question: task.question,
    type: 'freeform',
    correctAnswer: task.correctAnswer,
  };
}

function summarizeObject(object) {
  if (!object || typeof object !== 'object') {
    return 'Unknown object';
  }

  const label = object.label ? ` (${object.label})` : '';
  const locked = object.locked ? ' [locked]' : '';

  switch (object.type) {
    case 'point':
      return `Point${label} at (${formatNumber(object.x)}, ${formatNumber(object.y)})${locked}`;
    case 'circle':
      return `Circle${label} at (${formatNumber(object.cx)}, ${formatNumber(object.cy)}) with radius ${formatNumber(object.r)}${locked}`;
    case 'line': {
      const start = [object.x1, object.y1];
      const end = [object.x2, object.y2];
      return `Line${label} from (${formatNumber(object.x1)}, ${formatNumber(object.y1)}) to (${formatNumber(object.x2)}, ${formatNumber(object.y2)}), length ${formatNumber(segmentLength(start, end))}, direction ${formatDegrees(directionDeg(start, end))}${locked}`;
    }
    case 'rectangle':
      return [
        `Rectangle${label} at (${formatNumber(object.x)}, ${formatNumber(object.y)}) with width ${formatNumber(object.w)}, height ${formatNumber(object.h)}, and ${formatRotation(object.rotation)}${locked}`,
        ...describeShape(objectVertices(object)),
      ].join('\n');
    case 'polygon':
      return [
        `Polygon${label} with points ${formatPoints(object.points)} and ${formatRotation(object.rotation)}${locked}`,
        ...describeShape(objectVertices(object)),
      ].join('\n');
    case 'function':
      return `Function${label}: y = ${object.expression}${locked}`;
    default:
      return `Unknown object${label}`;
  }
}

// Indented detail lines for a closed shape. Vertices are named A, B, C, … in
// drawing order (after rotation), and side AB runs from A to B.
function describeShape(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return [];
  const n = vertices.length;
  const sideName = (index) => `${vertexName(index)}${vertexName((index + 1) % n)}`;
  const sides = sideLengths(vertices);
  const angles = interiorAngles(vertices);
  const details = [
    `  Vertices: ${vertices.map((vertex, index) => `${vertexName(index)} ${formatPoint(vertex)}`).join(', ')}`,
    `  Sides: ${sides.map((side, index) => `${sideName(index)} = ${formatNumber(side)}`).join(', ')}`,
    `  Angles: ${angles.map((angle, index) => `${vertexName(index)} = ${formatDegrees(angle)}`).join(', ')}`,
    `  Shape: ${classifyPolygon(vertices)}`,
  ];
  const parallel = parallelSidePairs(vertices);
  if (parallel.length > 0) {
    details.push(`  Parallel sides: ${parallel.map(([i, j]) => `${sideName(i)} ∥ ${sideName(j)}`).join(', ')}`);
  }
  const perpendicular = perpendicularSidePairs(vertices);
  if (perpendicular.length > 0) {
    details.push(`  Perpendicular sides: ${perpendicular.map(([i, j]) => `${sideName(i)} ⊥ ${sideName(j)}`).join(', ')}`);
  }
  return details;
}

// Parallel / perpendicular line segments and angles where segments meet.
function describeRelationships(objects) {
  const out = [];
  for (const { a, b, kind } of lineRelationships(objects)) {
    const verb = kind === 'perpendicular' ? 'is perpendicular to' : kind === 'parallel' ? 'is parallel to' : 'is collinear with';
    out.push(`${lineRef(a)} ${verb} ${lineRef(b)}`);
  }
  for (const joint of sharedEndpointAngles(objects)) {
    const a = objects.find((object) => object.id === joint.lineIds[0]);
    const b = objects.find((object) => object.id === joint.lineIds[1]);
    out.push(`Angle between ${lineRef(a)} and ${lineRef(b)} at ${formatPoint(joint.vertex)}: ${formatDegrees(joint.degrees)}`);
  }
  return out;
}

function lineRef(line) {
  if (line.label) return `Line (${line.label})`;
  return `Line from (${formatNumber(line.x1)}, ${formatNumber(line.y1)}) to (${formatNumber(line.x2)}, ${formatNumber(line.y2)})`;
}

function vertexName(index) {
  return index < 26 ? String.fromCharCode(65 + index) : `V${index + 1}`;
}

function formatPoint(point) {
  return `(${formatNumber(point[0])}, ${formatNumber(point[1])})`;
}

function formatDegrees(degrees) {
  return Number.isFinite(degrees) ? `${formatNumber(degrees)}°` : 'undefined';
}

function formatRotation(rotation) {
  const radians = Number(rotation);
  const normalizedRadians = Number.isFinite(radians) ? radians : 0;
  const degrees = normalizedRadians * 180 / Math.PI;
  return `rotation ${formatNumber(normalizedRadians)} radians (${formatNumber(degrees)} degrees)`;
}

function formatPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return 'none';
  }

  return points.map((point) => `(${formatNumber(point?.[0])}, ${formatNumber(point?.[1])})`).join(', ');
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }

  const text = Number.isInteger(number) ? String(number) : number.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  // Tiny negatives such as -1e-16 from rotation math would otherwise print as "-0".
  return text === '-0' ? '0' : text;
}
