import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PONTO_PENDENCY_CUTOFF_DEFAULT,
  cutoffDateKeyToNumber,
  cutoffNumberToDateKey
} from '../src/lib/acompanhamento/settings.js';

// O corte é guardado como número AAAAMMDD porque AcompanhamentoSetting só tem numberValue.
test('corte do histórico converte nos dois sentidos sem perder o zero à esquerda do mês e do dia', () => {
  assert.equal(cutoffNumberToDateKey(20250101), '2025-01-01');
  assert.equal(cutoffNumberToDateKey(20260825), '2026-08-25');
  assert.equal(cutoffDateKeyToNumber('2025-01-01'), 20250101);
  assert.equal(cutoffDateKeyToNumber('2026-08-25'), 20260825);
  assert.equal(cutoffNumberToDateKey(cutoffDateKeyToNumber('2025-03-09')), '2025-03-09');
});

test('padrão é 01/01/2025 — antes disso não há projeto cadastrado para alocar', () => {
  assert.equal(cutoffNumberToDateKey(PONTO_PENDENCY_CUTOFF_DEFAULT), '2025-01-01');
});

test('valor corrompido no banco vira data comparável em vez de quebrar a listagem', () => {
  // A comparação é textual contra 'AAAA-MM-DD', então o formato precisa sobreviver a lixo.
  assert.equal(cutoffNumberToDateKey(0), '0000-00-00');
  assert.equal(cutoffNumberToDateKey(null), '0000-00-00');
  assert.equal(cutoffNumberToDateKey('não é número'), '0000-00-00');
  assert.equal(cutoffNumberToDateKey(101), '0000-01-01');
});

test('gravar data malformada é recusado em vez de virar número sem sentido', () => {
  for (const invalid of ['25/08/2026', '2026-8-25', '', null, undefined, '2026-08-25T00:00:00Z']) {
    assert.throws(() => cutoffDateKeyToNumber(invalid), /Data de corte inválida/);
  }
});
