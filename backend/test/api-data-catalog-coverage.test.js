import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { API_DATA_DOMAINS, CATALOG_EXCLUDED_INFRASTRUCTURE_MODELS, flattenDataCatalogModels } from '../src/lib/api-credentials/data-catalog.js';

test('executable catalog classifies every one of the 127 business Prisma models exactly once', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const prismaModels = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(match => match[1]);
  const excluded = new Set(CATALOG_EXCLUDED_INFRASTRUCTURE_MODELS.map(item => item.model));
  const businessModels = prismaModels.filter(model => !excluded.has(model));
  const catalogModels = flattenDataCatalogModels().map(item => item.model);
  assert.equal(API_DATA_DOMAINS.length, 20);
  assert.equal(businessModels.length, 127);
  assert.equal(new Set(catalogModels).size, catalogModels.length);
  assert.deepEqual([...catalogModels].sort(), [...businessModels].sort());
  const invoiceModel = flattenDataCatalogModels().find(item => item.model === 'OmieInvoice');
  assert.equal(invoiceModel.domainCode, 'omie');
  assert.equal(invoiceModel.availability, 'SENSITIVE');
  for (const item of flattenDataCatalogModels()) {
    assert.ok(['AVAILABLE', 'PLANNED', 'SENSITIVE', 'RESERVED', 'PROHIBITED'].includes(item.availability));
    assert.ok(item.domainCode);
  }
});
