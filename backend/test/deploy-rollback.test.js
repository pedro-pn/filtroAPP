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
    [ -f "$FAKE_ROOT/maintenance/on" ] && echo "MAINTENANCE_ON_AT_UP" >> "$FAKE_LOG"
    [ "\${FAKE_UP_NO_START:-}" = 1 ] || echo "$APP_GIT_SHA" > "$state_file"
    [ "\${FAKE_FAIL_UP:-}" = 1 ] && exit 1
    exit 0 ;;
  *"compose"*" up -d --no-build"*) echo "$APP_GIT_SHA" > "$state_file"; exit 0 ;;
  *"compose"*"exec -T backend node"*)
    running="$(cat "$state_file" 2>/dev/null || echo old)"
    if [ "\${FAKE_FAIL_NEW_HEALTH:-}" = 1 ] && [ "$running" != previous ] && [ "$running" != old ]; then exit 1; fi
    exit 0 ;;
  *"compose"*"exec -T postgres psql"*)
    [ -n "\${FAKE_FAIL_PSQL:-}" ] && exit 1
    [ -f "$FAKE_ROOT/maintenance/on" ] && echo "maintenance-on-during-psql" >> "$FAKE_LOG"
    printf '%b' "\${FAKE_APPLIED_MIGRATIONS:-}"; exit 0 ;;
  *"compose"*"exec -T nginx wget -q -O - "*) echo "{\\"version\\":\\"$(cat "$state_file" 2>/dev/null || echo old)\\"}"; exit 0 ;;
  *"compose"*"exec -T nginx wget"*) exit 0 ;;
esac
echo "unexpected docker call: $args" >&2
exit 0
`;

function runDeploy({ args = [], env = {}, dirty = false, notifyEnv = null, migrations = [], maintenanceAlreadyOn = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-prod-'));
  const project = path.join(root, 'project');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'docker.log');
  const curlLog = path.join(root, 'curl.log');
  const backupLog = path.join(root, 'backup.log');
  fs.mkdirSync(project);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), FAKE_DOCKER);
  fs.chmodSync(path.join(bin, 'docker'), 0o755);
  // curl falso: registra a chamada do aviso de deploy sem sair para a rede.
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${curlLog}"\nexit \${FAKE_FAIL_CURL:-0}\n`);
  fs.chmodSync(path.join(bin, 'curl'), 0o755);
  const notifyEnvFile = path.join(root, 'notify.env');
  if (notifyEnv !== null) fs.writeFileSync(notifyEnvFile, notifyEnv);
  const backup = path.join(root, 'backup.sh');
  fs.writeFileSync(backup, `#!/usr/bin/env bash\necho "INCLUDE_REPORTS=$INCLUDE_REPORTS B2_URI=$B2_URI BACKUP_ROOT=$BACKUP_ROOT" >> "${backupLog}"\necho "BACKUP" >> "${log}"\nexit \${FAKE_FAIL_BACKUP:-0}\n`);
  fs.chmodSync(backup, 0o755);

  const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: project, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'ci@example.com');
  git('config', 'user.name', 'CI');
  fs.writeFileSync(path.join(project, 'app.txt'), 'v1\n');
  for (const name of migrations) {
    const dir = path.join(project, 'backend', 'prisma', 'migrations', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'migration.sql'), 'SELECT 1;\n');
  }
  const maintenanceDir = path.join(root, 'maintenance');
  if (maintenanceAlreadyOn) {
    fs.mkdirSync(maintenanceDir, { recursive: true });
    fs.writeFileSync(path.join(maintenanceDir, 'on'), 'manual\n');
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'v1');
  const sha = git('rev-parse', 'HEAD');
  if (dirty) fs.writeFileSync(path.join(project, 'app.txt'), 'local change\n');

  const statusFile = path.join(root, 'status', 'deploy-latest.json');
  const result = spawnSync('bash', [deployScript, ...args], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      // Guarda extra: se o docker real for chamado por engano, ele não alcança daemon nenhum.
      DOCKER_HOST: 'unix:///nonexistent/filtrovali-test-docker.sock',
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
      DEPLOY_NOTIFY_ENV_FILE: notifyEnvFile,
      MAINTENANCE_DIR: maintenanceDir,
      TELEGRAM_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      TELEGRAM_API_URL: 'https://telegram.invalid',
      ...env
    },
    encoding: 'utf8'
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  const status = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : null;
  const backups = fs.existsSync(backupLog) ? fs.readFileSync(backupLog, 'utf8') : '';
  const currentSha = path.join(root, 'state', 'current-sha');
  const deployed = fs.existsSync(currentSha) ? fs.readFileSync(currentSha, 'utf8').trim() : null;
  const maintenanceLeftOn = fs.existsSync(path.join(maintenanceDir, 'on'));
  const notifications = fs.existsSync(curlLog) ? fs.readFileSync(curlLog, 'utf8').trim().split('\n').filter(Boolean) : [];
  fs.rmSync(root, { recursive: true, force: true });
  return { result, calls, status, backups, sha, deployed, notifications, maintenanceLeftOn };
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

const MIGRATIONS = ['20260101000000_old', '20261120000000_new'];

