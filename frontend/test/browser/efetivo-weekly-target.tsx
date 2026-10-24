// Planejamento do projeto (Efetivo) na etapa Execução, com o painel real e API simulada.
// A meta é a mesma do Acompanhamento: o card, o cadastro e o histórico usam o mesmo projeto.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import { Modal } from '../../src/components/ui/Modal';
import { ToastContext } from '../../src/components/ui/ToastContext';
import { ProjectExecutionDashboard } from '../../src/pages/efetivo/components/ProjectExecutionDashboard';
import { ProjectWorkflowCategory } from '../../src/pages/efetivo/components/ProjectWorkflowCategory';
import '../../src/styles/variables.css';
import '../../src/styles/base.css';
import '../../src/pages/efetivo/efetivo.css';
import '../../src/pages/efetivo/EfetivoPage.ds.css';
import '../../src/pages/efetivo/EfetivoDialogs.css';

const params = new URLSearchParams(location.search);
if (params.has('dark')) document.documentElement.classList.add('dark');
const readOnly = params.has('leitor');

// 20 m por colaborador/dia, contagem de sexta a quinta: [dias com RDO, equipe do RDO, metros].
const periods: [string[], number[], number][] = [
  [['09-11', '09-12', '09-14', '09-15', '09-16'], [3, 3, 2, 3, 3], 290],
  [['09-18', '09-19', '09-21', '09-22', '09-23', '09-24'], [3, 3, 3, 2, 3, 3], 310],
  [['09-25', '09-29', '09-30', '10-01'], [2, 3, 3, 2], 215],
  [['10-02', '10-03', '10-05', '10-06', '10-07', '10-08'], [3, 3, 4, 4, 3, 3], 410],
  [['10-09', '10-10', '10-13', '10-14', '10-15'], [3, 2, 3, 3, 3], 250],
  [['10-16', '10-19', '10-20'], [3, 2, 4], 165]
];
const serviceHistory = periods.flatMap(([days, crews, total]) => days.flatMap((day, i) => {
  const date = `2026-${day}`, sum = crews.reduce((a, b) => a + b, 0);
  return [{ date, serviceType: 'LIMPEZA_QUIMICA', quantities: { M: Math.round(total * crews[i] / sum * 100) / 100, L: 0, UN: 0 } },
    { date, serviceType: 'LIMPEZA_QUIMICA', quantities: { M: 0, L: 0, UN: 0 }, productivityIssues: [], productivePersonDays: crews[i] }];
}));
const stored = [{
  id: 't1', weekStartDate: '2026-09-07', plannedPctPoints: null, revision: 1, author: { id: 'u1', name: 'Coordenação de projetos' }, createdAt: '2026-09-10T14:30:00Z',
  definition: { version: 2, logic: 'ALL', countingStartDay: 5, countingEndDay: 4, repeatWeekly: true,
    goals: [{ kind: 'SERVICE', serviceType: 'LIMPEZA_QUIMICA', metric: 'M', basis: 'PER_PRODUCTIVE_DAY', value: 20 }] }
}];
const dashboard = {
  schedule: { plannedProgressPct: 70, actualProgressPct: 67.5, progressMethod: 'SCOPE', elapsedDays: 40, plannedDays: 61, startDate: '2026-09-14', expectedEndDate: '2026-11-13', projectedEndDate: '2026-11-18' },
  rdo: { receivedCount: 33, overdueCount: 0, overdueDates: [], recent: [], pendingOrReturnedCount: 1, releasedToClientCount: 30, signedCount: 30, withQuantitiesCount: 31, withEvidenceCount: 33, evidenceCount: 120, lastReportDate: '2026-10-22' },
  reports: [], signatures: { signedCount: 30, pendingCount: 3, signedReports: [], pendingReports: [] },
  scope: null, progress: null,
  weeklyReview: { active: true, pendingCount: 1, nextDueDate: '2026-10-29', recentCompleted: [], permissions: { canVerify: !readOnly },
    pending: [{ weekStartDate: '2026-10-19', dueDate: '2026-10-22', note: '', completedAt: null, completedBy: null, checkedCount: 5,
      checks: { PROGRESS: true, SERVICE_FRONTS: true, DIFFICULTIES: true, DEVIATIONS_INCIDENTS: true, REPORT_DELIVERY: true, REPORT_SIGNATURES: false, WEEKLY_TARGET: false } }] },
  technicalReports: [], deviations: [], permissions: { canEdit: true }
};

apiClient.defaults.adapter = async config => {
  const response = (data: unknown) => ({ config, status: 200, statusText: 'OK', headers: {}, data });
  if (config.url?.endsWith('/weekly-targets')) {
    if (config.method === 'put') {
      const input = JSON.parse(config.data);
      const record = { ...input, id: `t${stored.length + 1}`, plannedPctPoints: null, revision: input.expectedRevision + 1, author: { id: 'u1', name: 'Planejador' }, createdAt: new Date().toISOString() };
      stored.push(record);
      return response(record);
    }
    return response({ targets: stored.slice(), workdays: [1, 2, 3, 4, 5], progressHistory: [], serviceHistory, attendanceHistory: [] });
  }
  if (config.url?.endsWith('/execution')) return response(dashboard);
  return response([]);
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}>
  <ToastContext.Provider value={{ showToast() {} }}>
    <Modal open onClose={() => {}} ariaLabelledBy="workflow-title" panelClassName="modal-card efetivo-modal project-workflow-modal">
      <div className="efetivo-modal-layout">
        <header className="efetivo-modal-header project-workflow-header">
          <div className="project-workflow-header-id"><span className="project-workflow-code">5812</span>
            <div><h3 id="workflow-title">Limpeza química das linhas de vapor</h3><p>Usina Termelétrica Vale do Rio Claro · Rio Claro/SP</p></div></div>
        </header>
        <div className="efetivo-modal-body project-workflow-body" style={{ overflow: 'auto' }}>
          <ProjectWorkflowCategory title="Dashboard de execução" description="Escopo, avanço físico, RDOs, assinaturas e desvios da obra." area="Execução" status="Acompanhamento ativo">
            <ProjectExecutionDashboard projectId="p1" missionId="m1" canManageTargets={!readOnly} readOnly={readOnly} />
          </ProjectWorkflowCategory>
        </div>
      </div>
    </Modal>
  </ToastContext.Provider>
</QueryClientProvider>);
