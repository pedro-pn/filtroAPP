import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function functionsFrom(path, names, context = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) declarations.set(node.name.text, node.getText(tree).replace(/^export\s+/, ''));
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(tree))) declarations.set(node.name.getText(tree), `const ${node.getText(tree)};`);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const name of names) assert.ok(declarations.has(name), name);
  const code = ts.transpileModule([...declarations.values(), `({${names.join(',')}});`].join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
  }).outputText;
  return runInNewContext(code, context);
}
const plain = value => JSON.parse(JSON.stringify(value));

test('scope groups restore legacy services, rename/move independently, duplicate within the scope and persist only on save', async () => {
  let state = [], seq = 0;
  const writes = [], messages = [];
  const scopeGroups = () => [...new Set(state.map(service => service.scopeKey))].map(key => ({ key, name: state.find(service => service.scopeKey === key).scopeName }));
  const context = {
    get services() { return state; }, get scopeGroups() { return scopeGroups(); }, normalHours: [], overtime: [],
    canManage: true, data: {}, staleHours: false, resolutionMutation: { isPending: false },
    loadedFingerprint: 'reviewed-hours', commercialHours: false,
    setServices: update => { state = update(state); }, nextKey: () => `key-${++seq}`,
    touchedWeights: { current: new Set() }, showToast: message => messages.push(message), mutation: { mutate: payload => writes.push(payload) }
  };
  const actions = await functionsFrom('../src/components/projects/ProjectPlannedScopeEditor.tsx', [
    'SERVICE_SYSTEMS', 'ALL_SYSTEMS', 'SYSTEM_UNIT', 'allowedSystems', 'toStr', 'toNum', 'toDiameterUnit',
    'roundToSum', 'withWeights', 'rebalanceUntouched', 'rescaleTo100', 'fromScope', 'normalize',
    'addScope', 'addService', 'changeScopeName', 'moveService', 'duplicateService', 'save'
  ], context);
  const scope = { services: [{ serviceType: 'LIMPEZA_QUIMICA', weight: 100, systems: [] }], normalHours: [], overtime: [] };
  state = actions.fromScope(scope).services;
  assert.equal(state[0].scopeName, '');
  const firstKey = state[0].scopeKey;
  actions.changeScopeName(firstKey, 'Principal');
  actions.addService(firstKey);
  assert.ok(state.every(service => service.scopeName === 'Principal' && service.scopeKey === firstKey));
  actions.addScope();
  const newKey = state.at(-1).scopeKey;
  assert.notEqual(newKey, firstKey);
  actions.changeScopeName(newKey, 'Adicional');
  const moving = state[1];
  actions.moveService(moving.key, newKey);
  assert.equal(state[0].scopeName, 'Principal');
  assert.equal(state[1].scopeName, 'Adicional');
  actions.duplicateService(moving.key);
  assert.equal(state[2].scopeKey, newKey);
  assert.equal(state[2].scopeName, 'Adicional');
  assert.notEqual(state[2].key, moving.key);
  actions.changeScopeName(newKey, 'Adicional revisado');
  assert.equal(state[1].scopeKey, newKey); // typing never changes the rendered scope key/focus
  assert.equal(state[2].scopeName, 'Adicional revisado');
  assert.equal(writes.length, 0);
  actions.save();
  assert.equal(writes.length, 1);
  assert.deepEqual(Array.from(writes[0].services, service => service.scopeName), ['Principal', 'Adicional revisado', 'Adicional revisado', 'Adicional revisado']);
  const reloaded = actions.fromScope(plain(writes[0])).services;
  assert.equal(reloaded[1].scopeKey, reloaded[2].scopeKey);
  assert.notEqual(reloaded[0].scopeKey, reloaded[1].scopeKey);
  actions.changeScopeName(newKey, 'Principal');
  actions.save();
  assert.equal(writes.length, 1);
  assert.match(messages.at(-1), /mesmo nome/);
});

