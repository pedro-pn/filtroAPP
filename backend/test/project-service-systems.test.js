import assert from 'node:assert/strict';
import test from 'node:test';
import { addRealizedService, buildProgress, buildProgressHistory, buildRequiredWeeklyProgress } from '../src/lib/acompanhamento/avanco.js';
import { assertReportProjectSystems, projectSystemWithMeasurements, resolvePlannedSystem, resolveProjectSystem, saveSystemAlias } from '../src/lib/acompanhamento/project-systems.js';
import { diameterKey } from '../src/lib/acompanhamento/system-progress.js';
import { combineProgressBreakdowns } from '../src/lib/acompanhamento/progress-groups.js';
import { historicalReportsAsServices, historicalFingerprint, parseHistoricalServicesCsv } from '../src/lib/reports/historical-services.js';
import { linkHistoricalMeasurement, updateHistoricalReport } from '../src/lib/reports/historical-services-store.js';

const registry = ['01', '02', '14'].map(ug => ({ id: `system-${ug}`, projectId: 'p', equipment: `Unidade Geradora ${ug}`, name: 'Regulador de velocidade', aliases: [], revision: 1 }));
const row = (system, quantity = 100, diameter = '2', unit = 'pol') => ({ projectSystemId: system.id, projectSystem: system, systemType: 'TUBULACAO', unit: 'M', diameter, diameterUnit: unit, quantity });
const scope = systems => [{ serviceType: 'LIMPEZA_QUIMICA', weight: 100, systems }];
const service = (equipment, system = 'Regulador de velocidade', c = 50, extra = {}) => ({ serviceType: 'limpeza', finalized: true, system, reportDate: '2026-01-01', extraData: { equipmentId: equipment, system, tubes: [{ d: '2', unit: 'pol', c, lengthUnit: 'm' }], ...extra } });
const calc = (planned, services) => { const realized = new Map(); services.forEach(item => addRealizedService(realized, item)); return buildProgress(planned, realized); };

test('all UGs have independent quantities and canonical names: UG01 does not advance UG02 or UG14', () => {
  const result = calc(scope(registry.map(system => row(system))), [service(registry[0].equipment)]);
  assert.deepEqual(result.services[0].systems.map(item => item.realizedQty), [50, 0, 0]);
  assert.equal(result.progressPct, 16.7);
  assert.deepEqual(result.pendingMeasurements, []);
});

test('conservative matching: spelling case/accent OK; unconfirmed abbreviations and combined systems remain pending', () => {
  const result = calc(scope([row(registry[0])]), [service(' unidade geradora 01 ', 'REGULADOR DE VELOCIDADE', 20), service('UG 01', 'RV', 30), service(registry[0].equipment, 'Regulador e mancais', 40)]);
  assert.equal(result.services[0].systems[0].realizedQty, 20);
  assert.deepEqual(result.pendingMeasurements.map(item => item.quantity), [30, 40]);
  assert.equal(resolveProjectSystem(registry, { projectSystemId: 'another-project-id', equipment: registry[0].equipment, system: registry[0].name }), null);
});

test('confirmed alias is scoped by equipment and service; competing aliases never auto-match', () => {
  const system = { ...registry[0], aliases: [{ equipment: 'UG 01', system: 'RV', serviceType: 'LIMPEZA_QUIMICA' }] };
  assert.equal(calc(scope([row(system)]), [service('UG 01', 'RV')]).progressPct, 50);
  assert.equal(resolveProjectSystem([system], { equipment: 'UG 02', system: 'RV', serviceType: 'LIMPEZA_QUIMICA' }), null);
  assert.equal(resolveProjectSystem([system], { equipment: 'UG 01', system: 'RV', serviceType: 'FILTRAGEM' }), null);
  assert.equal(resolveProjectSystem([system, { ...system, id: 'conflict' }], { equipment: 'UG 01', system: 'RV', serviceType: 'LIMPEZA_QUIMICA' }), null);
});

test('pending measurements distinguish an unknown name from an identified system missing the planned diameter', () => {
  const alias = { equipment: 'UG 01', system: 'RV', serviceType: 'LIMPEZA_QUIMICA' };
  const reports = [service(alias.equipment, alias.system, 30), service(alias.equipment, alias.system, 40, { tubes: [{ d: '3', unit: 'pol', c: 40 }] })];
  const before = calc(scope([row(registry[0])]), reports);
  assert.equal(before.pendingMeasurements.length, 2);
  assert.ok(before.pendingMeasurements.every(item => item.matchedSystem === null));
  const system = { ...registry[0], aliases: [alias] };
  const after = calc(scope([row(system)]), reports);
  assert.equal(after.progressPct, 30);
  assert.equal(after.pendingMeasurements.length, 1);
  assert.equal(after.pendingMeasurements[0].diameter, '3');
  assert.equal(after.pendingMeasurements[0].quantity, 40);
  assert.deepEqual(after.pendingMeasurements[0].matchedSystem, { id: system.id, equipment: system.equipment, name: system.name });
  assert.equal(after.pendingMeasurements[0].projectSystemId, null);
  assert.deepEqual(calc(scope([row(system), row(system, 100, '3')]), reports).pendingMeasurements, []);
});

