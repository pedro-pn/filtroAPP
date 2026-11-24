import assert from 'node:assert/strict';
import test from 'node:test';
import { projectServiceComposition } from '../../shared/modules/project-service-composition.js';

const system = (systemType, plannedQty, realizedQty, extra = {}) => ({ systemType, plannedQty, realizedQty, unit: null, ...extra });
const service = (systems, extra = {}) => ({ serviceType: 'LIMPEZA_QUIMICA', executionPct: 75, systems, ...extra });

test('composição conserva grupos, totais e excedentes; não mistura unidades nem publica campos extras', () => {
  const result = projectServiceComposition({ target: { services: [], scopeGroups: [
    { scopeName: 'Escopo 1', services: [service([system('TUBULACAO', 100, 50)], {
      totals: [system('TUBULACAO', 120, 150)], executionPct: 125, note: 'PRIVATE'
    })] },
    { scopeName: 'Escopo 2', services: [service([system('TUBULACAO', 10, 5), system('OLEO', 20, 10)])] }
  ] } });
  assert.deepEqual(result, [
    { escopo: 'Escopo 1', servico: 'LIMPEZA_QUIMICA', rotuloServico: 'Limpeza química', equipamento: null,
      avancoPct: 125, unidade: 'M', rotuloUnidade: 'm', previsto: 120, realizado: 150, sistemas: 1 },
    { escopo: 'Escopo 2', servico: 'LIMPEZA_QUIMICA', rotuloServico: 'Limpeza química', equipamento: null,
      avancoPct: 75, unidade: null, rotuloUnidade: null, previsto: null, realizado: null, sistemas: 2 }
  ]);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('unidades ligadas separam equipamentos e mantêm média por tipo nos sistemas restantes', () => {
  const result = projectServiceComposition({ fallbackProgress: { services: [service([
    system('TUBULACAO', 100, 50), system('TUBULACAO', 300, 50), system('OLEO', 10, 10),
    system('SISTEMA', 3, 2, { equipment: ' UH-01 ', systemName: 'PRIVATE_SYSTEM_A' }),
    system('SISTEMA', 2, 1, { equipment: 'UH-01', systemName: 'PRIVATE_SYSTEM_B' }),
    system('MANGOTE', 1, 2, { equipment: 'UH-02' }),
    system('SISTEMA', 2, 1, { systemName: 'Unidade sem equipamento' })
  ])] } });
  assert.deepEqual(result.map(row => [row.equipamento, row.avancoPct, row.previsto, row.realizado, row.sistemas]), [
    [null, 62.5, null, null, 3], ['UH-01', 60, 5, 3, 2], ['UH-02', 200, 1, 2, 1], ['Unidade sem equipamento', 50, 2, 1, 1]
  ]);
  assert.equal(result[1].unidade, 'UN');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SYSTEM'), false);
});

test('quantidades incompletas, meta zero, fallback legado e ausência de composição preservam null', () => {
  const rows = projectServiceComposition({ target: { services: [] }, fallbackServices: [
    service([system('TUBULACAO', 10, null)]),
    service([system('SISTEMA', 0, 0, { equipment: 'UH-01' })]),
    service([system('MEDIDA_FUTURA', 8, 2, { unit: 'FUTURA' })], { serviceType: 'SERVICO_FUTURO', executionPct: null })
  ] });
  assert.equal(rows[0].previsto, null); assert.equal(rows[0].realizado, null); assert.equal(rows[0].unidade, null);
  assert.equal(rows[1].avancoPct, null);
  assert.equal(rows[2].rotuloServico, 'SERVICO_FUTURO'); assert.equal(rows[2].rotuloUnidade, 'FUTURA');
  assert.equal(rows[2].avancoPct, null);
  assert.deepEqual(projectServiceComposition(), []);
  assert.deepEqual(projectServiceComposition({ fallbackProgress: { services: [] } }), []);
});
