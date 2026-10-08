// Real manager page with simulated API responses; no database or network writes.
import React from 'react';
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
const report = {
  id: 'report-other', projectId: archivedProjects[2].id, project: archivedProjects[2],
  reportType: 'RDO', sequenceNumber: 1, status: 'APPROVED', reportDate: '2026-10-01',
  dailyDescription: 'Teste de pressão', specialConditions: {}, collaborators: [], services: []
} as ReportSummary;

apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  let data: unknown = [];
  if (url.endsWith('/bootstrap/gestor')) {
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