test('pending measurements retain independent manual system assignments even when their original names are identical', () => {
  const reports = registry.slice(0, 2).map((system, index) => service('UG antiga', 'Sistema antigo', 0, {
    __projectSystemId: system.id, tubes: [{ d: '3', unit: 'pol', c: 20 + index }]
  }));
  const result = calc(scope(registry.slice(0, 2).map(system => row(system))), reports);
  assert.equal(result.pendingMeasurements.length, 2);
  assert.deepEqual(result.pendingMeasurements.map(item => item.projectSystemId), registry.slice(0, 2).map(system => system.id));
  assert.deepEqual(result.pendingMeasurements.map(item => item.matchedSystem.id), registry.slice(0, 2).map(system => system.id));
  assert.deepEqual(result.pendingMeasurements.map(item => item.quantity), [20, 21]);
  assert.equal(result.progressPct, 0);
});

test('diameters, wildcard rows and repeated planned rows cannot consume a measurement twice', () => {
  const result = calc(scope([row(registry[0], 20), row(registry[0], 30), row(registry[0], 100, ''), row(registry[0], 50, '2', 'mm')]), [service(registry[0].equipment)]);
  assert.deepEqual(result.services[0].systems.map(item => item.realizedQty), [50, 0, 0]);
  assert.equal(result.progressPct, 25);
  assert.equal(diameterKey('1 1/2', 'pol'), diameterKey('1.5', 'pol'));
  assert.notEqual(diameterKey('2', 'pol'), diameterKey('50.8', 'mm'));
});

test('excess of one system is preserved in the weighted execution percentage', () => {
  const result = calc(scope([row(registry[0], 10), row(registry[1], 90)]), [service(registry[0].equipment, undefined, 100)]);
  assert.equal(result.progressPct, 100);
  const grouped = combineProgressBreakdowns([result]);
  assert.equal(grouped.progressPct, 100);
  assert.equal(grouped.services[0].systems.length, 2);
  assert.equal(grouped.services[0].systems[1].equipment, registry[1].equipment);
});

test('weekly history and required pace use the same system assignments as current progress', () => {
  const planned = scope(registry.map(system => row(system)));
  const services = [service(registry[0].equipment), { ...service(registry[1].equipment), reportDate: '2026-01-10' }, { ...service('UG ?', 'Unknown'), reportDate: '2026-01-17' }];
  const result = calc(planned, services);
  assert.equal(buildProgressHistory(planned, services).at(-1).progressPct, result.progressPct);
  const weekly = buildRequiredWeeklyProgress(result, { expectedEndDate: '2026-01-24', referenceDate: '2026-01-17' });
  assert.deepEqual(weekly.services[0].systems.map(item => item.projectSystemId), registry.map(item => item.id));
});

test('historical item overrides are independent inside one report and do not change the import fingerprint', () => {
  const original = { reportType: 'RLQ', sequenceNumber: 1, reportDate: '2026-01-01', projectId: 'p', items: [
    { serviceType: 'limpeza', equipment: 'UG01', system: 'Sistema antigo', diameter: '2', unit: 'm', quantity: 20 },
    { serviceType: 'limpeza', equipment: 'UG01', system: 'Sistema antigo', diameter: '3', unit: 'm', quantity: 30 }
  ] };
  const linked = { ...original, items: original.items.map((item, index) => ({ ...item, projectSystemId: registry[index].id })) };
  assert.equal(historicalFingerprint(original), historicalFingerprint(linked));
  const progress = calc(scope([row(registry[0], 100, ''), row(registry[1], 100, '')]), historicalReportsAsServices([linked]));
  assert.deepEqual(progress.services[0].systems.map(item => item.realizedQty), [20, 30]);
  assert.deepEqual(linked.items.map(item => item.system), ['Sistema antigo', 'Sistema antigo']);
});

