// Real manager page with simulated API responses; no database or network writes.
import React from 'react';
import { AxiosError } from 'axios';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import { AuthContext } from '../../src/auth/AuthContext';
import { ToastProvider } from '../../src/components/ui/Toast';
import { GestorPage } from '../../src/pages/gestor/GestorPage';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { matchesSearch, reportSearchParts } from '../../src/utils/search';
import type { Project, ReportSummary } from '../../src/types/domain';
import type { AuthUser } from '../../src/types/auth';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';

const user: AuthUser = {
  id: 'project-search-manager', username: 'project-search-manager', name: 'Gestor de teste',
  email: null, role: 'MANAGER', accountType: 'ADMIN', moduleRoles: [],
  reportEmissionPermissions: ['SITE_RDO'], isActive: true
};
function project(id: string, code: string, name: string, isActive: boolean): Project {
  return {
    id, code, name, isActive, clientName: 'Cliente de teste', clientCnpj: '12345678000190',
    clientEmailPrimary: '', clientEmailCc: [], clientSigners: [], contractCode: 'CT-TESTE',
    location: 'São Paulo', managerOnly: false, visibleToCollaborators: false,
    registrationPending: false, inhibitionServiceEnabled: false, requireServiceReportSignatures: false,
    workdayHours: '08:00', weekendWorkdayHours: '08:00', includesSaturday: false, includesSunday: false,
    operatorId: null, reportSequences: []
  };
}
const archivedProjects = [
  project('archived-villaris', '5807', 'VILLARIS', false),
  project('archived-empty', '5808', 'Sem relatórios', false),
  project('archived-other', '9999', 'Outro projeto', false)
];
const activeProjects = [
  project('active-villaris', '5807', 'VILLARIS', true),
  project('active-other', '9999', 'Outro projeto', true)
];
if (new URLSearchParams(window.location.search).has('pending')) activeProjects[0].registrationPending = true;
if (new URLSearchParams(window.location.search).has('service-signers')) {
  Object.assign(activeProjects[0], {
    clientEmailPrimary: 'principal@example.com', clientSignerFirstName: 'Cliente', clientSignerLastName: 'Principal',
    clientEmailCc: ['fiscal@example.com'],
    clientSigners: [{ name: 'Fiscal Silva', firstName: 'Fiscal', lastName: 'Silva', email: 'fiscal@example.com' }],
    requireServiceReportSignatures: true
  });
}
const report = {
  id: 'report-other', projectId: archivedProjects[2].id, project: archivedProjects[2],
  reportType: 'RDO', sequenceNumber: 1, status: 'APPROVED', reportDate: '2026-10-01',
  dailyDescription: 'Teste de pressão', specialConditions: {}, collaborators: [], services: []
} as ReportSummary;

const projectCreateRequests: unknown[] = [];
Object.assign(window, { projectCreateRequests });

apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  let data: unknown = [];
  if (url.endsWith('/notifications')) {
    data = { items: [], criticalItems: [], unreadCount: 0, snapshotAt: new Date().toISOString(), nextCursor: null };
  } else if (config.method === 'post' && url.endsWith('/projects')) {
    const payload = JSON.parse(config.data);
    projectCreateRequests.push(payload);
    const params = new URLSearchParams(window.location.search);
    if (params.has('create-error') && projectCreateRequests.length === 1) throw new AxiosError('Falha simulada', undefined, config, undefined, {
      config, status: 500, statusText: 'Internal Server Error', headers: {}, data: { error: 'Falha simulada ao criar projeto.' }
    });
    if (params.has('create-delay')) await new Promise<void>(resolve => Object.assign(window, { finishProjectCreate: resolve }));
    const created = { ...project(`created-${projectCreateRequests.length}`, payload.code, payload.name, true), ...payload };
    activeProjects.push(created);
    data = created;
  } else if (config.method === 'put' && url.endsWith('/projects/active-villaris')) {
    Object.assign(activeProjects[0], JSON.parse(config.data));
    data = activeProjects[0];
  } else if (url.endsWith('/projects')) {
    data = config.params?.active === false ? archivedProjects : activeProjects;
  } else if (url.endsWith('/bootstrap/gestor')) {
    data = { activeProjects, archivedProjects, collaborators: [], surveys: [], projectSegments: [], surveyQuestions: [] };
  } else if (url.endsWith('/reports/counts')) {
    const queries = JSON.parse(config.data).queries;
    data = { totals: queries.map(() => 0) };
  } else if (url.endsWith('/reports')) {
    const query = String(config.params?.search || '');
    const items = matchesSearch(reportSearchParts(report), query) ? [report] : [];
    // The target project's reports are outside the loaded page; group totals alone must not hide its card.
    data = {
      items,
      pagination: { page: 1, pageSize: 50, total: items.length, totalPages: items.length ? 1 : 0 },
      groups: [
        { projectId: 'archived-villaris', reportType: 'RDO', total: 75 },
        { projectId: report.projectId, reportType: 'RDO', total: items.length }
      ],
      meta: { projectTotal: 2 }
    };
    if (!config.params?.page) data = items;
  }
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};

const noop = async () => {};
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode>
  <QueryClientProvider client={client}>
    <AuthContext.Provider value={{ user, token: null, isBootstrapping: false, isAuthenticated: true, login: noop, logout: noop, refreshUser: noop, replaceUser() {} }}>
      <ThemeProvider><ToastProvider><BrowserRouter><GestorPage /></BrowserRouter></ToastProvider></ThemeProvider>
    </AuthContext.Provider>
  </QueryClientProvider>
</React.StrictMode>);
