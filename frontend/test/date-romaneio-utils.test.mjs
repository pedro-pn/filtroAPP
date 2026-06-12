import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadModule(path) {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule(path);
  } finally {
    await server.close();
  }
}

test('formatDateOnly preserves date-only values from UTC midnight timestamps', async () => {
  const { dateInputValue, formatDateOnly } = await loadModule('/src/utils/dateOnly.ts');

  assert.equal(dateInputValue('2026-06-12T00:00:00.000Z'), '2026-06-12');
  assert.equal(formatDateOnly('2026-06-12T00:00:00.000Z'), '12/06/2026');
});

test('romaneio measure helpers expose business labels and variable measures', async () => {
  const { defaultRomaneioUnit, romaneioMeasureLabel, romaneioUsesVariableQuantity } = await loadModule('/src/utils/romaneioMeasure.ts');

  assert.equal(romaneioMeasureLabel('UNIT'), 'Unidade');
  assert.equal(romaneioMeasureLabel('LENGTH'), 'Comprimento');
  assert.equal(romaneioMeasureLabel('WEIGHT'), 'Peso');
  assert.equal(defaultRomaneioUnit('LENGTH'), 'm');
  assert.equal(romaneioUsesVariableQuantity('UNIT'), false);
  assert.equal(romaneioUsesVariableQuantity('LENGTH'), true);
});
