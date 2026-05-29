import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReportFileName } from '../src/lib/report-filename.js';

function report(reportType) {
  return {
    reportType,
    sequenceNumber: 7,
    project: { code: '123', name: 'Teste' },
    specialConditions: {
      serviceData: {
        'ID da embarcação': '51632',
        Steps: '4'
      }
    }
  };
}

test('RLI stored filename follows RLF naming pattern with only the report type changed', () => {
  assert.equal(
    buildReportFileName(report('RLI'), 'pdf'),
    'Missão 123 Teste - RLI 7 - 51632 - 51632M004.pdf'
  );
  assert.equal(
    buildReportFileName(report('RLI'), 'docx'),
    'Missão 123 Teste - RLI 7 - 51632 - 51632M004.docx'
  );
  assert.equal(
    buildReportFileName(report('RLF'), 'pdf'),
    'Missão 123 Teste - RLF 7 - 51632 - 51632M004.pdf'
  );
  assert.equal(
    buildReportFileName(report('RLF'), 'docx'),
    'Missão 123 Teste - RLF 7 - 51632 - 51632M004.docx'
  );
});
