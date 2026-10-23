// Editor de produção com API simulada e persistência local, sem alterar RDOs reais.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { apiClient } from '../../src/api/client';
import { AuthContext } from '../../src/auth/AuthContext';
import { ToastProvider } from '../../src/components/ui/Toast';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { ReportDetailPage } from '../../src/pages/ReportDetailPage';
import { UploadField } from '../../src/components/ui/UploadField';
import { UploadTransferProvider } from '../../src/components/ui/UploadTransferProvider';
import type { AuthUser } from '../../src/types/auth';
import type { ReportPayload, ReportSummary } from '../../src/types/domain';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';

const key = 'rdo-photo-transfer-fixture';
const photo = (name: string, label: string) => ({ label, fileName: `${name}.jpg`, mimeType: 'image/jpeg', url: `/assets/${name}.jpg` });
const project = { id: 'project', code: '5815', name: 'Revisão de fotos', isActive: true, scopes: [], workLocations: [] };
const baseService = { equipmentId: 'UG 1', system: 'Sistema A', tipoSistema: 'Sistema hidráulico', material: 'Aço carbono', startTime: '08:00', endTime: '17:00', finalized: false };
let report = JSON.parse(sessionStorage.getItem(key) || 'null') || {
  id: 'report', reportType: 'RDO', status: 'PENDING', projectId: project.id, project,
  sequenceNumber: 1, reportDate: '2026-10-23', arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00:00',
  dailyDescription: 'Atividades do dia', collaborators: [],
  specialConditions: { generalUploads: [photo('atividade', 'Fotos de registro')] },
  services: [
    { id: 'pressure', serviceType: 'PRESSAO', finalized: false, extraData: { ...baseService, __uploads__: [
      { label: 'Fotos do manômetro', files: [photo('manometro', 'Fotos do manômetro')] }
    ] } },
    { id: 'mechanical', serviceType: 'MECANICA', finalized: false, extraData: { ...baseService, __uploads__: [
      { label: 'Imagens da limpeza', files: [photo('mecanica', 'Imagens da limpeza')] }
    ] } }
  ]
} as ReportSummary;
if (new URLSearchParams(location.search).has('assinado')) report = { ...report, status: 'SIGNED' };
const calls: { url: string; method: string; body: unknown }[] = [];
Object.assign(window, { photoTransferCalls: calls });
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
  calls.push({ url, method: config.method || 'get', body });
  let data: unknown = [];
  if (url.endsWith('/reports/report')) {
    if (config.method === 'put') {
      const payload = body as ReportPayload;
      report = { ...report, ...payload, services: payload.services.map((service, index) => ({ ...service, id: report.services[index].id })) };
      sessionStorage.setItem(key, JSON.stringify(report));
    }
    data = report;
  } else if (url.includes('/bootstrap/report-detail/')) {
    data = { projects: [project], collaborators: [], equipment: [], equipments: [], units: [], manometers: [], counters: [], sequenceReports: [] };
  } else if (url.endsWith('/uploads') && config.method === 'post') {
    if (new URLSearchParams(location.search).has('envio-lento')) {
      await new Promise<void>(resolve => Object.assign(window, { completePhotoUpload: resolve }));
    }
    data = { label: body.label, fileName: body.fileName, mimeType: body.mimeType, url: '/assets/nova.png' };
  } else if (url.includes('/notifications')) data = { items: [], criticalItems: [], unreadCount: 0, nextCursor: null, snapshotAt: '2026-10-23T12:00:00Z' };
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};
const user: AuthUser = {
  id: 'manager', username: 'gestor', name: 'Gestora', email: null, role: 'MANAGER', accountType: 'INTERNAL',
  moduleRoles: ['rdo:manager'], reportEmissionPermissions: ['SITE_RDO'], isActive: true
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><QueryClientProvider client={client}><ThemeProvider>
  <AuthContext.Provider value={{ user, token: 'fixture', isAuthenticated: true, isBootstrapping: false,
    login: async () => {}, logout: async () => {}, refreshUser: async () => {}, replaceUser: () => {} }}>
    <MemoryRouter initialEntries={['/reports/report']}><ToastProvider>
      <Routes><Route path="/reports/:id" element={<ReportDetailPage />} /></Routes>
      <aside aria-label="Outro RDO"><UploadTransferProvider enabled onMove={() => { throw new Error('Moveu para outro RDO'); }}>
        <UploadField label="Fotos de outro RDO" value={[]} transferTarget={{ label: 'Fotos de outro RDO' }} onChange={() => {}} />
      </UploadTransferProvider></aside>
    </ToastProvider></MemoryRouter>
  </AuthContext.Provider>
</ThemeProvider></QueryClientProvider></React.StrictMode>);
