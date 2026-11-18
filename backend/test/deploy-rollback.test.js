import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

const deployScript = new URL('../../deploy/deploy-prod.sh', import.meta.url).pathname;
const drillScript = new URL('../../deploy/restore-drill.sh', import.meta.url).pathname;

const FAKE_DOCKER = `#!/usr/bin/env bash
args="$*"
echo "APP_GIT_SHA=\${APP_GIT_SHA:-} $args" >> "$FAKE_LOG"
state_file="$FAKE_ROOT/running-tag"
case "$args" in
  *"compose"*" ps -q "*) echo "cid-\${args##* }"; exit 0 ;;
  "inspect -f {{range .Config.Env}}"*) echo "APP_GIT_SHA=$FAKE_RUNNING_SHA"; exit 0 ;;
  "inspect -f {{.Image}}"*) echo "sha256:img-\${args##* }"; exit 0 ;;
  "inspect -f {{if .State.Health}}"*) echo healthy; exit 0 ;;
  "tag "*) exit 0 ;;
  "image inspect "*) [ "\${FAKE_NO_PREVIOUS:-}" = 1 ] && exit 1; exit 0 ;;
  "image ls "*) exit 0 ;;
  *"compose"*" config --services"*) printf 'postgres\\nbackend\\nworker\\nnginx\\n'; exit 0 ;;
  *"compose"*" build "*) [ "\${FAKE_FAIL_BUILD:-}" = 1 ] && exit 1; exit 0 ;;
  *"compose"*" up -d --wait"*)
    [ "\${FAKE_UP_NO_START:-}" = 1 ] || echo "$APP_GIT_SHA" > "$state_file"
    [ "\${FAKE_FAIL_UP:-}" = 1 ] && exit 1
    exit 0 ;;
  *"compose"*" up -d --no-build"*) echo "$APP_GIT_SHA" > "$state_file"; exit 0 ;;
  *"compose"*"exec -T backend node"*)
    running="$(cat "$state_file" 2>/dev/null || echo old)"
    if [ "\${FAKE_FAIL_NEW_HEALTH:-}" = 1 ] && [ "$running" != previous ] && [ "$running" != old ]; then exit 1; fi
    exit 0 ;;
  *"compose"*"exec -T nginx wget -q -O - "*) echo "{\\"version\\":\\"$(cat "$state_file" 2>/dev/null || echo old)\\"}"; exit 0 ;;
  *"compose"*"exec -T nginx wget"*) exit 0 ;;
esac
echo "unexpected docker call: $args" >&2
exit 0
`;

function runDeploy({ args = [], env = {}, dirty = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-prod-'));
  const project = path.join(root, 'project');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'docker.log');
  const backupLog = path.join(root, 'backup.log');
  fs.mkdirSync(project);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), FAKE_DOCKER);
  fs.chmodSync(path.join(bin, 'docker'), 0o755);
  const backup = path.join(root, 'backup.sh');
  fs.writeFileSync(backup, `#!/usr/bin/env bash\necho "INCLUDE_REPORTS=$INCLUDE_REPORTS B2_URI=$B2_URI BACKUP_ROOT=$BACKUP_ROOT" >> "${backupLog}"\necho "BACKUP" >> "${log}"\nexit \${FAKE_FAIL_BACKUP:-0}\n`);
  fs.chmodSync(backup, 0o755);

  const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: project, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'ci@example.com');
  git('config', 'user.name', 'CI');
  fs.writeFileSync(path.join(project, 'app.txt'), 'v1\n');
  git('add', 'app.txt');
  git('commit', '-q', '-m', 'v1');
  const sha = git('rev-parse', 'HEAD');
  if (dirty) fs.writeFileSync(path.join(project, 'app.txt'), 'local change\n');

  const statusFile = path.join(root, 'status', 'deploy-latest.json');
  const result = spawnSync('bash', [deployScript, ...args], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      PROJECT_DIR: project,
      STATE_DIR: path.join(root, 'state'),
      DEPLOY_STATUS_FILE: statusFile,
      ENV_FILE: path.join(root, 'missing.env'),
      BACKUP_CMD: backup,
      PRE_DEPLOY_BACKUP_ROOT: path.join(root, 'pre-deploy'),
      HEALTH_TIMEOUT_SECONDS: '1',
      HEALTH_INTERVAL_SECONDS: '1',
      FAKE_LOG: log,
      FAKE_ROOT: root,
      FAKE_RUNNING_SHA: 'a'.repeat(40),
      ...env
    },
    encoding: 'utf8'
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  const status = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : null;
  const backups = fs.existsSync(backupLog) ? fs.readFileSync(backupLog, 'utf8') : '';
  const currentSha = path.join(root, 'state', 'current-sha');
  const deployed = fs.existsSync(currentSha) ? fs.readFileSync(currentSha, 'utf8').trim() : null;
  fs.rmSync(root, { recursive: true, force: true });
  return { result, calls, status, backups, sha, deployed };
}

