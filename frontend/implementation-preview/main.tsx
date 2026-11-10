import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import '@fontsource-variable/inter/wght.css';
import { apiClient } from '../src/api/client';
import type { CompanyEquipment, EquipmentAttachment, EquipmentCategory } from '../src/api/equipamentos';
import { ToastProvider } from '../src/components/ui/Toast';
import { Button } from '../src/components/ui/ds';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { PublicSignaturePage } from '../src/pages/PublicSignaturePage';
import { EquipmentCategorySection } from '../src/pages/equipamentos/EquipmentCategorySection';
import { CategoryFormModal } from '../src/pages/equipamentos/CategoryFormModal';
import samplePdf from '../src/assets/previews/rdo-assinatura-exemplo.pdf?url';
import '../src/styles/variables.css';
import '../src/styles/foundation.css';
import '../src/styles/legacy.css';
import '../src/pages/equipamentos/EquipamentosPage.ds.css';
import '../src/pages/equipamentos/EquipmentEntity.ds.css';
import '../src/pages/equipamentos/EquipmentConfig.ds.css';
import './preview.css';

const categoryInitial: EquipmentCategory = {
  id: 'bombas', systemKey: 'bombas', name: 'Bombas', order: 0, fieldSchema: [], technicalSchema: [],
  checklistEnabled: false, checklistDisplayMode: 'AUTO', checklistItems: [], technicalDocEnabled: false,
  supportsCalibration: false, supportsTechnicalDoc: false, attachmentsEnabled: true, showInMaintenance: true,
  syncToRomaneio: false, isSystemManaged: false, isActive: true
};
const documents: Record<string, EquipmentAttachment[]> = {
  'bomba-1': ['Manual de operação.pdf', 'Diagrama hidráulico.pdf'].map((fileName, index) => ({
    id: `document-${index}`, kind: 'DOCUMENT', fileName, mimeType: 'application/pdf', publicToken: 'exemplo',
    publicUrl: samplePdf, createdAt: '2026-11-10T12:00:00Z'
  })),
  'bomba-2': []
};
const equipment = [1, 2].map((number): CompanyEquipment => ({
  id: `bomba-${number}`, code: `BOM-00${number}`, name: number === 1 ? 'Bomba centrífuga' : 'Bomba de transferência',
  categoryId: 'bombas', attributes: {}, technicalData: {}, technicalFieldOverrides: {}, technicalRevision: 0,
  technicalUpdatedAt: null, hasCalibration: false, calibratedAt: null, expiresAt: null, hasTechnicalDoc: false,
  isActive: true, documents: documents[`bomba-${number}`]
}));

apiClient.defaults.adapter = async config => {
  const match = config.url?.match(/\/([^/]+)\/documents(?:\/([^/]+))?$/);
  if (!match) throw new Error('A prévia usa apenas dados ilustrativos.');
  const [, id, documentId] = match;
  let data: unknown;
  if (config.method === 'post') {
    const upload = JSON.parse(config.data);
    const document: EquipmentAttachment = { id: crypto.randomUUID(), kind: 'DOCUMENT', fileName: upload.fileName,
      mimeType: 'application/pdf', publicToken: 'exemplo', publicUrl: upload.dataUrl, createdAt: new Date().toISOString() };
    documents[id] = [document, ...documents[id]];
    data = document;
  } else if (config.method === 'delete') {
    documents[id] = documents[id].filter(document => document.id !== documentId);
  } else data = documents[id];
  equipment.find(item => item.id === id)!.documents = documents[id];
  return { data, status: 200, statusText: 'OK', config, headers: {} };
};

function Preview() {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState(params.get('aba') || 'assinatura');
  const [category, setCategory] = useState(categoryInitial);
  const [editing, setEditing] = useState(false);
  const [isManager, setIsManager] = useState(true);
  return <div className="fv-ds implementation-preview" data-fv-ds>
    <header className="implementation-preview-toolbar">
      <div><strong>Prévia para validação</strong><p>Dados ilustrativos. As ações são simuladas nesta página.</p></div>
      <nav aria-label="Implementações">
        <Button size="sm" variant={view === 'assinatura' ? 'primary' : 'secondary'} onClick={() => setView('assinatura')}>Nota na assinatura</Button>
        <Button size="sm" variant={view === 'equipamentos' ? 'primary' : 'secondary'} onClick={() => setView('equipamentos')}>Documentos dos equipamentos</Button>
      </nav>
    </header>
    {view === 'assinatura' ? <>
      <div className="implementation-preview-options"><a href="./relatorio-com-nota.pdf" target="_blank" rel="noreferrer">Abrir exemplo do PDF final com nota</a>
        <a href="/assinar/exemplo?visualizar=1">Ver assinatura de vários RDOs</a></div>
      <MemoryRouter initialEntries={['/assinar/exemplo?visualizar=1&quantidade=1']}><Routes><Route path="/assinar/:token" element={<PublicSignaturePage />} /></Routes></MemoryRouter>
    </> : <section className="implementation-preview-equipment equip-page-v2">
      <div className="implementation-preview-equipment-header"><div><h1>Documentos dos equipamentos</h1><p>Abra a pasta de um equipamento ou edite a categoria para testar a opção “Anexar documentos”.</p></div>
        <Button size="sm" variant="primary" onClick={() => setEditing(true)}>Editar categoria</Button></div>
      <label className="equip-toggle"><input type="checkbox" checked={isManager} onChange={event => setIsManager(event.target.checked)} /> Simular acesso de gestor</label>
      <EquipmentCategorySection category={category} items={equipment} total={equipment.length} isManager={isManager}
        onAdd={() => {}} onEdit={() => {}} onRemove={() => {}} onOpenTechnical={() => {}} onOpenMaintenanceHistory={() => {}} />
      {editing ? <CategoryFormModal open category={category} saving={false} technicalStandards={[]} standardsLoading={false} standardsError={false}
        onRetryStandards={() => {}} onClose={() => setEditing(false)} onSubmit={payload => { setCategory(current => ({ ...current, ...payload })); setEditing(false); }} /> : null}
    </section>}
  </div>;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<ThemeProvider><QueryClientProvider client={queryClient}><ToastProvider><Preview /></ToastProvider></QueryClientProvider></ThemeProvider>);