test('pending migrations turn the maintenance page on for the switch and off after a healthy deploy', () => {
  const { result, calls, maintenanceLeftOn } = runDeploy({
    migrations: MIGRATIONS,
    env: { FAKE_APPLIED_MIGRATIONS: '20260101000000_old\\n' }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /migrations pendentes \(1\): 20261120000000_new/);
  assert.ok(calls.includes('MAINTENANCE_ON_AT_UP'), 'maintenance must be on while the stack is replaced');
  assert.ok(!calls.includes('maintenance-on-during-psql'), 'maintenance only turns on after the check');
  assert.equal(maintenanceLeftOn, false);
});

test('without pending migrations the deploy keeps the site open', () => {
  const { result, calls, maintenanceLeftOn } = runDeploy({
    migrations: MIGRATIONS,
    env: { FAKE_APPLIED_MIGRATIONS: '20260101000000_old\\n20261120000000_new\\n' }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /nenhuma migration pendente/);
  assert.ok(!calls.includes('MAINTENANCE_ON_AT_UP'));
  assert.equal(maintenanceLeftOn, false);
});

test('an unreadable migration table turns maintenance on; a rollback still turns it off', () => {
  const { result, status, calls, maintenanceLeftOn } = runDeploy({
    migrations: MIGRATIONS,
    env: { FAKE_FAIL_PSQL: '1', FAKE_FAIL_NEW_HEALTH: '1' }
  });
  assert.equal(result.status, 1);
  assert.equal(status.status, 'ROLLED_BACK');
  assert.ok(calls.includes('MAINTENANCE_ON_AT_UP'));
  assert.equal(maintenanceLeftOn, false, 'the trap must clear the flag after a rollback');
});

test('--maintenance forces the page on, --no-maintenance skips it, and a manual flag is left alone', () => {
  const forced = runDeploy({ args: ['--maintenance'] });
  assert.equal(forced.result.status, 0, forced.result.stderr || forced.result.stdout);
  assert.ok(forced.calls.includes('MAINTENANCE_ON_AT_UP'));
  assert.equal(forced.maintenanceLeftOn, false);

  const skipped = runDeploy({ args: ['--no-maintenance'], migrations: MIGRATIONS });
  assert.ok(!skipped.calls.includes('MAINTENANCE_ON_AT_UP'));

  const manual = runDeploy({ migrations: MIGRATIONS, maintenanceAlreadyOn: true });
  assert.equal(manual.result.status, 0, manual.result.stderr || manual.result.stdout);
  assert.match(manual.result.stdout, /já estava ligada/);
  assert.equal(manual.maintenanceLeftOn, true, 'a maintenance window opened by hand stays open');
});

test('failing to create the maintenance flag never blocks the deploy', () => {
  const { result, status } = runDeploy({ args: ['--maintenance'], env: { MAINTENANCE_DIR: '/proc/filtrovali-no-write' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /não foi possível ligar a página de manutenção/);
  assert.equal(status.status, 'SUCCESS');
});

const NOTIFY_ENV = 'POSTGRES_PASSWORD=nao-deve-vazar\nexport TELEGRAM_TOKEN="123:abc"\nTELEGRAM_CHAT_ID=-100777\n';

test('a rollback after a failed deploy is announced on Telegram with only the two Telegram keys', () => {
  const { result, status, notifications } = runDeploy({ env: { FAKE_FAIL_NEW_HEALTH: '1' }, notifyEnv: NOTIFY_ENV });
  assert.equal(result.status, 1);
  assert.equal(status.status, 'ROLLED_BACK');
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /--max-time 15/);
  assert.match(notifications[0], /https:\/\/telegram\.invalid\/bot123:abc\/sendMessage/);
  assert.match(notifications[0], /chat_id=-100777/);
  assert.match(notifications[0], /voltou para aaaaaaaaaaaa/);
  assert.doesNotMatch(notifications[0], /nao-deve-vazar/);
});

test('a failed build is announced; a healthy deploy is silent unless DEPLOY_NOTIFY_SUCCESS=true', () => {
  const failed = runDeploy({ env: { FAKE_FAIL_BUILD: '1' }, notifyEnv: NOTIFY_ENV });
  assert.equal(failed.status.status, 'FAILURE');
  assert.equal(failed.notifications.length, 1);
  assert.match(failed.notifications[0], /build falhou/);

  const quiet = runDeploy({ notifyEnv: NOTIFY_ENV });
  assert.equal(quiet.result.status, 0, quiet.result.stderr || quiet.result.stdout);
  assert.deepEqual(quiet.notifications, []);

  const loud = runDeploy({ env: { DEPLOY_NOTIFY_SUCCESS: 'true' }, notifyEnv: NOTIFY_ENV });
  assert.equal(loud.notifications.length, 1);
  assert.match(loud.notifications[0], new RegExp(loud.sha));
});

test('a Telegram failure or missing credentials never change the deploy result', () => {
  const curlDown = runDeploy({ env: { FAKE_FAIL_CURL: '7', DEPLOY_NOTIFY_SUCCESS: 'true' }, notifyEnv: NOTIFY_ENV });
  assert.equal(curlDown.result.status, 0, curlDown.result.stderr || curlDown.result.stdout);
  assert.equal(curlDown.status.status, 'SUCCESS');
  assert.match(curlDown.result.stdout, /não foi possível enviar o aviso/);

  const noCredentials = runDeploy({ env: { FAKE_FAIL_NEW_HEALTH: '1' } });
  assert.equal(noCredentials.status.status, 'ROLLED_BACK');
  assert.deepEqual(noCredentials.notifications, []);
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
      // Guarda extra: se o docker real for chamado por engano, ele não alcança daemon nenhum.
      DOCKER_HOST: 'unix:///nonexistent/filtrovali-test-docker.sock',
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