const indexOf = (calls, predicate) => calls.findIndex(predicate);

test('deploy tags the running images, builds the commit, dumps the database and verifies the new version', () => {
  const { result, calls, status, backups, sha, deployed } = runDeploy();
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const tagPrevious = indexOf(calls, call => call.includes('tag sha256:img-cid-backend filtrovali-backend:previous'));
  const build = indexOf(calls, call => call.startsWith(`APP_GIT_SHA=${sha} `) && call.includes(' build backend worker nginx'));
  const backup = calls.indexOf('BACKUP');
  const up = indexOf(calls, call => call.startsWith(`APP_GIT_SHA=${sha} `) && call.includes(' up -d --wait'));
  assert.ok(tagPrevious >= 0 && tagPrevious < build, 'running images must be tagged before the build');
  assert.ok(build < backup && backup < up, 'dump must happen after the build and before the stack changes');
  assert.match(backups, /INCLUDE_REPORTS=false B2_URI= /);
  assert.ok(!calls.some(call => call.includes('--no-build')), 'a healthy deploy must not roll back');
  assert.equal(status.status, 'SUCCESS');
  assert.equal(status.sha, sha);
  assert.equal(status.previousSha, 'a'.repeat(40));
  assert.ok(calls.some(call => call.endsWith(`tag filtrovali-nginx:${sha} filtrovali-nginx:latest`)),
    ':latest must follow the deployed commit');
  assert.equal(deployed, sha);
});

test('deploy rolls back to the previous images when the new version fails the post-deploy check', () => {
  const { result, calls, status, deployed } = runDeploy({ env: { FAKE_FAIL_NEW_HEALTH: '1' } });
  assert.equal(result.status, 1);
  const rollback = calls.find(call => call.includes(' up -d --no-build'));
  assert.ok(rollback, 'expected a rollback up');
  assert.match(rollback, /^APP_GIT_SHA=previous .* up -d --no-build --no-deps --force-recreate backend worker nginx$/);
  assert.equal(status.status, 'ROLLED_BACK');
  assert.ok(calls.some(call => call.endsWith('tag filtrovali-backend:previous filtrovali-backend:latest')));
  assert.equal(deployed, null);
});

