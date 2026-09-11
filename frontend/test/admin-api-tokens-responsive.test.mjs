import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = () => readFile(new URL('../src/pages/admin/AdminTokensPage.tsx', import.meta.url), 'utf8');
const catalog = () => readFile(new URL('../src/components/admin/api-tokens/ApiScopeCatalog.tsx', import.meta.url), 'utf8');
const styles = () => readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8');
const novelty = () => readFile(new URL('../src/pages/admin/apiTokenPlaygroundNovelty.ts', import.meta.url), 'utf8');
const tour = () => readFile(new URL('../src/pages/admin/apiTokenPlaygroundTour.ts', import.meta.url), 'utf8');

test('layout has tablet/mobile breakpoints and horizontal overflow containment', async () => {
  const css = await styles();
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.api-token-page[\s\S]*overflow-x:\s*hidden/);
  assert.match(css, /minmax\(0, 1fr\)/);
});

test('workflow and catalog expose keyboard and screen-reader semantics', async () => {
  const [pageSource, catalogSource] = await Promise.all([page(), catalog()]);
  assert.match(pageSource, /aria-label="Etapas do playground"/);
  assert.match(pageSource, /aria-current="page"/);
  assert.match(pageSource, /role="alert"/);
  assert.match(catalogSource, /aria-labelledby="scope-catalog-title"/);
  assert.match(catalogSource, /aria-live="polite"/);
  assert.match(catalogSource, /type="checkbox"/);
});

test('novelty expires exactly ten days later and tour covers the complete lifecycle', async () => {
  const [noveltySource, tourSource] = await Promise.all([novelty(), tour()]);
  assert.match(noveltySource, /10 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(noveltySource, /expiresAt - launchedAt === API_TOKEN_PLAYGROUND_NOVELTY_DURATION_MS/);
  for (const concept of ['Menor privilégio', 'validade', 'segredo completo', 'Teste seguro', 'revogue']) {
    assert.match(tourSource, new RegExp(concept, 'i'));
  }
});