test('oil mL and pipe cm use canonical system identity and base units independently', () => {
  const planned = [{ serviceType: 'FLUSHING', weight: 1, systems: [row(registry[0], 10), { ...row(registry[0]), systemType: 'OLEO', unit: 'L', quantity: 100 }] }];
  const result = calc(planned, [{ ...service(registry[0].equipment), serviceType: 'flushing', extraData: { equipmentId: registry[0].equipment, tubes: [{ d: '2', unit: 'pol', c: 500, lengthUnit: 'cm' }], volumeOleo: 50000, volumeOleoUnit: 'mL' } }]);
  assert.deepEqual(result.services[0].systems.map(item => item.realizedQty), [5, 50]);
  assert.equal(result.progressPct, 50);
});

test('mm CSV accepts inline and column units, rejects conflicting units and preserves legacy inch fingerprints', () => {
  const header = 'Relatorio;Numero;Data;Servico;Equipamento do cliente;Sistema;Diametro;Quantidade;Unidade';
  const line = 'RLQ;1;01/01/2026;Limpeza;UG 01;RV;50 mm;3500;cm';
  const parsed = parseHistoricalServicesCsv(`${header}\n${line}`);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.reports[0].items[0].diameterUnit, 'mm');
  const column = parseHistoricalServicesCsv(`${header};Unidade do diametro\n${line.replace('50 mm', '50')};mm`);
  assert.equal(column.reports[0].fingerprint, parsed.reports[0].fingerprint);
  assert.equal(parseHistoricalServicesCsv(`${header.replace('Diametro', 'Diametro (mm)')}\n${line.replace('50 mm', '50')}`).reports[0].items[0].diameterUnit, 'mm');
  assert.match(parseHistoricalServicesCsv(`${header.replace('Diametro', 'Diametro (pol)')}\n${line}`).errors[0].message, /cabeçalho/);
  assert.match(parseHistoricalServicesCsv(`${header};Unidade do diametro\n${line};pol`).errors[0].message, /diverge/);
  const inch = parseHistoricalServicesCsv(`${header}\n${line.replace('50 mm', "2'")}`).reports[0];
  assert.equal(inch.items[0].diameterUnit, undefined);
  assert.equal(historicalFingerprint(inch), historicalFingerprint({ ...inch, items: inch.items.map(item => ({ ...item, diameterUnit: 'pol' })) }));
});

test('scope upserts a stable customer-system identity and rejects foreign or mismatched IDs', async () => {
  const system = { ...registry[0], equipmentKey: 'unidade geradora 01', nameKey: 'regulador de velocidade' };
  const client = { projectServiceSystem: { upsert: async query => { assert.equal(query.where.projectId_equipmentKey_nameKey.projectId, 'p'); return system; }, findFirst: async query => query.where.projectId === 'p' ? system : null } };
  assert.equal(await resolvePlannedSystem(client, 'p', { equipment: system.equipment, systemName: system.name }), system.id);
  assert.equal(await resolvePlannedSystem(client, 'p', { equipment: system.equipment, systemName: system.name }), system.id);
  await assert.rejects(resolvePlannedSystem(client, 'other', { projectSystemId: system.id, equipment: system.equipment, systemName: system.name }), /não corresponde/);
  await assert.rejects(resolvePlannedSystem(client, 'p', { equipment: system.equipment }), /juntos/);
});

test('report canonical ID is optional but, when present, must belong to project and match submitted text', async () => {
  const client = { projectServiceSystem: { findMany: async ({ where }) => where.projectId === 'p' ? registry : [] } };
  const linked = service(registry[0].equipment, registry[0].name, 50, { __projectSystemId: registry[0].id });
  await assertReportProjectSystems({}, 'p', [service('Texto livre')]);
  await assertReportProjectSystems(client, 'p', [linked]);
  await assert.rejects(assertReportProjectSystems(client, 'other', [linked]), /não corresponde/);
  await assert.rejects(assertReportProjectSystems(client, 'p', [{ ...linked, system: 'Digitado outro nome' }]), /não corresponde/);
});

test('alias assignment conflicts with canonical owner and checks optimistic revision', async () => {
  const client = { projectServiceSystem: { findMany: async () => registry.map(item => ({ ...item, plannedRows: [{ systemType: 'TUBULACAO', service: { serviceType: 'LIMPEZA_QUIMICA' } }] })), updateMany: async () => ({ count: 0 }) }, $transaction: async fn => fn(client) };
  await assert.rejects(saveSystemAlias(client, { projectId: 'p', id: registry[0].id, equipment: registry[1].equipment, system: registry[1].name, serviceType: 'LIMPEZA_QUIMICA', revision: 1 }), /outro sistema/);
  await assert.rejects(saveSystemAlias(client, { projectId: 'p', id: registry[0].id, equipment: 'UG01', system: 'RV', serviceType: 'LIMPEZA_QUIMICA', revision: 1 }), /cadastro mudou/);
});

