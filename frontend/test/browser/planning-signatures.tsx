import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import { AuthContext } from '../../src/auth/AuthContext';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { ToastContext } from '../../src/components/ui/ToastContext';
import { Modal } from '../../src/components/ui/Modal';
import { MissionAllocationModal } from '../../src/pages/efetivo/components/MissionAllocationModal';
import { AssinaturasPage } from '../../src/pages/assinaturas/AssinaturasPage';
import type { PlanningMission } from '../../src/api/efetivoPlanning';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';
import '../../src/pages/efetivo/efetivo.css';

const options = new URLSearchParams(window.location.search);
const mode = options.get('mode');
const role = { id: 'role', name: 'Técnico', isActive: true, isOperational: true };
const people = ['Ana', 'Bruno', 'Carla'].map((name, index) => ({ id: `c${index + 1}`, name, role: role.name, jobRoleId: role.id, isActive: true, admissionDate: null, terminationDate: null, status: 'FREE', vacationAlert: null }));
let storedMission = {
  id: 'mission', planId: 'plan', projectId: 'project', stage: options.get('stage') === 'mobilization' ? 'MOBILIZATION' : 'EXECUTION',
  project: { id: 'project', code: 'P1', name: 'Planejamento de teste' }, scheduleStatus: 'CONFIRMED',
  mobilizationDate: '2026-10-10', executionStartDate: '2026-10-10', executionEndDate: '2026-10-20', returnDate: null,
  cycles: [{ id: 'general', isDefault: true, mobilizationDate: '2026-10-10', demobilizationDate: null }],
  demands: [{ jobRoleId: role.id, requiredCount: 2, jobRole: role }],
  allocations: people.slice(0, 2).map((collaborator, index) => ({ id: `a${index + 1}`, collaboratorId: collaborator.id, collaborator, jobRoleId: role.id, jobRole: role,
    mobilizationDate: null, demobilizationDate: null, cycles: index === 0 ? [{ id: 'own', mobilizationDate: '2026-10-10', demobilizationDate: null }] : [] }))
} as PlanningMission;
const signatureDocument = { id: 'doc', title: 'Contrato de teste', originalFileName: 'contrato.pdf', status: 'CONCLUIDO', pageCount: 1,
  signerCount: 1, signedCount: 1, progressLabel: '1 de 1 assinaturas', createdAt: '2026-10-01T12:00:00Z', completedAt: '2026-10-02T12:00:00Z',
  isArchived: options.get('tab') === 'archived' || options.get('list') === 'archived', archivedAt: null, deletedAt: null,
  signers: [], fields: [], progress: { signed: 1, total: 1 }, pageDimensions: [] };
const paginatedDocuments = Array.from({ length: 47 }, (_, index) => ({
  ...signatureDocument, id: `completed-${index + 1}`, title: `Contrato concluído ${index + 1}`, isArchived: false
})).concat(Array.from({ length: 12 }, (_, index) => ({
  ...signatureDocument, id: `pending-${index + 1}`, title: `Contrato pendente ${index + 1}`, status: 'AGUARDANDO_ASSINATURAS', isArchived: false
})), Array.from({ length: 7 }, (_, index) => ({
  ...signatureDocument, id: `archived-${index + 1}`, title: `Contrato arquivado ${index + 1}`, isArchived: true
})));
const signatureListRequests: unknown[] = [];
Object.assign(window, { signatureListRequests });
if (options.get('observer') === 'off') Object.defineProperty(window, 'IntersectionObserver', { value: undefined, configurable: true });
let failNextSignaturePage = options.get('pageError') === 'once';
const writes: unknown[] = [];
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  let data: unknown = [];
  if (url.includes('/assinaturas/documentos')) {
    if (url.endsWith('/doc')) data = signatureDocument;
    else if (options.get('pagination') === '1') {
      const filters = config.params || {};
      const documents = paginatedDocuments.filter(item => item.isArchived === Boolean(filters.arquivados)
        && (!filters.status || item.status === filters.status)
        && (!filters.q || item.title.toLowerCase().includes(String(filters.q).toLowerCase())));
      const start = filters.cursor ? documents.findIndex(item => item.id === filters.cursor) + 1 : 0;
      const items = documents.slice(start, start + 20);
      signatureListRequests.push({ ...filters });
      await new Promise(resolve => setTimeout(resolve, 150));
      if (filters.cursor && failNextSignaturePage) {
        failNextSignaturePage = false;
        throw new Error('Falha simulada ao carregar a próxima página.');
      }
      data = { items, nextCursor: start + items.length < documents.length ? items.at(-1)?.id : null };
    } else data = { items: [signatureDocument], nextCursor: null };
  }
  else if (url.includes('/job-roles')) data = [role];
  else if (url.includes('/collaborators')) data = people;
  else if (url.endsWith('/missions')) data = [storedMission];
  if (config.method === 'patch' && url.endsWith('/cycles/own')) {
    const payload = JSON.parse(config.data);
    writes.push({ url, payload });
    storedMission = { ...storedMission, allocations: storedMission.allocations.map(allocation => allocation.id === 'a1'
      ? { ...allocation, cycles: [{ id: 'own', ...payload }] } : allocation) };
    data = storedMission.allocations[0].cycles![0];
  } else if (config.method === 'post' && url.endsWith('/allocations')) {
    const payload = JSON.parse(config.data);
    writes.push({ url, payload });
    storedMission = { ...storedMission, allocations: [...storedMission.allocations, { id: 'a3', ...payload, collaborator: people[2], jobRole: role, cycles: [] }] };
    data = storedMission.allocations.at(-1);
  }
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};

function PlanningFixture() {
  const [mission, setMission] = useState(storedMission);
  const [open, setOpen] = useState(true);
  return <>
    <button onClick={() => setOpen(true)}>Abrir planejamento</button>
    <output data-test-writes>{JSON.stringify(writes)}</output>
    <Modal open={open} onClose={() => setOpen(false)} ariaLabel="Planejamento" panelClassName="modal-card efetivo-modal project-workflow-modal">
      <h1>Planejamento</h1>
      <MissionAllocationModal mission={mission} open embedded canManage allowCycleChanges={mission.stage === 'EXECUTION'} mobilizationConfirmed
        onPlanningMutated={() => setMission(storedMission)} />
    </Modal>
  </>;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const noop = async () => {};
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><ThemeProvider><QueryClientProvider client={client}>
  <AuthContext.Provider value={{ user: null, token: null, isBootstrapping: false, isAuthenticated: false, login: noop, logout: noop, refreshUser: noop, replaceUser() {} }}>
    <ToastContext.Provider value={{ showToast() {} }}><BrowserRouter>{mode === 'signatures' ? <AssinaturasPage /> : <PlanningFixture />}</BrowserRouter></ToastContext.Provider>
  </AuthContext.Provider>
</QueryClientProvider></ThemeProvider></React.StrictMode>);
