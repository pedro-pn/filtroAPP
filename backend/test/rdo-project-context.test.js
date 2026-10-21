import assert from 'node:assert/strict';
import test from 'node:test';
import { findProjectScopeOption, projectScopeOptions, projectWorkLocations, reportWorkLocation } from '../../shared/modules/rdo-project-context.js';
import { assertRdoProjectContext } from '../src/lib/reports/project-context-validation.js';

const project = {
  id: 'project-1', location: 'Oficina', additionalWorkLocations: ['Canteiro'],
  plannedServices: [{ scopeName: 'UG 1' }, { scopeName: 'UG 1' }, { scopeName: 'UG 2' }]
};
const reportData = () => ({
  reportType: 'RDO', specialConditions: { workLocation: 'Canteiro' },
  services: [{ extraData: { __scopeKey: JSON.stringify('UG 1') } }]
});
const invalid = error => error.statusCode === 400;

test('escopos são únicos e incluem o grupo legado sem nome', () => {
  assert.equal(projectScopeOptions(project).length, 2);
  assert.deepEqual(projectScopeOptions({ plannedServices: [{ scopeName: '' }, { scopeName: null }, { scopeName: ' UG 1 ' }] }), [
    { value: 'null', name: null, label: 'Sem escopo definido' },
    { value: '"UG 1"', name: 'UG 1', label: 'UG 1' }
  ]);
});

test('locais existentes continuam disponíveis, sem espaços ou duplicatas', () => {
  assert.deepEqual(projectWorkLocations({ location: ' Oficina ', additionalWorkLocations: ['Oficina', ' Canteiro ', ''] }), ['Oficina', 'Canteiro']);
  assert.deepEqual(projectWorkLocations({ location: 'Oficina' }), ['Oficina']);
});

test('local único acompanha o cadastro atual; vários locais preservam a escolha do RDO', () => {
  assert.equal(reportWorkLocation({ location: 'Local atualizado' }, 'Local anterior'), 'Local atualizado');
  assert.equal(reportWorkLocation(project, 'Canteiro'), 'Canteiro');
  assert.equal(reportWorkLocation(project, ''), '');
});

test('salvar RDO antigo atualiza o local único e preserva as demais condições especiais', () => {
  const updatedProject = { id: project.id, location: 'Local atualizado' };
  const existing = { projectId: project.id, specialConditions: { workLocation: 'Local anterior' } };
  const data = { reportType: 'RDO', services: [], specialConditions: { ...existing.specialConditions, standby: true } };
  assertRdoProjectContext(updatedProject, data, existing);
  assert.deepEqual(data.specialConditions, { workLocation: 'Local atualizado', standby: true });
});

test('RDO exige escopo válido em cada serviço quando há vários grupos', () => {
  for (const value of [undefined, '', '"Outro projeto"']) {
    const data = reportData();
    data.services.push({ extraData: { __scopeKey: value } });
    assert.throws(() => assertRdoProjectContext(project, data), invalid);
  }
  const data = reportData();
  data.services.push({ extraData: { __scopeKey: '"UG 2"', __scopeName: 'Nome adulterado' } });
  assertRdoProjectContext(project, data);
  assert.equal(data.services[1].extraData.__scopeName, 'UG 2');
});

test('RDO exige seleção do local entre os locais do projeto', () => {
  for (const location of [undefined, '', 'Local de outro projeto']) {
    const data = reportData();
    data.specialConditions.workLocation = location;
    assert.throws(() => assertRdoProjectContext(project, data), invalid);
  }
  assert.doesNotThrow(() => assertRdoProjectContext(project, reportData()));
});

test('projetos com um único local ou escopo dispensam seleção e salvam o local', () => {
  const data = { reportType: 'RDO', services: [{ extraData: {} }] };
  assertRdoProjectContext({ id: 'p', location: 'Oficina', plannedServices: [{ scopeName: 'Único' }] }, data);
  assert.equal(data.specialConditions.workLocation, 'Oficina');
});

test('sem serviços não exige escopo; grupo sem nome pode ser selecionado', () => {
  assert.doesNotThrow(() => assertRdoProjectContext(project, { reportType: 'RDO', services: [], specialConditions: { workLocation: 'Canteiro' } }));
  const data = reportData();
  data.services[0].extraData.__scopeKey = 'null';
  assertRdoProjectContext({ ...project, plannedServices: [{ scopeName: null }, { scopeName: 'UG 1' }] }, data);
  assert.equal(data.services[0].extraData.__scopeName, null);
  data.services[0].extraData.__scopeKey = null;
  assert.throws(() => assertRdoProjectContext({ ...project, plannedServices: [{ scopeName: null }, { scopeName: 'UG 1' }] }, data), invalid);
});

