import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { API_SCOPES, futureScopeDefinitions, publicApiOperations } from '../../backend/src/lib/api-credentials/catalog.js';
import { toggleApiScope } from '../src/components/admin/api-tokens/apiScopeSelection.ts';

const scopes = [...API_SCOPES.map(({ status, dependencies, ...scope }) => ({ ...scope, availability: status, requiredScopes: dependencies })), ...futureScopeDefinitions()];

test('operational permissions are independent and future/sensitive candidates remain blocked', () => {
  let selected = ['qualidade.registros.read'];
  for (const code of ['rdo.relatorios.read', 'colaboradores.operacional.read', 'equipamentos.read', 'manutencao.registros.read']) selected = toggleApiScope(scopes, selected, code);
  assert.equal(selected.length, 5);
  assert.deepEqual(toggleApiScope(scopes, selected, 'colaboradores.pii.read'), selected);
  assert.deepEqual(toggleApiScope(scopes, selected, 'rdo.relatorios.read').sort(), selected.filter(code => code !== 'rdo.relatorios.read').sort());
});

test('unified catalog renders one selectable row per available scope and operation parameters follow server catalog', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { ApiScopeCatalog } = await server.ssrLoadModule('/src/components/admin/api-tokens/ApiScopeCatalog.tsx');
    const markup = renderToStaticMarkup(createElement(ApiScopeCatalog, { scopes, selected: ['rdo.relatorios.read'], onChange() {} }));
    assert.doesNotMatch(markup, /Consultar catálogo completo|Permissões de leitura/);
    const checkboxes = [...markup.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map(match => match[0]);
    assert.equal(checkboxes.length, scopes.length);
    assert.equal(checkboxes.filter(input => !input.includes('disabled')).length, 33);
    assert.equal(checkboxes.filter(input => input.includes('checked')).length, 1);
    for (const scope of API_SCOPES) assert.match(markup, new RegExp(`scope-description-${scope.code}`));
    assert.match(markup, /Ver campos e endpoints/);
    assert.match(markup, /Cadastro global compartilhado/);

    const { ApiOperationParameters } = await server.ssrLoadModule('/src/components/admin/api-tokens/ApiOperationParameters.tsx');
    const render = id => renderToStaticMarkup(createElement(ApiOperationParameters, { operation: publicApiOperations().find(operation => operation.operationId === id), value: {}, onChange() {} }));
    assert.match(render('operational.Report.list'), /playground-project/);
    assert.doesNotMatch(render('operational.Report.list'), /playground-active|Incluir excluídos/);
    assert.match(render('operational.CompanyEquipment.list'), /playground-active/);
    assert.doesNotMatch(render('operational.CompanyEquipment.list'), /playground-project|Incluir excluídos/);
    assert.match(render('quality.records.get'), /playground-record-id/);
    assert.doesNotMatch(render('quality.records.get'), /playground-limit|playground-updated/);
    assert.match(render('operational.StockMovement.list'), /playground-created/);
    assert.match(render('operational.StockMovement.list'), /playground-itemId/);
    assert.doesNotMatch(render('operational.StockMovement.list'), /playground-updated/);
    assert.match(render('operational.ReportCollaborator.list'), /playground-reportId/);
    assert.match(render('operational.ReportCollaborator.list'), /leitura completa/);
    assert.doesNotMatch(render('operational.ReportCollaborator.list'), /playground-created|playground-updated/);
    assert.match(render('operational.MaintenanceThirdPartyService.list'), /playground-maintenanceId/);
    assert.match(render('operational.ReportAttachment.download'), /ID do anexo do relatório/);
    assert.match(render('operational.ReportAttachment.download'), /sem transferir/);
  } finally { await server.close(); }
});

test('download and financial scope selection adds dependencies and removes dependents with their base', () => {
  const download = toggleApiScope(scopes, [], 'rdo.anexos.download');
  assert.deepEqual([...download].sort(), ['rdo.anexos.download', 'rdo.anexos.metadata.read', 'rdo.relatorios.read']);
  assert.deepEqual(toggleApiScope(scopes, download, 'rdo.relatorios.read'), []);
  const costs = toggleApiScope(scopes, [], 'estoque.custos.read');
  assert.deepEqual([...costs].sort(), ['estoque.custos.read', 'estoque.itens.read', 'estoque.movimentos.read']);
  assert.deepEqual(toggleApiScope(scopes, costs, 'estoque.movimentos.read'), ['estoque.itens.read']);
});
