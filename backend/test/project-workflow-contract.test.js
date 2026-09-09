import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('router de gestão fica sob autenticação do Efetivo e valida todas as entradas com Zod', () => {
  const parent = fs.readFileSync(new URL('../src/routes/resources/efetivo.js', import.meta.url), 'utf8');
  const router = fs.readFileSync(new URL('../src/routes/efetivo-project-workflow.js', import.meta.url), 'utf8');
  assert.ok(parent.indexOf('router.use(requireAuth)') < parent.indexOf("router.use('/project-workflow'"));
  assert.match(router, /schemas\.list\.parse\(req\.query\)/);
  assert.match(router, /schemas\.start\.parse\(req\.body\)/);
  assert.match(router, /schemas\.patch\.parse\(req\.body\)/);
  assert.match(router, /executionSchemas\.reportTargets\.parse\(req\.body\)/);
  assert.match(router, /executionSchemas\.deviationCreate\.parse\(req\.body\)/);
  assert.match(router, /executionSchemas\.deviationStatus\.parse\(req\.body\)/);
  assert.match(router, /requireEfetivoManager/);
  assert.match(router, /requireEfetivoViewer/);
});
