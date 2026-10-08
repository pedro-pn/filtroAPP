import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const installScript = fileURLToPath(new URL('../../deploy/npm-ci.sh', import.meta.url));

function runInstall(t, failures) {
  const directory = mkdtempSync(path.join(tmpdir(), 'filtrovali-npm-ci-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'failures.json'), JSON.stringify(failures));
  writeFileSync(path.join(directory, 'npm'), `#!/bin/sh
exec "$TEST_NODE" "$TEST_DIRECTORY/npm-mock.cjs" "$@"
`, { mode: 0o755 });
  writeFileSync(path.join(directory, 'npm-mock.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.TEST_DIRECTORY;
const attemptsFile = path.join(dir, 'attempts');
const attempt = fs.existsSync(attemptsFile) ? Number(fs.readFileSync(attemptsFile, 'utf8')) + 1 : 1;
fs.writeFileSync(attemptsFile, String(attempt));
fs.appendFileSync(path.join(dir, 'arguments'), JSON.stringify(process.argv.slice(2)) + '\\n');
const failure = JSON.parse(fs.readFileSync(path.join(dir, 'failures.json'), 'utf8'))[attempt - 1];
if (failure) {
  console.error(failure.message);
  process.exit(failure.status);
}
console.log('dependencies installed');
`);
  writeFileSync(path.join(directory, 'sleep'), `#!/bin/sh
echo "$1" >> "$TEST_DIRECTORY/delays"
`, { mode: 0o755 });

  const result = spawnSync('sh', [installScript], {
    cwd: directory,
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      TEST_NODE: process.execPath,
      TEST_DIRECTORY: directory,
      TMPDIR: directory,
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.ifError(result.error);
  return {
    ...result,
    attempts: Number(readFileSync(path.join(directory, 'attempts'), 'utf8')),
    arguments: readFileSync(path.join(directory, 'arguments'), 'utf8').trim().split('\n').map(JSON.parse),
    delays: existsSync(path.join(directory, 'delays'))
      ? readFileSync(path.join(directory, 'delays'), 'utf8').trim().split('\n')
      : [],
  };
}

test('Docker npm install succeeds on the first attempt', (t) => {
  const result = runInstall(t, []);
  assert.equal(result.status, 0);
  assert.equal(result.attempts, 1);
  assert.equal(result.arguments[0][0], 'ci');
  assert.deepEqual(result.delays, []);
  assert.match(result.stdout, /dependencies installed/);
  assert.doesNotMatch(result.stderr, /retrying/);
});

for (const prefix of ['npm error', 'npm ERR!']) {
  test(`Docker npm install recovers from a connection reset (${prefix})`, (t) => {
    const result = runInstall(t, [{ message: `${prefix} code ECONNRESET\nnetwork aborted`, status: 1 }]);
    assert.equal(result.status, 0);
    assert.equal(result.attempts, 2);
    assert.deepEqual(result.delays, ['10']);
    assert.ok(result.arguments.every(([command]) => command === 'ci'));
    assert.match(result.stderr, /ECONNRESET/);
    assert.match(result.stderr, /retrying in 10s/);
    assert.match(result.stdout, /dependencies installed/);
  });
}

test('Docker npm install stops after three network failures and preserves the exit status', (t) => {
  const result = runInstall(t, Array(3).fill({ message: 'npm error code ETIMEDOUT', status: 7 }));
  assert.equal(result.status, 7);
  assert.equal(result.attempts, 3);
  assert.deepEqual(result.delays, ['10', '20']);
  assert.match(result.stderr, /retrying in 10s/);
  assert.match(result.stderr, /retrying in 20s/);
  assert.doesNotMatch(result.stderr, /retrying in 30s/);
});

for (const code of ['EUSAGE', 'ERESOLVE', 'E401', 'EINTEGRITY']) {
  test(`Docker npm install fails immediately for ${code}`, (t) => {
    const result = runInstall(t, [{ message: `npm error code ${code}`, status: 2 }]);
    assert.equal(result.status, 2);
    assert.equal(result.attempts, 1);
    assert.deepEqual(result.delays, []);
    assert.match(result.stderr, new RegExp(code));
    assert.doesNotMatch(result.stderr, /retrying/);
  });
}

test('Docker npm install stops when a retry encounters a dependency error', (t) => {
  const result = runInstall(t, [
    { message: 'npm error code ECONNRESET', status: 1 },
    { message: 'npm error code ERESOLVE', status: 2 },
  ]);
  assert.equal(result.status, 2);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.delays, ['10']);
  assert.match(result.stderr, /ERESOLVE/);
  assert.doesNotMatch(result.stderr, /retrying in 20s/);
});
