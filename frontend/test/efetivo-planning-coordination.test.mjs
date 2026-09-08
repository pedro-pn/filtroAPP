import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createServer } from 'vite';

async function load(path) {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try { return await server.ssrLoadModule(path); } finally { await server.close(); }
}

function fakeDocument() {
  const classes = new Set();
  return {
    body: {
      classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value)
      }
    }
  };
}

test('refresh de missão notifica o cenário depois de invalidar as leituras compartilhadas', async () => {
  const { refreshMissionPlanningQueries } = await load('/src/utils/efetivoPlanningQueries.ts');
  const invalidated = [];
  let scenarioRefreshed = false;
  await refreshMissionPlanningQueries({
    invalidateQueries: async ({ queryKey }) => { invalidated.push(queryKey); }
  }, async () => { scenarioRefreshed = true; });

  assert.deepEqual(invalidated, [
    ['efetivo-planning-missions'],
    ['efetivo-planning-missions-pending'],
    ['efetivo-planning-overview'],
    ['efetivo-planning-calendar']
  ]);
  assert.equal(scenarioRefreshed, true);
});

test('coordenador de guias reserva uma única experiência por vez', async () => {
  const { releaseEfetivoGuide, reserveEfetivoGuide } = await load('/src/utils/efetivoGuideCoordinator.ts');
  const documentRef = fakeDocument();

  assert.equal(reserveEfetivoGuide(documentRef), true);
  assert.equal(reserveEfetivoGuide(documentRef), false);
  releaseEfetivoGuide(documentRef);
  assert.equal(reserveEfetivoGuide(documentRef), true);
  releaseEfetivoGuide(documentRef);
  documentRef.body.classList.add('driver-active');
  assert.equal(reserveEfetivoGuide(documentRef), false);
});

test('líder vinculado é o único campo de responsabilidade no input da missão', () => {
  const api = fs.readFileSync(new URL('../src/api/efetivoPlanning.ts', import.meta.url), 'utf8');
  const openapi = fs.readFileSync(new URL('../../specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml', import.meta.url), 'utf8');
  const schemas = fs.readFileSync(new URL('../../backend/src/lib/efetivo/planning/schemas.js', import.meta.url), 'utf8');

  assert.match(api, /headquartersResponsibleUserId:\s*string;/);
  assert.match(openapi, /required:\s*\[[^\]]*headquartersResponsibleUserId[^\]]*\]/);
  assert.match(schemas, /headquartersResponsibleUserId:\s*idSchema/);
  const input = api.match(/export interface MissionInput \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(input, /headquartersResponsible(Name|Role|CollaboratorId)|\bstage:/);
  const inputSchema = schemas.match(/export const missionInputSchema = z\.object\(\{[\s\S]*?\n\}\);/)?.[0] || '';
  assert.doesNotMatch(inputSchema, /headquartersResponsible(Name|Role|CollaboratorId)|\bstage:/);
});

test('equipe da missão usa collaboratorIds no tipo, OpenAPI e schema Zod', () => {
  const api = fs.readFileSync(new URL('../src/api/efetivoPlanning.ts', import.meta.url), 'utf8');
  const openapi = fs.readFileSync(new URL('../../specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml', import.meta.url), 'utf8');
  const schemas = fs.readFileSync(new URL('../../backend/src/lib/efetivo/planning/schemas.js', import.meta.url), 'utf8');

  assert.match(api, /collaboratorIds:\s*string\[\];/);
  assert.doesNotMatch(api.match(/export interface MissionInput \{[\s\S]*?\n\}/)?.[0] || '', /demands:/);
  assert.match(openapi, /required:\s*\[[^\]]*collaboratorIds[^\]]*\]/);
  assert.match(schemas, /collaboratorIds:\s*z\.array\(idSchema\)/);
});

test('retorno é reaproveitado como desmobilização opcional', () => {
  const api = fs.readFileSync(new URL('../src/api/efetivoPlanning.ts', import.meta.url), 'utf8');
  const form = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionFormModal.tsx', import.meta.url), 'utf8');
  const schemas = fs.readFileSync(new URL('../../backend/src/lib/efetivo/planning/schemas.js', import.meta.url), 'utf8');
  assert.match(api.match(/export interface MissionInput \{[\s\S]*?\n\}/)?.[0] || '', /returnDate\?:\s*DateOnly \| null/);
  assert.match(schemas, /returnDate:\s*dateOnlySchema\.nullable\(\)\.optional\(\)/);
  assert.match(form, /mission-returnDate/);
  assert.match(form, /Desmobilização/);
  assert.doesNotMatch(form, /Retorno/);
});

test('seletor de equipe abre em portal mesmo antes de preencher o período', () => {
  const selector = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionTeamSelector.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  const confirmDialog = fs.readFileSync(new URL('../src/components/ui/ConfirmDialog.tsx', import.meta.url), 'utf8');
  const baseStyles = fs.readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8');
  const trigger = selector.match(/<Button variant="secondary"[\s\S]*?Ver colaboradores<\/Button>/)?.[0] || '';

  assert.match(selector, /createPortal\(<Modal[\s\S]*document\.body\)/);
  assert.match(selector, /backdropClassName="modal-backdrop efetivo-team-availability-backdrop"/);
  assert.match(trigger, /disabled=\{disabled\}/);
  assert.doesNotMatch(trigger, /!validPeriod|loading/);
  assert.match(selector, /Informe o período da missão/);
  assert.match(styles, /\.efetivo-team-availability-backdrop\s*\{[^}]*z-index:\s*1100;/);
  assert.match(confirmDialog, /createPortal\(dialog, document\.body\)/);
  assert.match(confirmDialog, /confirm-dialog-backdrop/);
  assert.match(baseStyles, /\.confirm-dialog-backdrop\s*\{[^}]*z-index:\s*1200;/);
});

test('programação mostra e envia mobilização e desmobilização por colaborador', () => {
  const selector = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionTeamSelector.tsx', import.meta.url), 'utf8');
  const form = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionFormModal.tsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/api/efetivoPlanning.ts', import.meta.url), 'utf8');
  const openapi = fs.readFileSync(new URL('../../specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml', import.meta.url), 'utf8');

  assert.match(selector, /Datas individuais da equipe/);
  assert.match(selector, /collaborator\?\.name/);
  assert.match(selector, /collaborator\?\.role/);
  assert.match(selector, /mission-team-mobilization-/);
  assert.match(selector, /mission-team-demobilization-/);
  assert.match(form, /name:\s*\['mobilizationDate', 'executionEndDate', 'returnDate', 'allocationPeriods'\]/);
  assert.match(api.match(/export interface MissionInput \{[\s\S]*?\n\}/)?.[0] || '', /allocationPeriods:/);
  assert.match(openapi, /allocationPeriods:[\s\S]*?mobilizationDate:[\s\S]*?demobilizationDate:/);
});
