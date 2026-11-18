import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

// Os scripts de deploy são executados direto no servidor (`deploy/deploy-prod.sh`,
// cron do backup e do ensaio de restauração). Sem o bit de execução no Git, o
// checkout do servidor recebe 100644 e o comando falha com "Permission denied".
const repoRoot = new URL('../../', import.meta.url).pathname;

function trackedShellScripts() {
  const output = execFileSync('git', ['ls-files', '-s', '--', 'deploy'], { cwd: repoRoot, encoding: 'utf8' });
  return output
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [meta, file] = line.split('\t');
      return { mode: meta.split(' ')[0], file };
    })
    .filter(entry => entry.file.endsWith('.sh'));
}

test('every deploy/**/*.sh is executable in git', () => {
  const scripts = trackedShellScripts();
  assert.ok(scripts.length >= 5, 'expected deploy scripts to be tracked');
  const notExecutable = scripts.filter(entry => entry.mode !== '100755').map(entry => entry.file);
  assert.deepEqual(notExecutable, [], `scripts sem +x no Git: ${notExecutable.join(', ')}`);
});
