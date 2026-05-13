import assert from 'node:assert/strict';
import test from 'node:test';

import { stringifyReportDocxValue } from '../src/lib/report-docx.js';
import { stringifyValue } from '../src/lib/report-pdf.js';

test('stringifyReportDocxValue formats collaborator objects by names', () => {
  assert.equal(
    stringifyReportDocxValue({ ids: ['c1', 'c2'], names: ['Ana Lima', 'Bruno Dias'] }),
    'Ana Lima, Bruno Dias'
  );
});

test('stringifyReportDocxValue does not expose object string fallback', () => {
  assert.equal(stringifyReportDocxValue({ ids: ['c1', 'c2'] }), 'c1, c2');
  assert.equal(stringifyReportDocxValue({}), '');
});

test('stringifyValue formats object arrays for report pdf fields', () => {
  assert.equal(
    stringifyValue('Colaboradores do serviço', { ids: ['c1'], names: ['Ana Lima'] }),
    'Ana Lima'
  );
  assert.equal(
    stringifyValue('Unidade de Flushing', { ids: ['u1'], codes: ['UF-01'] }),
    'UF-01'
  );
});
