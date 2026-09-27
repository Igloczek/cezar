import assert from 'node:assert/strict';
import test from 'node:test';
import { SKILL_DIRS } from '../../src/skills.js';

/**
 * The cockpit's "no skills yet" hint tells users which portable directories to use, from a
 * hand-copy of this list in the bundle (`SKILL_PROJECT_DIRS` in
 * packages/web/src/components/skill-empty-hint.tsx) — it runs in another process and cannot import
 * the server. Installed skill directories are discovered dynamically and need no entry here.
 *
 * So this pins the server's portable discovery order. If it fails, update the hint and this list.
 */
test('the project skill dirs the hint promises are the ones discovery actually scans', () => {
  assert.deepEqual(
    SKILL_DIRS.map((d) => d.dir),
    [
      // Named individually by the hint (`SKILL_PROJECT_DIRS`, same order).
      '.ai/cezar/skills',
      '.ai/skills',
    ],
  );
});
