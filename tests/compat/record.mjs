// Records the compatibility baseline from an older server.js.
//
//   mkdir -p /tmp/old && git show <rev>:server.js > /tmp/old/server.js \
//     && git show <rev>:intersections.js > /tmp/old/intersections.js
//   node tests/compat/record.mjs /tmp/old tests/compat/baseline.json <rev>
//
// Only re-record when a change to default behavior is intended.
import { writeFileSync } from 'node:fs';
import { runScenarios } from './harness.mjs';

const [serverDir, outFile, revision = 'unknown'] = process.argv.slice(2);
if (!serverDir || !outFile) {
  console.error('usage: node tests/compat/record.mjs <server-dir> <out-file> [revision]');
  process.exit(1);
}

const scenarios = await runScenarios(serverDir);
writeFileSync(outFile, `${JSON.stringify({ recordedFrom: revision, scenarios }, null, 2)}\n`);
console.log(`recorded ${scenarios.length} scenarios from ${revision} into ${outFile}`);
