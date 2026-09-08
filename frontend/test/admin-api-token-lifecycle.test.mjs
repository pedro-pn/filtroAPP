import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('lifecycle UI has filters, warnings, justified confirmations and lineage', async () => {
  const [page, cards, actions, activity] = await Promise.all([
    source('src/pages/admin/AdminTokensPage.tsx'),
    source('src/components/admin/api-tokens/ApiCredentialCards.tsx'),
    source('src/components/admin/api-tokens/ApiCredentialActions.tsx'),
    source('src/components/admin/api-tokens/ApiCredentialActivity.tsx')
  ]);
  assert.match(page, /status/);
  assert.match(page, /expiresBefore/);
  assert.match(page, /scope/);
  assert.match(cards, /replacementId|rotatedFromId/);
  assert.match(actions, /ConfirmDialog/);
  assert.match(actions, /justificativa|reason/i);
  assert.match(actions, /sobreposição/i);
  assert.match(activity, /eventos|histórico/i);
  assert.doesNotMatch(activity, /Authorization|responseBody|requestBody/);
});
