import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('playground is a three-step allowlisted explorer without arbitrary request inputs', async () => {
  const [page, selector, parameters] = await Promise.all([
    source('src/pages/admin/AdminTokensPage.tsx'),
    source('src/components/admin/api-tokens/ApiOperationSelector.tsx'),
    source('src/components/admin/api-tokens/ApiOperationParameters.tsx')
  ]);
  assert.match(page, /etapa/);
  assert.match(page, /operation/);
  assert.match(selector, /SearchCombobox/);
  assert.match(selector, /método|method/i);
  assert.doesNotMatch(parameters, /name="url"|name="method"|name="headers"|name="body"/);
});

test('console redacts authorization, limits output and copies curl with environment variable', async () => {
  const [consoleSource, formatting] = await Promise.all([
    source('src/components/admin/api-tokens/ApiRequestConsole.tsx'),
    source('src/components/admin/api-tokens/apiRequestFormatting.ts')
  ]);
  assert.match(consoleSource, /truncated|truncado/i);
  assert.match(consoleSource, /requestId/);
  assert.match(formatting, /\$FILTRO_API_TOKEN/);
  assert.doesNotMatch(formatting, /localStorage|sessionStorage/);
});

test('POST real exige confirmação antes de executar o teste', async () => {
  const page = await source('src/pages/admin/AdminTokensPage.tsx');
  assert.match(page, /selectedOperation\?\.method === 'POST'[\s\S]*?setPendingPostParameters\(values\);[\s\S]*?return;/);
  assert.match(page, /<ConfirmDialog[\s\S]*?open=\{Boolean\(pendingPostParameters\)\}[\s\S]*?title="Enviar operação POST\?"/);
  assert.match(page, /if \(values\) void executePlayground\(values\)/);
  assert.doesNotMatch(page, /window\.confirm/);
});
