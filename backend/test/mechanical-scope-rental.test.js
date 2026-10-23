import assert from 'node:assert/strict';
import test from 'node:test';
import { mechanicalMeasurement, MECHANICAL_MEASURES } from '../../shared/modules/mechanical-measurement.js';
import { addRealizedService, buildProgress, buildProgressHistory } from '../src/lib/acompanhamento/avanco.js';
import { assertMechanicalMeasurements } from '../src/lib/reports/mechanical-measurement.js';
import { assertReportServicesProject } from '../src/lib/reports/service-project-validation.js';
import { definirEscopo, quantidadeDoServico } from '../src/lib/databook/progresso.js';
import { rentalTracking } from '../src/lib/projects/rental-tracking.js';

test('limpeza mecânica mantém cada unidade separada e só conta a quantidade finalizada uma vez', () => {
  const planned = [{ serviceType: 'LIMPEZA_MECANICA', weight: 100,
    systems: Object.entries(MECHANICAL_MEASURES).map(([systemType, config]) => ({
      projectSystemId: `system-${config.unit}`, projectSystem: { id: `system-${config.unit}`, equipment: 'UG 01', name: config.unit },
      systemType, unit: config.unit, quantity: 100
    })) }];
  const realized = new Map(), reports = [];
  for (const { unit } of Object.values(MECHANICAL_MEASURES)) {
    const service = { serviceType: 'mecanica', finalized: true, reportType: 'RDO', reportDate: '2026-10-23', system: unit,
      extraData: { equipmentId: 'UG 01', __projectSystemId: `system-${unit}`, unidadeMecanica: unit, quantidadeMecanica: '25',
        tubes: [{ c: '999' }], volumeOleo: '999' } };
    addRealizedService(realized, service);
    reports.push(service, { ...service, finalized: false }, { ...service, reportType: 'RLM', specialConditions: { parentRdoId: 'rdo' } });
  }
  const progress = buildProgress(planned, realized);
  assert.equal(progress.progressPct, 25);
  assert.equal(progress.services[0].totals.length, 5);
  assert.ok(progress.services[0].totals.every(total => total.realizedQty === 25));
  const history = buildProgressHistory(planned, reports);
  assert.equal(history.at(-1).progressPct, 25);
  assert.equal(realized.get('LIMPEZA_MECANICA').tubulacaoM, 0);
  assert.deepEqual(quantidadeDoServico({ serviceType: 'mecanica', extraData: { unidadeMecanica: 'KG', quantidadeMecanica: '25' } }), { quantidade: 25, unidade: 'kg' });
  assert.equal(definirEscopo([{ serviceType: 'LIMPEZA_MECANICA', systems: [{ systemType: 'MECANICA_KG', quantity: 100, unit: 'KG' }] }]).unidade, 'kg');
});

test('valida unidade cadastrada, quantidade positiva e unidades inteiras; conserva relatórios antigos', async () => {
  const client = { projectPlannedService: { findMany: async () => [{ serviceType: 'LIMPEZA_MECANICA', systems: [
    { systemType: 'MECANICA_KG', projectSystemId: 's', projectSystem: { equipment: 'UG', name: 'Resíduo' } }
  ] }] } };
  const service = { serviceType: 'mecanica', system: 'Resíduo', extraData: {
    equipmentId: 'UG', __projectSystemId: 's', unidadeMecanica: 'KG', quantidadeMecanica: '12,5'
  } };
  await assertMechanicalMeasurements(client, 'p', [service]);
  for (const change of [{ unidadeMecanica: 'M' }, { quantidadeMecanica: '0' }, { quantidadeMecanica: '-1' }, { quantidadeMecanica: 'abc' }]) {
    await assert.rejects(assertMechanicalMeasurements(client, 'p', [{ ...service, extraData: { ...service.extraData, ...change } }]), /unidade cadastrada/);
  }
  assert.equal(mechanicalMeasurement({ unidadeMecanica: 'UN', quantidadeMecanica: '1.5' }), null);
  assert.deepEqual(mechanicalMeasurement({ unidadeMecanica: 'UN', quantidadeMecanica: '2' }), { unit: 'UN', quantity: 2, systemType: 'MECANICA_UN' });
  await assertMechanicalMeasurements(client, 'p', [{ serviceType: 'mecanica', extraData: {}, system: 'Antigo' }]);
});

test('locação dispensa relatório e mede dias pelas datas do projeto no calendário de São Paulo', async () => {
  const project = { serviceCategory: 'RENTAL', startDate: '2026-10-01', endDate: '2026-10-31' };
  assert.deepEqual(rentalTracking(project, new Date('2026-10-23T01:00:00Z')), {
    startDate: '2026-10-01', endDate: '2026-10-31', plannedDays: 31, elapsedDays: 22, remainingDays: 9, status: 'ACTIVE'
  });
  assert.equal(rentalTracking(project, new Date('2026-11-03T12:00:00Z')).elapsedDays, 31);
  assert.equal(rentalTracking(project, new Date('2026-09-30T12:00:00Z')).elapsedDays, 0);
  assert.equal(rentalTracking({ ...project, startDate: '2026-10-31' }, new Date('2026-10-31T12:00:00Z')).plannedDays, 1);
  assert.equal(rentalTracking({ serviceCategory: 'SERVICE' }), null);
  assert.equal(rentalTracking({ serviceCategory: 'RENTAL' }).status, 'NO_DATES');
  await assert.rejects(assertReportServicesProject({}, { id: 'p', serviceCategory: 'RENTAL' }, []), /não recebem relatórios/);
});
