import assert from 'node:assert/strict';
import test from 'node:test';
import { projectScopeOptions, projectWorkLocations } from '../../shared/modules/rdo-project-context.js';
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
