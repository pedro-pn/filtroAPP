import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('credential form uses RHF, shared Zod, scope dependencies and accessible errors', async () => {
  const [form, scopes] = await Promise.all([
    source('src/components/admin/api-tokens/ApiCredentialForm.tsx'),
    source('src/components/admin/api-tokens/ApiScopeCatalog.tsx')
  ]);
  assert.match(form, /useForm/);
  assert.match(form, /makeApiCredentialSchemas/);
  assert.match(form, /NEVER_EXPIRES_CONFIRMATION/);
  assert.match(form, /aria-invalid/);
  assert.match(form, /field-group.*field-invalid|field-invalid.*field-group/s);
  assert.match(form, /field-error/);
  assert.match(scopes, /dependencies|requiredScopes/);
});

test('one-time secret stays in component memory and never enters URL, cache or storage', async () => {
  const [modal, api] = await Promise.all([
    source('src/components/admin/api-tokens/ApiTokenRevealModal.tsx'),
    source('src/api/apiCredentials.ts')
  ]);
  assert.match(modal, /FILTRO_API_TOKEN/);
  assert.match(modal, /navigator\.clipboard/);
  assert.doesNotMatch(modal, /localStorage|sessionStorage|URLSearchParams/);
  assert.doesNotMatch(api, /setQueryData\([^\n]*token/);
});
