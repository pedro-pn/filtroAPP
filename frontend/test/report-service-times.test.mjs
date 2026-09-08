import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { firstMissingRequiredServiceTime } from '../src/utils/reportServiceTimes.ts';

test('todos os serviços exigem hora de início e término/pausa', () => {
  const serviceTypes = ['limpeza', 'pressao', 'filtragem', 'flushing', 'mecanica', 'inibicao'];

  for (const type of serviceTypes) {
    assert.deepEqual(firstMissingRequiredServiceTime([{
      type,
      data: { startTime: '', endTime: '12:00' }
    }]), { serviceIndex: 0, field: 'startTime' });

    assert.deepEqual(firstMissingRequiredServiceTime([{
      type,
      data: { startTime: '08:00', endTime: '   ' }
    }]), { serviceIndex: 0, field: 'endTime' });
  }

  assert.equal(firstMissingRequiredServiceTime([{
    data: { startTime: '08:00', endTime: '12:00' }
  }]), null);
});

test('editor do relatório identifica visualmente os horários obrigatórios', async () => {
  const source = await readFile(new URL('../src/pages/ReportDetailPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /Hora de início <span style=\{\{ color: 'var\(--rd\)' \}\}>\*<\/span>/);
  assert.match(source, /Hora de término\/pausa <span style=\{\{ color: 'var\(--rd\)' \}\}>\*<\/span>/);
  assert.match(source, /firstMissingRequiredServiceTime\(form\.services\)/);
  assert.equal((source.match(/type="time"\s+required\s+value=\{getString\(service\.data\.(?:startTime|endTime)\)\}/g) || []).length, 2);
});
