import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import { ProjectRevisionPicker } from '../../src/components/projects/ProjectRevisionPicker';
import { ToastContext } from '../../src/components/ui/ToastContext';
import type { CommercialAppRevision } from '../../src/api/acompanhamentoComercial';
import '../../src/styles/variables.css';
import '../../src/styles/base.css';
import '../../src/pages/gestor/GestorPage.ds.css';
const items: CommercialAppRevision[] = [
  { id: 'main', externalId: 'main-500-0', proposalCode: '500', revisionNumber: 0, proposalKind: 'MAIN',
    parentProposalCode: null, additionalProposalId: null, selectionVersion: 0, title: 'Principal', clientName: 'QA',
    salePrice: 100000, plannedTotalCost: 60000, selectionStatus: 'SELECTED', approvedAt: null,
    receivedAt: '', metricInclusion: {}, documents: [] },
  ...[0, 1].map(revisionNumber => ({ id: `a-${revisionNumber}`, externalId: `a-502-${revisionNumber}`, proposalCode: '502',
    revisionNumber, proposalKind: 'ADDITIONAL' as const, parentProposalCode: '500', additionalProposalId: 'additional-502',
    selectionVersion: 1, title: 'Extra escopo A', clientName: 'QA', salePrice: revisionNumber ? 25000 : 20000,
    plannedTotalCost: revisionNumber ? 15000 : 12000, selectionStatus: revisionNumber ? 'STAGED' as const : 'SELECTED' as const,
    approvedAt: null, receivedAt: '', metricInclusion: {}, documents: [{ id: `doc-${revisionNumber}`, kind: 'COMERCIAL',
      fileName: `Adicional 502 Rev ${revisionNumber}.pdf`, byteSize: 100 }] })),
  { id: 'b', externalId: 'b-503-0', proposalCode: '503', revisionNumber: 0, proposalKind: 'ADDITIONAL',
    parentProposalCode: '500', additionalProposalId: 'additional-503', selectionVersion: 1, title: 'Extra B', clientName: 'QA',
    salePrice: 5000, plannedTotalCost: 3000, selectionStatus: 'SELECTED', approvedAt: null,
    receivedAt: '', metricInclusion: {}, documents: [] }
];
const writes: unknown[] = [];
Object.assign(window, { commercialWrites: writes });
apiClient.defaults.adapter = async config => {
  const result = data => ({ config, status: 200, statusText: 'OK', headers: {}, data: structuredClone(data) });
  if (config.method === 'post') {
    const body = JSON.parse(config.data); writes.push({ url: config.url, ...body });
    if (config.url?.endsWith('/selecionar')) {
      const selected = items.find(row => row.externalId === body.externalId)!;
      for (const row of items.filter(row => row.proposalCode === selected.proposalCode)) {
        row.selectionStatus = row === selected ? 'SELECTED' : 'STAGED';
        row.selectionVersion++; row.metricInclusion = body.metricInclusion ?? {};
      }
    }
    if (config.url?.endsWith('/remover-adicional')) for (const row of items.filter(row => row.proposalCode === body.proposalCode)) {
      row.selectionStatus = 'STAGED'; row.selectionVersion++;
    }
    return result({ budgetStatus: 'SELECTED' });
  }
  return result(config.url?.endsWith('/comercialapp/revisoes') ? { items, budgetSource: 'COMERCIAL_APP' }
    : { currentCodBd: null, proposalCode: '500', revisions: [], additionalProposals: [] });
};
const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={query}>
  <ToastContext.Provider value={{ showToast() {} }}>
    <main className="fv-ds" style={{ maxWidth: 900, margin: '20px auto', padding: 16 }}>
      <ProjectRevisionPicker projectId="project-123" />
    </main>
  </ToastContext.Provider>
</QueryClientProvider>);
