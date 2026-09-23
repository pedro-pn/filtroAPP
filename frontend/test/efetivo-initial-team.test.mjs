import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createServer } from 'vite';

async function load(path) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try { return await server.ssrLoadModule(path); } finally { await server.close(); }
}

const { projectExecutionSchedule } = await load('/src/utils/projectExecutionSchedule.ts');
const { buildInitialTeamContext } = await load('/src/utils/initialTeamContext.ts');
const { isPlannedRole, plannedRoleCoverage, plannedRoleIdSet } = await load('/src/utils/missionTeam.ts');
const { buildMissionAvailabilityColumns } = await load('/src/utils/collaboratorAvailability.ts');

const workflowBase = {
  leaderUserId: 'leader-1',
  leader: { id: 'leader-1', name: 'Marina' },
  plannedMobilizationDate: null,
  commercialExpectedMobilizationDate: null,
  commercialExpectedStartDate: null,
  commercialExpectedDurationDays: null,
  plannedExecutionStartDate: null,
  plannedExecutionEndDate: null,
  resourcePlanning: { team: { demands: [], catalog: [] } }
};

test('datas da equipe refletem o fluxo: valor operacional, depois previsão comercial', () => {
  assert.deepEqual(projectExecutionSchedule(workflowBase), {
    mobilizationDate: '', executionStartDate: '', executionEndDate: '',
    mobilizationSource: null, executionStartSource: null, executionEndSource: null
  });
  const commercial = projectExecutionSchedule({ ...workflowBase, commercialExpectedMobilizationDate: '2026-10-05', commercialExpectedStartDate: '2026-10-08', commercialExpectedDurationDays: 10 });
  assert.equal(commercial.mobilizationDate, '2026-10-05');
  assert.equal(commercial.executionStartDate, '2026-10-08');
  assert.equal(commercial.executionEndDate, '2026-10-17', 'início + duração - 1 dia');
  assert.equal(commercial.executionEndSource, 'COMMERCIAL');
  const planned = projectExecutionSchedule({
    ...workflowBase, plannedMobilizationDate: '2026-10-01', plannedExecutionStartDate: '2026-10-12', plannedExecutionEndDate: '2026-12-01',
    commercialExpectedStartDate: '2026-10-08', commercialExpectedDurationDays: 10
  });
  assert.equal(planned.executionStartDate, '2026-10-12');
  assert.equal(planned.executionEndDate, '2026-12-01');
  assert.equal(planned.executionStartSource, 'PLANNED');
});

test('contexto da equipe inicial traz líder, datas e cargos planejados com a família de cargos', () => {
  const context = buildInitialTeamContext({
    ...workflowBase,
    plannedMobilizationDate: '2026-10-05',
    plannedExecutionStartDate: '2026-10-08',
    plannedExecutionEndDate: '2026-11-20',
    resourcePlanning: {
      team: {
        demands: [{ jobRoleId: 'r-op', jobRoleName: 'Operador', requiredCount: 2 }, { jobRoleId: 'r-mec', jobRoleName: 'Mecânico', requiredCount: 1 }],
        catalog: [{ id: 'r-op', roleIds: ['r-op', 'r-op-2'] }, { id: 'r-mec' }]
      }
    }
  });
  assert.equal(context.leaderUserId, 'leader-1');
  assert.equal(context.leaderName, 'Marina');
  assert.equal(context.mobilizationDate, '2026-10-05');
  assert.equal(context.executionEndDate, '2026-11-20');
  assert.deepEqual(context.plannedRoles, [
    { id: 'r-op', name: 'Operador', requiredCount: 2, roleIds: ['r-op', 'r-op-2'] },
    { id: 'r-mec', name: 'Mecânico', requiredCount: 1, roleIds: ['r-mec'] }
  ]);
});

test('cargos planejados filtram colaboradores e calculam a cobertura por cargo', () => {
  const planned = [
    { id: 'r-op', name: 'Operador', requiredCount: 2, roleIds: ['r-op', 'r-op-2'] },
    { id: 'r-mec', name: 'Mecânico', requiredCount: 1, roleIds: ['r-mec'] }
  ];
  assert.deepEqual([...plannedRoleIdSet(planned)].sort(), ['r-mec', 'r-op', 'r-op-2']);
  assert.equal(isPlannedRole('r-op-2', planned), true);
  assert.equal(isPlannedRole('r-aux', planned), false);
  assert.equal(isPlannedRole(null, planned), false);
  const coverage = plannedRoleCoverage(planned, [{ jobRoleId: 'r-op' }, { jobRoleId: 'r-op-2' }, { jobRoleId: 'r-aux' }]);
  assert.deepEqual(coverage.rows.map(row => [row.role.id, row.selected]), [['r-op', 2], ['r-mec', 0]]);
  assert.equal(coverage.outsidePlan, 1);
});

