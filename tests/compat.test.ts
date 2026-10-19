// Existing tasks must keep working unchanged: with a config that uses none of
// the newer keys, every API response has to match what the previous server
// returned (tests/compat/baseline.json, recorded from the commit named in its
// `recordedFrom`). See tests/compat/record.mjs to re-record after an
// intentional change to default behavior.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCENARIOS, runSteps, startServer } from './compat/harness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(path.join(repoRoot, 'tests/compat/baseline.json'), 'utf8'));

describe(`API responses match the baseline from ${baseline.recordedFrom}`, () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const expected = baseline.scenarios.find((recorded: { name: string }) => recorded.name === scenario.name);
      expect(expected, 'scenario missing from baseline.json — re-record it').toBeDefined();
      const server = await startServer(repoRoot, scenario.config);
      try {
        const actual = await runSteps(server.baseUrl, scenario.steps);
        actual.forEach((response: { request: string }, index: number) => {
          expect(response, response.request).toEqual(expected.responses[index]);
        });
      } finally {
        server.stop();
      }
    });
  }
});
