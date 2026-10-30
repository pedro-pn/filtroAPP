import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

test('planning helpers used by the frontend load without backend packages', async () => {
  const allocations = new URL('../../backend/src/lib/efetivo/planning/allocations.js', import.meta.url).href;
  const missionTeam = new URL('../../backend/src/lib/efetivo/planning/mission-team.js', import.meta.url).href;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', `
    import { registerHooks, isBuiltin } from 'node:module';
    import assert from 'node:assert/strict';
    registerHooks({
      resolve(specifier, context, nextResolve) {
        assert.ok(isBuiltin(specifier) || /^(?:\\.{1,2}\\/|\\/|file:)/.test(specifier),
          'Planning helpers must not load an external package: ' + specifier);
        return nextResolve(specifier, context);
      }
    });
    assert.equal(typeof (await import(${JSON.stringify(allocations)})).allocateCollaboratorInTransaction, 'function');
    assert.equal(typeof (await import(${JSON.stringify(missionTeam)})).resolveSelectedMissionTeam, 'function');
  `], { encoding: 'utf8', timeout: 10000, env });
});
