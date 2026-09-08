import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import fs from 'node:fs';

async function load(path) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try { return await server.ssrLoadModule(path); } finally { await server.close(); }
}

test('troca de seção preserva somente parâmetros compatíveis', async () => {
  const navigation = await load('/src/utils/planningNavigation.ts');
  const next = navigation.setPlanningSectionParams(new URLSearchParams('section=missoes&missao=m1&status=DRAFT&date=2026-08-21'), 'calendario');
  assert.equal(next.get('section'), 'calendario');
  assert.equal(next.has('missao'), false);
  assert.equal(next.has('status'), false);
  assert.equal(next.get('date'), '2026-08-21');
});

test('cliente de planejamento não expõe lançamento manual de HH', () => {
  const source = fs.readFileSync(new URL('../src/api/efetivoPlanning.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /lan[cç]ar.*hh|manual.*hours/i);
});

test('formulário de missão usa apenas a conta vinculada como líder', () => {
  const client = fs.readFileSync(new URL('../src/api/efetivoPlanning.ts', import.meta.url), 'utf8');
  const form = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionFormModal.tsx', import.meta.url), 'utf8');
  assert.match(client, /\/coordinators/);
  assert.match(form, /label="Vincular líder"/);
  assert.doesNotMatch(form, /Responsável da sede|Cargo do responsável/);
  assert.match(form, /item\.collaborator\?\.role/);
});

test('navegação inclui disponibilidade e preserva data e função', async () => {
  const navigation = await load('/src/utils/planningNavigation.ts');
  assert.ok(navigation.EFETIVO_SECTIONS.includes('disponibilidade'));
  const next = navigation.setPlanningSectionParams(new URLSearchParams('section=missoes&date=2026-08-21&funcao=r1&missao=m1'), 'disponibilidade');
  assert.equal(next.get('date'), '2026-08-21');
  assert.equal(next.get('funcao'), 'r1');
  assert.equal(next.has('missao'), false);
});

test('seção de colaboradores preserva colaborador, ausência e ano ao voltar', async () => {
  const navigation = await load('/src/utils/planningNavigation.ts');
  const next = navigation.setPlanningSectionParams(new URLSearchParams('section=calendario&colaborador=c1&ausencia=a1&ano=2026&missao=m1'), 'colaboradores');
  assert.equal(next.get('colaborador'), 'c1');
  assert.equal(next.get('ausencia'), 'a1');
  assert.equal(next.get('ano'), '2026');
  assert.equal(next.has('missao'), false);
});

test('colaborador e ausência selecionados pela URL são destacados na tela', () => {
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/CollaboratorsBoard.tsx', import.meta.url), 'utf8');
  const absences = fs.readFileSync(new URL('../src/pages/efetivo/components/AbsencesBoard.tsx', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../src/pages/efetivo/EfetivoPage.tsx', import.meta.url), 'utf8');
  assert.match(board, /data-collaborator-id=\{row\.id\}/);
  assert.match(board, /scrollIntoView/);
  assert.match(absences, /data-absence-id=\{absence\.id\}/);
  assert.match(page, /selectedCollaboratorId=\{selectedCollaboratorId\}/);
  assert.match(page, /selectedAbsenceId=\{selectedAbsenceId\}/);
});

test('detalhe do dia mostra pessoas, vagas em aberto e conflitos', () => {
  const detail = fs.readFileSync(new URL('../src/pages/efetivo/components/CalendarDayDetail.tsx', import.meta.url), 'utf8');
  const calendar = fs.readFileSync(new URL('../src/pages/efetivo/components/OperationalCalendar.tsx', import.meta.url), 'utf8');
  assert.match(detail, /event\.people/);
  assert.match(detail, /vagas em aberto/);
  assert.match(detail, /dayConflicts/);
  assert.match(calendar, /conflicts=\{conflicts\}/);
});
