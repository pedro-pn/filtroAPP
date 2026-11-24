import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const viteServer = () => createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
  esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });

const system = (id, ...measurements) => ({ id, projectId: 'p1', equipment: 'UG 01', name: `Sistema ${id}`, revision: 1, measurements });
const m = (serviceType, systemType) => ({ serviceType, systemType });

test('scope defines the measurement mode only when it is unambiguous for the service', async () => {
  const server = await viteServer();
  try {
    const { scopedMeasurementMode: mode, selectedProjectSystem, projectSystemSelectionPatch: select } = await server.ssrLoadModule('/src/utils/projectSystemSelection.ts');
    const pipes = system('a', m('LIMPEZA_QUIMICA', 'TUBULACAO'), m('FLUSHING', 'TUBULACAO'), m('FLUSHING', 'OLEO'), m('TESTE_PRESSAO', 'MANGOTE'));
    assert.equal(mode(pipes, 'limpeza'), 'TUBULACAO');
    assert.equal(mode(pipes, 'flushing'), 'TUBULACAO');
    assert.equal(mode(pipes, 'pressao'), 'MANGOTE');
    assert.equal(mode(pipes, 'filtragem'), null);
    assert.equal(mode(system('b', m('LIMPEZA_QUIMICA', 'TUBULACAO'), m('LIMPEZA_QUIMICA', 'SISTEMA')), 'limpeza'), null);
    assert.equal(mode(system('c', m('FLUSHING', 'OLEO')), 'flushing'), null); // óleo sozinho não diz se é tubulação
    assert.equal(mode(system('d', m('TESTE_PRESSAO', 'TUBULACAO'), m('TESTE_PRESSAO', 'MANGOTE')), 'pressao'), null);
    assert.equal(mode(undefined, 'limpeza'), null);

    assert.equal(selectedProjectSystem([pipes], { __projectSystemId: 'a' }), pipes);
    assert.equal(selectedProjectSystem([pipes], { equipmentId: ' ug 01 ', system: 'Sistema a' }), pipes);
    assert.equal(selectedProjectSystem([pipes], { __projectSystemId: 'x', equipmentId: 'UG 01', system: 'Sistema a' }), undefined);

    const patch = select([pipes], { equipmentId: 'UG 01', flushingTubulacao: 'Não', tipoSistema: 'Tanques' }, 'system', 'Sistema a', 'FLUSHING');
    assert.equal(patch.flushingTubulacao, 'Sim');
    assert.equal(patch.tipoSistema, '');
    assert.equal(select([system('c', m('FLUSHING', 'OLEO'))], { equipmentId: 'UG 01', flushingTubulacao: 'Não' }, 'system', 'Sistema c', 'flushing').flushingTubulacao, undefined);
  } finally { await server.close(); }
});

test('report form shows the scoped measurement field without asking for the mode', async () => {
  const server = await viteServer();
  const client = new QueryClient();
  try {
    const { ServiceFields } = await server.ssrLoadModule('/src/components/reports/ServiceFields.tsx');
    client.setQueryData(['project-systems', 'reports', 'p1'], [
      system('pipe', m('LIMPEZA_QUIMICA', 'TUBULACAO'), m('FLUSHING', 'TUBULACAO'), m('TESTE_PRESSAO', 'TUBULACAO')),
      system('units', m('LIMPEZA_QUIMICA', 'SISTEMA'), m('TESTE_PRESSAO', 'MANGOTE')),
      system('mixed', m('LIMPEZA_QUIMICA', 'TUBULACAO'), m('LIMPEZA_QUIMICA', 'SISTEMA'))
    ]);
    const render = (serviceType, data, extra = {}) => renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(ServiceFields, { serviceType, data, onChange: () => {}, units: [], manometers: [], groupKey: 't', hideUploads: true, projectId: 'p1', ...extra })));

    const pipeCleaning = render('limpeza', { __projectSystemId: 'pipe' });
    assert.doesNotMatch(pipeCleaning, /Limpeza de tubulação\?/);
    assert.match(pipeCleaning, /Tubulação \(diâmetro e comprimento\) — definida no escopo/);
    assert.match(pipeCleaning, /Diâmetro/);

    const unitCleaning = render('limpeza', { __projectSystemId: 'units', limpezaTubulacao: 'Não' });
    assert.doesNotMatch(unitCleaning, /Limpeza de tubulação\?/);
    assert.match(unitCleaning, /Quantidade executada \(unidades\)/);
    assert.match(unitCleaning, /Tipo de sistema/);

    // Ambíguo, divergente, sem cadastro, sem projeto ou somente leitura: pergunta continua como hoje.
    assert.match(render('limpeza', { __projectSystemId: 'mixed' }), /Limpeza de tubulação\?/);
    assert.match(render('limpeza', { __projectSystemId: 'units' }), /Limpeza de tubulação\?/);
    assert.match(render('limpeza', { equipmentId: 'Outro', system: 'Livre' }), /Limpeza de tubulação\?/);
    assert.match(render('limpeza', { __projectSystemId: 'pipe' }, { projectId: null }), /Limpeza de tubulação\?/);
    assert.match(render('limpeza', { __projectSystemId: 'pipe' }, { disabled: true }), /Limpeza de tubulação\?/);

    const flushing = render('flushing', { __projectSystemId: 'pipe' });
    assert.doesNotMatch(flushing, /Flushing em tubulação\?/);
    assert.match(flushing, /Diâmetro/);

    const hoses = render('pressao', { __projectSystemId: 'units', equipamentoTestado: 'mangueira', medicaoMangotes: 'UN' });
    assert.doesNotMatch(hoses, /Equipamento testado|Medição das mangueiras/);
    assert.match(hoses, /Quantidade de mangueiras \(unidades\)/);

    const meteredHoses = render('pressao', { __projectSystemId: 'pipe', equipamentoTestado: 'mangueira', medicaoMangotes: 'M' });
    assert.match(meteredHoses, /Equipamento testado/);
    assert.doesNotMatch(meteredHoses, /Medição das mangueiras/);
    assert.match(meteredHoses, /Mangueiras \(diâmetro e metragem\)/);
  } finally { client.clear(); await server.close(); }
});