async function saveHoursHarness(overrides = {}) {
  const writes = [];
  const context = {
    canManage: true, data: {}, staleHours: false, resolutionMutation: { isPending: false },
    loadedFingerprint: 'reviewed-hours', commercialHours: false, services: [], scopeGroups: [],
    normalHours: [{ jobRoleId: '', roleName: 'Operador', hours: '77,5' }],
    overtime: [{ jobRoleId: '', hours: '0' }, { jobRoleId: '', hours: '' }],
    showToast: () => {}, mutation: { mutate: payload => writes.push(plain(payload)) },
    ...overrides
  };
  const actions = await functionsFrom('../src/components/projects/ProjectPlannedScopeEditor.tsx', ['toNum', 'save'], context);
  return { save: actions.save, writes };
}

test('scope save includes the reviewed version and manual rows, but never copies commercial hours into manual records', async () => {
  const manual = await saveHoursHarness();
  manual.save();
  assert.deepEqual(manual.writes, [{
    hoursFingerprint: 'reviewed-hours', services: [],
    normalHours: [{ jobRoleId: null, roleName: 'Operador', hours: 77.5 }],
    overtime: [{ jobRoleId: null, hours: 0 }]
  }]);
  const commercial = await saveHoursHarness({ commercialHours: true });
  commercial.save();
  assert.deepEqual(commercial.writes, [{ hoursFingerprint: 'reviewed-hours', services: [] }]);
});

test('scope save does not write without permission, loaded data or a current review, or while resolving hours', async () => {
  for (const state of [{ canManage: false }, { data: undefined }, { staleHours: true }, { resolutionMutation: { isPending: true } }]) {
    const harness = await saveHoursHarness(state);
    harness.save();
    assert.deepEqual(harness.writes, [], JSON.stringify(state));
  }
});

test('scope hierarchy is rendered in planned scope and weekly pace, with an accessible local scroll area', async () => {
  const { groupServicesByScope } = await functionsFrom('../src/utils/plannedScopeGroups.ts', ['groupServicesByScope']);
  const { RequiredWeeklyProgressCard, PlannedScopeView } = await functionsFrom('../src/components/projects/ProjectDetailDashboard.tsx',
    ['SERVICE_LABELS', 'SYSTEM_LABELS', 'UNIT_LABELS', 'fmtPct', 'fmtQuantity', 'weeklyTargetText', 'RequiredWeeklyProgressCard', 'PlannedScopeView'], { React, groupServicesByScope });
  const system = { projectSystemId: 's1', equipment: 'Unidade Geradora 01', systemName: 'Kaplan', systemType: 'TUBULACAO', unit: 'M', diameter: '2', diameterUnit: 'pol', plannedQty: 100, realizedQty: 20, remainingQty: 80, status: 'REQUIRED', requiredQtyPerWeek: 40 };
  const service = { serviceType: 'LIMPEZA_QUIMICA', weight: 100, executionPct: 20, systems: [system] };
  const target = { status: 'REQUIRED', remainingPctPoints: 80, requiredPctPointsPerWeek: 40, services: [service], scopeGroups: [{ scopeName: 'Principal', services: [service] }, { scopeName: null, services: [service] }] };
  const html = renderToStaticMarkup(React.createElement(RequiredWeeklyProgressCard, { target }));
  assert.match(html, /Escopo: Principal/);
  assert.match(html, /Escopo: Sem escopo definido/);
  assert.match(html, /class="acp-weekly-target-services" role="region" aria-label="Serviços e sistemas do ritmo necessário" tabindex="0"/);
  assert.match(html, /40 m\/semana/);
  const planned = renderToStaticMarkup(React.createElement(PlannedScopeView, { scope: { services: [{ ...service, scopeName: 'Principal' }, service] } }));
  assert.match(planned, /Escopo: Principal/);
  assert.match(planned, /Escopo: Sem escopo definido/);
  const css = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8');
  assert.match(css, /\.acp-weekly-target-services\s*\{[^}]*max-height:\s*min\(420px, 55vh\)[^}]*overflow-y:\s*auto[^}]*overscroll-behavior-y:\s*contain/);
  assert.match(css, /@media print\s*\{\s*\.acp-weekly-target-services\s*\{[^}]*max-height:\s*none[^}]*overflow:\s*visible/);
});
