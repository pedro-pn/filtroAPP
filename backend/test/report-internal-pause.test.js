import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withoutInternalPause, withoutInternalPauseForRole } from '../src/lib/reports/internal-pause.js';

const report = {
  id: 'r1',
  specialConditions: {
    standby: true,
    standbyDetails: { total: '01:00', motivo: 'Aguardando PT' },
    internalStandby: true,
    internalStandbyDetails: { total: '00:30', motivo: 'Falha na bomba' }
  }
};

test('pausa por nossa conta é removida da resposta ao cliente, sem alterar o original', () => {
  const stripped = withoutInternalPause(report);
  assert.equal('internalStandby' in stripped.specialConditions, false);
  assert.equal('internalStandbyDetails' in stripped.specialConditions, false);
  assert.deepEqual(stripped.specialConditions.standbyDetails, report.specialConditions.standbyDetails);
  assert.equal(report.specialConditions.internalStandby, true);
});

test('somente o perfil CLIENT tem a pausa interna removida', () => {
  assert.equal(withoutInternalPauseForRole('MANAGER', report), report);
  assert.equal(withoutInternalPauseForRole('COORDINATOR', report), report);
  const [item] = withoutInternalPauseForRole('CLIENT', [report]);
  assert.equal('internalStandbyDetails' in item.specialConditions, false);
});

test('relatórios sem pausa interna ou sem condições especiais passam intactos', () => {
  const plain = { id: 'r2', specialConditions: { standby: false } };
  assert.equal(withoutInternalPause(plain), plain);
  assert.equal(withoutInternalPause({ id: 'r3', specialConditions: null }).specialConditions, null);
});