test('deploy accepts a compose --wait error when the new version is actually healthy', () => {
  const { result, calls, status } = runDeploy({ env: { FAKE_FAIL_UP: '1' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(status.status, 'SUCCESS');
  assert.ok(!calls.some(call => call.includes(' up -d --no-build')));
});

test('deploy rolls back when compose up fails and the new version never comes up', () => {
  const { result, calls, status } = runDeploy({ env: { FAKE_FAIL_UP: '1', FAKE_UP_NO_START: '1' } });
  assert.equal(result.status, 1);
  assert.equal(status.status, 'ROLLED_BACK');
  assert.match(status.message, /docker compose up/);
  assert.ok(calls.some(call => call.includes(' up -d --no-build --no-deps --force-recreate backend worker nginx')));
});

test('a failed build changes nothing in production', () => {
  const { result, calls, status } = runDeploy({ env: { FAKE_FAIL_BUILD: '1' } });
  assert.equal(result.status, 1);
  assert.ok(!calls.some(call => call.includes(' up -d')), 'no service may be recreated after a failed build');
  assert.ok(!calls.includes('BACKUP'));
  assert.equal(status.status, 'FAILURE');
});

test('a failed pre-deploy dump stops the deploy before touching services', () => {
  const { result, calls, status } = runDeploy({ env: { FAKE_FAIL_BACKUP: '1' } });
  assert.equal(result.status, 1);
  assert.ok(!calls.some(call => call.includes(' up -d')));
  assert.equal(status.status, 'FAILURE');
});

test('deploy refuses a checkout with tracked local changes', () => {
  const { result, calls } = runDeploy({ dirty: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /precisa estar no Git/);
  assert.ok(!calls.some(call => call.includes(' build ')));
});

test('deploy reports a failure without previous images instead of guessing', () => {
  const { result, status } = runDeploy({ env: { FAKE_FAIL_NEW_HEALTH: '1', FAKE_NO_PREVIOUS: '1' } });
  assert.equal(result.status, 1);
  assert.equal(status.status, 'FAILURE');
  assert.match(status.message, /sem imagens :previous/);
});

test('manual rollback keeps a way back and switches without build or migrations', () => {
  const { result, calls, status } = runDeploy({ args: ['--rollback'] });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const keep = indexOf(calls, call => call.includes('filtrovali-backend:before-rollback'));
  const up = indexOf(calls, call => call.includes(' up -d --no-build --no-deps --force-recreate backend worker nginx'));
  assert.ok(keep >= 0 && keep < up);
  assert.ok(!calls.some(call => call.includes(' build ')));
  assert.equal(status.status, 'SUCCESS');
});

function writeBackup(dir, { sql = 'SELECT 1;', corruptChecksum = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const dump = zlib.gzipSync(sql);
  fs.writeFileSync(path.join(dir, 'postgres.sql.gz'), dump);
  const hash = crypto.createHash('sha256').update(corruptChecksum ? 'other' : dump).digest('hex');
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${hash}  ./postgres.sql.gz\n`);
}

const FAKE_DRILL_DOCKER = `#!/usr/bin/env bash
args="$*"
echo "$args" >> "$FAKE_LOG"
case "$args" in
  "run "*) echo container-id; exit 0 ;;
  "exec "*"pg_isready"*) exit 0 ;;
  "exec -i "*"-At"*) cat > /dev/null; echo "$FAKE_SANITY"; exit 0 ;;
  "exec -i "*) cat > /dev/null; exit 0 ;;
  "rm -f "*) exit 0 ;;
esac
exit 0
`;

function runDrill({ sanity = '262|12|40|300|5000|2026-11-17|20|1200 MB', backup = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-drill-'));
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'docker.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), FAKE_DRILL_DOCKER);
  fs.chmodSync(path.join(bin, 'docker'), 0o755);
  const source = path.join(root, 'backup');
  writeBackup(source, backup);
  const statusFile = path.join(root, 'status', 'restore-latest.json');
  const result = spawnSync('bash', [drillScript], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      RESTORE_DRILL_SOURCE: source,
      RESTORE_STATUS_FILE: statusFile,
      RESTORE_DRILL_WORK_ROOT: path.join(root, 'work'),
      // Se algum dia o docker real for chamado por engano, não há imagem para subir.
      RESTORE_DRILL_POSTGRES_IMAGE: 'filtrovali-test/fake-docker-only:never',
      FAKE_LOG: log,
      FAKE_SANITY: sanity
    },
    encoding: 'utf8'
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  const status = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : null;
  const leftovers = fs.existsSync(path.join(root, 'work')) ? fs.readdirSync(path.join(root, 'work')) : [];
  fs.rmSync(root, { recursive: true, force: true });
  return { result, calls, status, leftovers };
}

test('restore drill restores into an isolated throwaway container and publishes a SUCCESS status', () => {
  const { result, calls, status, leftovers } = runDrill();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(calls, /^run -d --rm --name filtrovali-restore-drill-\d+ --network none /m, 'the fake docker must be the one called');
  assert.doesNotMatch(calls, /compose/);
  assert.match(calls, /^rm -f filtrovali-restore-drill-/m);
  assert.equal(status.kind, 'restore-drill');
  assert.equal(status.status, 'SUCCESS');
  assert.equal(status.sanity.users, 12);
  assert.equal(status.sanity.reports, 5000);
  assert.equal(status.sanity.latestReportDate, '2026-11-17');
  assert.deepEqual(leftovers, []);
});

test('restore drill fails when the restored data is empty or stale', () => {
  const empty = runDrill({ sanity: '262|0|40|300|5000|2026-11-17|20|1 GB' });
  assert.equal(empty.result.status, 1);
  assert.equal(empty.status.status, 'FAILURE');
  assert.match(empty.status.message, /nenhum usuário/);

  const stale = runDrill({ sanity: '262|12|40|300|5000|2026-10-01|1200|1 GB' });
  assert.equal(stale.result.status, 1);
  assert.match(stale.status.message, /backup velho/);
});

test('restore drill rejects a backup whose checksum does not match before starting a database', () => {
  const { result, calls, status } = runDrill({ backup: { corruptChecksum: true } });
  assert.equal(result.status, 1);
  assert.doesNotMatch(calls, /^run /m);
  assert.equal(status.status, 'FAILURE');
});
