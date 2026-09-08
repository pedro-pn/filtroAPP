import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { flattenDataCatalogModels } from '../src/lib/api-credentials/data-catalog.js';

test('executable inventory stays consistent with the versioned Markdown contract', async () => {
  const markdown = await readFile(new URL('../../specs/015-api-token-playground/contracts/data-catalog.md', import.meta.url), 'utf8');
  const matrix = markdown.slice(markdown.indexOf('## Matriz completa por domínio'), markdown.indexOf('## Famílias de endpoints candidatas'));
  const documented = [...matrix.matchAll(/`([A-Z][A-Za-z0-9]+)`/g)].map(match => match[1]);
  assert.equal(new Set(documented).size, 126);
  assert.deepEqual([...new Set(documented)].sort(), flattenDataCatalogModels().map(item => item.model).sort());
});