test('disponibilidade lista quem não estará disponível no período, com o motivo', () => {
  const person = (id, name, extra = {}) => ({ id, name, role: 'Operador', jobRoleId: 'r-op', admissionDate: '2020-01-01', terminationDate: null, isActive: true, status: 'FREE', plannedUtilization90d: null, vacationAlert: null, ...extra });
  const { columns, unavailable, otherUnavailable } = buildMissionAvailabilityColumns(
    [person('c1', 'Ana'), person('c2', 'Bruno'), person('c3', 'Carla', { terminationDate: '2026-10-20' }), person('c4', 'Davi')],
    [],
    [
      { id: 'a1', collaboratorId: 'c2', type: 'AFASTAMENTO', startDate: '2026-10-01', endDate: '2026-12-01' },
      { id: 'a2', collaboratorId: 'c4', type: 'FERIAS', startDate: '2026-10-10', endDate: '2026-10-20' }
    ],
    '2026-10-05',
    '2026-11-20'
  );
  assert.deepEqual(columns.AVAILABLE.map(entry => entry.collaborator.name), ['Ana']);
  assert.deepEqual(columns.ON_VACATION.map(entry => entry.collaborator.name), ['Davi']);
  assert.deepEqual(unavailable.map(entry => [entry.collaborator.name, entry.reason]), [['Bruno', 'ABSENCE'], ['Carla', 'OUTSIDE_EMPLOYMENT']]);
  assert.equal(otherUnavailable, 2);
});

test('diálogo de equipe inicial reflete o fluxo e segue o UI atual', () => {
  const form = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionFormModal.tsx', import.meta.url), 'utf8');
  const selector = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionTeamSelector.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  const analysis = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  // líder e datas vêm do fluxo; o campo "Vincular líder" só existe fora da equipe inicial
  assert.match(form, /context \? \(\s*<div className="field-group efetivo-form-wide efetivo-team-reflected" data-efetivo-team-leader>/);
  assert.match(form, /readOnly=\{reflected\}/);
  assert.match(form, /plannedRoles=\{context\?\.plannedRoles\}/);
  assert.match(board, /buildInitialTeamContext\(detail\.data\.workflow\)/);
  assert.match(board, /context=\{teamContext\}/);
  // seleção parte dos cargos planejados, com toggle para ver todos e avisos
  assert.match(selector, /Mostrar todos os colaboradores/);
  assert.match(selector, /Cargo fora do planejamento desta obra/);
  assert.match(selector, /não estará disponível/);
  assert.match(selector, /filterByPlan/);
  assert.match(selector, /efetivo-team-dialog/);
  // início e fim da execução são definidos na análise inicial
  assert.match(analysis, /action: 'analysis_schedule'/);
  assert.match(analysis, /Início da execução previsto/);
  assert.match(analysis, /Fim da execução previsto/);
  assert.match(styles, /\.efetivo-team-dialog,\s*\.project-workflow-stage-tip-balloon/);
});

test('equipe inicial abre direto em "Colaboradores por disponibilidade", sem o formulário antigo como etapa intermediária', () => {
  const form = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionFormModal.tsx', import.meta.url), 'utf8');
  const selector = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionTeamSelector.tsx', import.meta.url), 'utf8');
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx', import.meta.url), 'utf8');
  // o board usa o componente direto, não mais o MissionFormModal completo, para "Definir/Editar equipe inicial"
  assert.match(board, /import \{ InitialTeamAvailabilityModal \} from '\.\/MissionFormModal';/);
  assert.match(board, /<InitialTeamAvailabilityModal/);
  assert.doesNotMatch(board, /<MissionFormModal/);
  // o novo componente abre o MissionTeamSelector direto (autoOpen), sem o gatilho "Ver colaboradores"
  const directComponent = form.slice(form.indexOf('export function InitialTeamAvailabilityModal'));
  assert.match(directComponent, /<MissionTeamSelector/);
  assert.match(directComponent, /autoOpen/);
  assert.match(directComponent, /minSelected=\{1\}/);
  assert.match(directComponent, /onCancel=\{onClose\}/);
  // sem as datas da obra ainda não há como consultar disponibilidade: uma etapa mínima as pede antes
  assert.match(directComponent, /Confirme as datas da obra para consultar a disponibilidade/);
  assert.match(directComponent, /showDateForm/);
  // MissionTeamSelector esconde o fieldset/gatilho "Ver colaboradores" quando aberto direto
  assert.match(selector, /autoOpen \? null : <fieldset/);
  assert.match(selector, /minSelected = 0/);
  assert.match(selector, /draftIds\.length < minSelected/);
});
