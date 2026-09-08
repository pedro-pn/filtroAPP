import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('quality form offers Interno/SGQ for every record type', async () => {
  const source = await readFile(
    new URL('../src/pages/qualidade/QualityRecordFormModal.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /<label htmlFor="quality-project">Obra\/Projeto<\/label>/);
  assert.match(source, /<option value="">Interno\/SGQ<\/option>/);
  assert.doesNotMatch(source, /isDeviation \? 'Interno\/SGQ' : 'Selecione'/);
});
