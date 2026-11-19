import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Regressão do ensaio de volta de 2026-11-19: `--rollback` seguido de
// `--rollback-to before-rollback` deixou a produção na versão antiga, porque o
// script remarcava a imagem em execução como :before-rollback antes de ler o
// destino. Este Docker falso guarda marcações, imagens e containers em arquivos,
// para que a sequência real de comandos seja reproduzida entre execuções.

const deployScript = new URL('../../deploy/deploy-prod.sh', import.meta.url).pathname;

const OLD = 'a'.repeat(40);
const CURRENT = 'b'.repeat(40);
const SERVICES = ['backend', 'worker', 'nginx'];

const STATEFUL_DOCKER = `#!/usr/bin/env bash
S="$FAKE_ROOT/docker"
args="$*"
echo "APP_GIT_SHA=\${APP_GIT_SHA:-} $args" >> "$FAKE_ROOT/docker.log"
ref_file() { printf '%s/tags/%s' "$S" "$(printf '%s' "$1" | tr '/:' '__')"; }
resolve() { case "$1" in sha256:*) printf '%s' "$1" ;; *) f="$(ref_file "$1")"; [ -f "$f" ] && cat "$f" ;; esac; }
sha_of_image() { printf '%s' "\${1#sha256:img-}"; }
running_image() { cat "$S/running/$1" 2>/dev/null; }
last="\${@: -1}"
case "$args" in
  *"compose"*" ps -q "*) echo "cid-\${args##* }"; exit 0 ;;
  "inspect -f {{range .Config.Env}}"*) echo "APP_GIT_SHA=$(sha_of_image "$(running_image "\${last#cid-}")")"; exit 0 ;;
  "inspect -f {{.Image}}"*) running_image "\${last#cid-}"; echo; exit 0 ;;
  "inspect -f {{if .State.Health}}"*) echo healthy; exit 0 ;;
  "tag "*) id="$(resolve "$2")"; [ -n "$id" ] || exit 1; printf '%s' "$id" > "$(ref_file "$3")"; exit 0 ;;
  "image inspect -f "*) id="$(resolve "$last")"; [ -n "$id" ] || exit 1; echo "APP_GIT_SHA=$(sha_of_image "$id")"; exit 0 ;;
  "image inspect "*) [ -n "$(resolve "$last")" ] || exit 1; exit 0 ;;
  "image ls "*) exit 0 ;;
  *"compose"*" config --services"*) printf 'postgres\\nbackend\\nworker\\nnginx\\n'; exit 0 ;;
  *"compose"*" up -d --no-build"*)
    for svc in backend worker nginx; do
      id="$(resolve "filtrovali-$svc:$APP_GIT_SHA")"; [ -n "$id" ] || exit 1
      printf '%s' "$id" > "$S/running/$svc"
    done
    exit 0 ;;
  *"compose"*"exec -T backend node"*)
    # Último argumento: o commit esperado (vazio = só conferir que responde).
    [ -z "$last" ] || [ "$last" = "$(sha_of_image "$(running_image backend)")" ] || exit 1
    exit 0 ;;
  *"compose"*"exec -T nginx wget -q -O - "*) echo "{\\"version\\":\\"$(sha_of_image "$(running_image nginx)")\\"}"; exit 0 ;;
  *"compose"*"exec -T nginx wget"*) exit 0 ;;
esac
echo "unexpected docker call: $args" >&2
exit 0
`;

function createServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-rollback-tags-'));
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'docker');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(state, 'tags'), { recursive: true });
  fs.mkdirSync(path.join(state, 'running'), { recursive: true });
  fs.mkdirSync(path.join(root, 'project'));
  fs.writeFileSync(path.join(bin, 'docker'), STATEFUL_DOCKER);
  fs.chmodSync(path.join(bin, 'docker'), 0o755);
  fs.writeFileSync(path.join(bin, 'curl'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(bin, 'curl'), 0o755);

  const tag = (svc, name, sha) => fs.writeFileSync(path.join(state, 'tags', `filtrovali-${svc}_${name}`), `sha256:img-${sha}`);
  for (const svc of SERVICES) {
    tag(svc, OLD, OLD);
    tag(svc, CURRENT, CURRENT);
    tag(svc, 'previous', OLD);
    tag(svc, 'latest', CURRENT);
    fs.writeFileSync(path.join(state, 'running', svc), `sha256:img-${CURRENT}`);
  }

  const run = (...args) => {
    const statusFile = path.join(root, 'status', 'deploy-latest.json');
    const result = spawnSync('bash', [deployScript, ...args], {
      cwd: path.join(root, 'project'),
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
        DOCKER_HOST: 'unix:///nonexistent/filtrovali-test-docker.sock',
        PROJECT_DIR: path.join(root, 'project'),
        STATE_DIR: path.join(root, 'state'),
        DEPLOY_STATUS_FILE: statusFile,
        ENV_FILE: path.join(root, 'missing.env'),
        MAINTENANCE_DIR: path.join(root, 'maintenance'),
        DEPLOY_NOTIFY_ENV_FILE: path.join(root, 'missing-notify.env'),
        HEALTH_TIMEOUT_SECONDS: '1',
        HEALTH_INTERVAL_SECONDS: '1',
        FAKE_ROOT: root,
        TELEGRAM_TOKEN: '',
        TELEGRAM_CHAT_ID: ''
      },
      encoding: 'utf8'
    });
    const status = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : null;
    return { result, status };
  };
  const running = svc => fs.readFileSync(path.join(state, 'running', svc), 'utf8').replace('sha256:img-', '');
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { run, running, tag, cleanup };
}

test('--rollback then --rollback-to before-rollback returns to the version that was live', () => {
  const server = createServer();
  try {
    const back = server.run('--rollback');
    assert.equal(back.result.status, 0, back.result.stderr || back.result.stdout);
    for (const svc of SERVICES) assert.equal(server.running(svc), OLD, `${svc} must run the previous version`);
    assert.equal(back.status.sha, OLD, 'status must record the commit, not the tag');
    assert.match(back.result.stdout, new RegExp(`--rollback-to ${CURRENT}`), 'undo hint must name the exact commit');

    const forward = server.run('--rollback-to', 'before-rollback');
    assert.equal(forward.result.status, 0, forward.result.stderr || forward.result.stdout);
    for (const svc of SERVICES) assert.equal(server.running(svc), CURRENT, `${svc} must be back on the live version`);
    assert.equal(forward.status.status, 'SUCCESS');
    assert.equal(forward.status.sha, CURRENT);
  } finally {
    server.cleanup();
  }
});

test('a rollback to the commit that is already live is refused and changes nothing', () => {
  const server = createServer();
  try {
    const same = server.run('--rollback-to', CURRENT);
    assert.equal(same.result.status, 1);
    assert.match(same.result.stderr, /já está no ar/);
    for (const svc of SERVICES) assert.equal(server.running(svc), CURRENT);
  } finally {
    server.cleanup();
  }
});

test('the post-switch check requires the target commit, so a mismatched image fails the rollback', () => {
  const server = createServer();
  try {
    // :previous do nginx aponta por engano para a versão atual: o frontend não
    // muda de commit e a conferência precisa reprovar a volta.
    server.tag('nginx', 'previous', CURRENT);
    const back = server.run('--rollback');
    assert.equal(back.result.status, 1, back.result.stdout);
    assert.equal(back.status.status, 'FAILURE');
    assert.match(back.result.stdout, /não passou na conferência/);
  } finally {
    server.cleanup();
  }
});