test('editar preserva o local histórico, mas trocar de projeto exige local válido', () => {
  const existing = { projectId: project.id, specialConditions: { workLocation: 'Local antigo' } };
  const data = reportData();
  data.specialConditions.workLocation = 'Local antigo';
  assert.doesNotThrow(() => assertRdoProjectContext(project, data, existing));
  assert.throws(() => assertRdoProjectContext({ ...project, id: 'project-2' }, data, existing), invalid);
  const missing = reportData();
  delete missing.specialConditions.workLocation;
  assert.throws(() => assertRdoProjectContext(project, missing, { projectId: project.id }), invalid);
});

test('escopo removido não bloqueia edição quando a lista deixa de aparecer', () => {
  const data = reportData();
  assertRdoProjectContext({ ...project, plannedServices: [{ scopeName: 'UG 2' }] }, data);
  assert.equal(data.services[0].extraData.__scopeKey, undefined);
});

test('relatórios de serviço mantêm o fluxo existente', () => {
  assert.doesNotThrow(() => assertRdoProjectContext(project, { reportType: 'RLQ', services: [{ extraData: {} }] }));
});

test('escopos homônimos de propostas distintas permanecem opções distintas', () => {
  const options = projectScopeOptions({ plannedServices: [
    { scopeName: 'Vasos', contributionKey: 'ACCESS_IMPORT:4586' },
    { scopeName: 'Vasos', contributionKey: 'ACCESS_IMPORT:4619' }
  ] });
  assert.equal(options.length, 2);
  assert.notEqual(options[0].value, options[1].value);
  assert.match(options[0].label, /4586/);
  assert.match(options[1].label, /4619/);
  assert.equal(findProjectScopeOption(options, '"Vasos"'), undefined);
  assert.equal(findProjectScopeOption(options, options[1].value), options[1]);
});

test('salvar o RDO registra a proposta do escopo pelo cadastro e aceita seleção antiga não ambígua', () => {
  const scopedProject = { id: project.id, plannedServices: [
    { scopeName: 'Vasos', contributionKey: 'ACCESS_IMPORT:4586' },
    { scopeName: 'APVs' }
  ] };
  const data = { reportType: 'RDO', services: [{ extraData: { __scopeKey: '"Vasos"',
    __proposalScope: { projectId: 'outro', contributionKey: 'ACCESS_IMPORT:4619' } } }] };
  assertRdoProjectContext(scopedProject, data);
  assert.equal(data.services[0].extraData.__scopeKey, '["ACCESS_IMPORT:4586","Vasos"]');
  assert.deepEqual(data.services[0].extraData.__proposalScope, { projectId: project.id, contributionKey: 'ACCESS_IMPORT:4586' });
  data.services[0].extraData.__scopeKey = '"APVs"';
  assertRdoProjectContext(scopedProject, data);
  assert.equal(data.services[0].extraData.__proposalScope, undefined, 'trocar de escopo limpa a origem anterior');
});

test('um único escopo também salva a proposta, mesmo sem campo de seleção', () => {
  const data = { reportType: 'RDO', services: [{ extraData: {} }] };
  assertRdoProjectContext({ id: 'p', plannedServices: [{ scopeName: 'Vasos', contributionKey: 'COMERCIAL_APP:4586' }] }, data);
  assert.deepEqual(data.services[0].extraData.__proposalScope, { projectId: 'p', contributionKey: 'COMERCIAL_APP:4586' });
});

test('seleção antiga ambígua exige escolher a proposta; troca de projeto remove origem forjada', () => {
  const data = { reportType: 'RDO', services: [{ extraData: { __scopeKey: '"Vasos"',
    __proposalScope: { projectId: 'outro', contributionKey: 'ACCESS_IMPORT:4586' } } }] };
  const plannedServices = ['ACCESS_IMPORT:4586', 'ACCESS_IMPORT:4619'].map(contributionKey => ({ scopeName: 'Vasos', contributionKey }));
  assert.throws(() => assertRdoProjectContext({ id: 'p', plannedServices }, data), invalid);
  assertRdoProjectContext({ id: 'p', plannedServices: [] }, data);
  assert.equal(data.services[0].extraData.__proposalScope, undefined);
});
