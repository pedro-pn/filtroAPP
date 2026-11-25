import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

import { MAP_FILE, checkDocsSync, globToRegExp, optOutReason } from './check-docs-sync.mjs';

const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);

test('globs: ** cobre zero ou mais pastas, * não atravessa pastas', () => {
  assert.ok(globToRegExp('deploy/**/*.sh').test('deploy/backup-prod.sh'));
  assert.ok(globToRegExp('deploy/**/*.sh').test('deploy/db/test-anonymize-staging.sh'));
  assert.ok(globToRegExp('docs/DATABOOK_*.md').test('docs/DATABOOK_POR_PROPOSTA.md'));
  assert.ok(!globToRegExp('deploy/*.md').test('deploy/nginx/README.md'));
  assert.ok(!globToRegExp('backend/src/lib/projects/crm-*.js').test('backend/src/lib/projects/crm/x.js'));
});

test('código de um tema sem a documentação dele reprova; com a documentação, passa', () => {
  const code = ['backend/src/lib/conecta-rh/sync.js'];
  assert.equal(checkDocsSync(code, '', map).ok, false);
  assert.deepEqual(checkDocsSync(code, '', map).missing.map(item => item.name), ['Conecta RH']);
  assert.equal(checkDocsSync([...code, 'docs/INTEGRACAO_CONECTA_RH.md'], '', map).ok, true);
  assert.equal(checkDocsSync(['frontend/src/App.tsx', 'backend/src/lib/epi/x.js'], '', map).missing.length, 0);
});

test('arquivo ignorado do tema não exige documentação', () => {
  assert.equal(checkDocsSync(['backend/src/lib/api-credentials/data-catalog.js'], '', map).missing.length, 0);
  assert.equal(checkDocsSync(['backend/src/lib/api-credentials/catalog.js'], '', map).ok, false);
});

test('a dispensa exige a linha com motivo na descrição do PR', () => {
  const code = ['backend/src/lib/databook/service.js'];
  assert.equal(checkDocsSync(code, 'Documentação: não se aplica — só refatora, sem mudar o PDF', map).ok, true);
  assert.equal(checkDocsSync(code, '- **Documentação:** nao se aplica - correção interna de cache', map).ok, true);
  assert.equal(checkDocsSync(code, 'Documentação: não se aplica — ok', map).ok, false, 'motivo curto demais');
  assert.equal(checkDocsSync(code, 'documentação não muda', map).ok, false);
  assert.equal(checkDocsSync(code, 'Documentação: não se aplica — <motivo do modelo do PR>', map).ok, false, 'placeholder do modelo');
  assert.equal(optOutReason('Documentação: não se aplica — teste de unidade novo'), 'teste de unidade novo');
});

test('o mapa só aponta para código e documentação que existem', () => {
  for (const rule of map.rules) {
    for (const key of ['code', 'docs', 'ignore']) {
      for (const glob of rule[key] || []) {
        const pattern = globToRegExp(glob);
        assert.ok(tracked.some(file => pattern.test(file)), `${rule.name}: ${key} "${glob}" não casa com nenhum arquivo`);
      }
    }
  }
});