test('aliases require the same service in the current scope; shared systems work and obsolete aliases can be removed', async () => {
  const types = ['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING', 'FILTRAGEM'];
  let target = { ...registry[0], plannedRows: [] };
  let writes = 0;
  const client = { projectServiceSystem: {
    findMany: async query => { assert.ok(query.include.plannedRows); return [target]; },
    findUnique: async query => { assert.ok(query.include.plannedRows); return target; },
    updateMany: async ({ data }) => { writes++; target = { ...target, aliases: data.aliases, revision: target.revision + 1 }; return { count: 1 }; }
  }, $transaction: async fn => fn(client) };
  const input = { projectId: 'p', id: target.id, equipment: 'UG01', system: 'RV', revision: 1 };
  for (const plannedType of types) {
    target = { ...target, plannedRows: [{ systemType: 'TUBULACAO', service: { serviceType: plannedType } }] };
    for (const serviceType of types.filter(type => type !== plannedType)) {
      const before = structuredClone(target), previousWrites = writes;
      await assert.rejects(saveSystemAlias(client, { ...input, serviceType }), error => error.statusCode === 400 && /tipo de serviço no escopo atual/.test(error.message));
      assert.deepEqual(target, before);
      assert.equal(writes, previousWrites);
    }
    const saved = await saveSystemAlias(client, { ...input, serviceType: plannedType });
    assert.deepEqual(saved.measurements, [{ serviceType: plannedType, systemType: 'TUBULACAO' }]);
    assert.equal(saved.plannedRows, undefined);
  }
  target.plannedRows = ['Limpeza química', 'Filtragem de óleo'].map(serviceType => ({ systemType: 'OLEO', service: { serviceType } }));
  for (const serviceType of ['LIMPEZA_QUIMICA', 'FILTRAGEM']) {
    assert.equal((await saveSystemAlias(client, { ...input, serviceType })).measurements.length, 2);
  }
  target.plannedRows = [];
  await assert.rejects(saveSystemAlias(client, { ...input, serviceType: 'FILTRAGEM' }), /escopo atual/);
  const removed = await saveSystemAlias(client, { ...input, serviceType: 'FILTRAGEM', remove: true });
  assert.ok(!removed.aliases.some(alias => alias.serviceType === 'FILTRAGEM'));
  assert.deepEqual(removed.measurements, []);
  assert.deepEqual(projectSystemWithMeasurements(registry[0]).measurements, []);
});

test('per-item linking preserves data and fingerprint, refuses stale revisions and foreign targets; CSV edits preserve unchanged links', async () => {
  const csv = 'Relatorio;Numero;Data;Servico;Equipamento do cliente;Sistema;Diametro;Quantidade;Unidade\nRLQ;1;01/01/2026;Limpeza;UG01;RV;2;50;m';
  let current = { ...parseHistoricalServicesCsv(csv).reports[0], id: 'h', projectId: 'p', revision: 1 };
  const original = structuredClone(current);
  const client = {
    project: { findFirst: async () => ({ id: 'p' }) },
    projectServiceSystem: { findFirst: async query => registry.find(item => item.id === query.where.id && item.projectId === query.where.projectId) },
    report: { findMany: async () => [] },
    historicalServiceReport: {
      findFirst: async () => current, findUnique: async () => current,
      updateMany: async ({ where, data }) => {
        if (where.revision !== current.revision) return { count: 0 };
        current = { ...current, ...data, revision: current.revision + 1 }; return { count: 1 };
      }
    }, $transaction: async fn => fn(client)
  };
  const input = { projectId: 'p', id: 'h', itemIndex: 0, projectSystemId: registry[0].id, revision: 1, userId: 'u' };
  await linkHistoricalMeasurement(client, input);
  assert.equal(current.fingerprint, original.fingerprint);
  assert.equal(current.items[0].system, 'RV');
  assert.equal(current.items[0].projectSystemId, registry[0].id);
  await assert.rejects(linkHistoricalMeasurement(client, input), /lançamento mudou/);
  await assert.rejects(linkHistoricalMeasurement(client, { ...input, revision: 2, projectSystemId: 'foreign' }), /deste projeto/);
  await updateHistoricalReport(client, { ...input, csv, revision: 2 });
  assert.equal(current.items[0].projectSystemId, registry[0].id);
  await updateHistoricalReport(client, { ...input, csv: csv.replace(';50;m', ';51;m'), revision: 3 });
  assert.equal(current.items[0].projectSystemId, undefined);
});
