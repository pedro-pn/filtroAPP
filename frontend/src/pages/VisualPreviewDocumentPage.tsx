import { useState } from 'react';
import type { ProjectDocument } from '../api/projectDocuments';
import type { ProjectOperationalMissionSummary, ProjectWorkflowSummary } from '../api/projectWorkflow';
import { Button } from '../components/ui/ds';
import { ProjectDocumentAcceptanceForm, ProjectDocumentForm, ProjectDocumentVersionForm } from './efetivo/components/ProjectDocumentForm';
import { ProjectLegacyCompletionModal } from './efetivo/components/ProjectLegacyCompletionModal';
import { ClientContactChecklistDialog } from './efetivo/components/ProjectWorkflowIntakePanels';
import { PublicFlowShell } from './PublicFlowShell';
import './efetivo/efetivo.css';
import './efetivo/EfetivoDialogs.css';

const demoVersion: NonNullable<ProjectDocument['currentVersion']> = {
  id: 'preview-version', sequence: 1, versionLabel: 'Rev. 01', source: 'MANUAL', contentKind: 'MANAGED_FILE',
  originalFileName: 'proposta-tecnica.pdf', mimeType: 'application/pdf', fileSizeBytes: 148000, sha256: null,
  externalId: null, externalUrl: null, sourceVersion: null, sourceUpdatedAt: null, lastSyncedAt: null,
  signature: null, acceptanceStatus: 'PENDING', acceptanceOccurredOn: null, acceptanceReference: null,
  acceptanceNote: null, acceptanceRecordedAt: null, acceptanceRecordedBy: null, createdAt: '2026-09-30T12:00:00.000Z',
  createdBy: { id: 'preview-user', name: 'Marina Costa' }, downloadUrl: null
};
const demoDocument: ProjectDocument = {
  id: 'preview-document', projectId: 'preview-project', type: 'TECHNICAL_PROPOSAL', title: 'Proposta técnica',
  description: 'Documento de demonstração.', responsible: { id: 'preview-user', name: 'Marina Costa' },
  requirementStage: 'HANDOVER', acceptanceMode: 'CLIENT', version: 1, archivedAt: null, archivedBy: null,
  createdAt: '2026-09-30T12:00:00.000Z', createdBy: { id: 'preview-user', name: 'Marina Costa' },
  updatedAt: '2026-09-30T12:00:00.000Z', updatedBy: null, currentVersion: demoVersion,
  readiness: { ready: false, reasonCode: 'PENDING', reason: 'Aguardando aceite.' },
  permissions: { update: true, addVersion: true, recordAcceptance: true, prepareSignature: true, archive: true }
};
const demoMission: ProjectOperationalMissionSummary = {
  id: 'preview-mission', stage: 'EXECUTION', scheduleStatus: 'CONFIRMED', version: 1, kanbanOrder: 0,
  mobilizationDate: '2026-09-01', executionStartDate: '2026-09-02', executionEndDate: '2026-09-30',
  returnDate: null, headquartersResponsibleName: 'Marina Costa', headquartersResponsibleRole: 'Gestora',
  headquartersResponsibleCollaboratorId: null, participantCount: 0, allocations: []
};
const demoProject: ProjectWorkflowSummary = {
  id: 'preview-project', code: '5917', name: 'Ilha Solteira', clientName: 'Cliente de demonstração',
  location: 'Ilha Solteira', operationalMission: demoMission, workflow: null,
  permissions: { canInitialize: false, canEdit: false, canReopen: false, canAccept: false, canChangeLeader: false, canChangePlanner: false, canEditCommercial: false, canEditTeamPlanning: false, canEditEquipmentPlanning: false, canEditSupplyPlanning: false, canEditLogisticsPlanning: false }
};
const demoChecklist = {
  version: 1,
  clientContactChecklist: [
    { key: 'ACCESS', label: 'O acesso ao local foi confirmado com o cliente?', answer: true, note: '', updatedAt: null, canEdit: true },
    { key: 'UNLOADING', label: 'O descarregamento de equipamentos foi alinhado?', answer: null, note: null, updatedAt: null, canEdit: true },
    { key: 'LODGING', label: 'As condições de hospedagem foram confirmadas?', answer: false, note: null, updatedAt: null, canEdit: true }
  ]
};

export function VisualPreviewDocumentPage() {
  const [dialog, setDialog] = useState<'new' | 'edit' | 'version' | 'acceptance' | 'closeout' | 'checklist' | null>(null);
  return <PublicFlowShell title="Documentos do Efetivo" description="Abra os diálogos com dados fictícios para conferir o visual. Nenhuma ação será salva." wide preview>
    <div className="visual-preview-list">
      <Button variant="secondary" onClick={() => setDialog('new')}>Adicionar documento</Button>
      <Button variant="secondary" onClick={() => setDialog('edit')}>Editar documento</Button>
      <Button variant="secondary" onClick={() => setDialog('version')}>Adicionar versão</Button>
      <Button variant="secondary" onClick={() => setDialog('acceptance')}>Registrar aceite</Button>
      <Button variant="secondary" onClick={() => setDialog('closeout')}>Encerrar projeto antigo</Button>
      <Button variant="secondary" onClick={() => setDialog('checklist')}>Checklist de contato</Button>
    </div>
    {dialog === 'new' || dialog === 'edit' ? <ProjectDocumentForm document={dialog === 'edit' ? demoDocument : null} allowedTypes={['TECHNICAL_PROPOSAL', 'COMMERCIAL_PROPOSAL', 'CONTRACT', 'OTHER']} users={[{ id: 'preview-user', name: 'Marina Costa' }]} saving={false} onClose={() => setDialog(null)} onCreate={() => setDialog(null)} onUpdate={() => setDialog(null)} /> : null}
    {dialog === 'version' ? <ProjectDocumentVersionForm document={demoDocument} saving={false} onClose={() => setDialog(null)} onSubmit={() => setDialog(null)} /> : null}
    {dialog === 'acceptance' ? <ProjectDocumentAcceptanceForm document={demoDocument} saving={false} onClose={() => setDialog(null)} onSubmit={() => setDialog(null)} /> : null}
    <ProjectLegacyCompletionModal project={demoProject} mission={demoMission} open={dialog === 'closeout'} saving={false} onClose={() => setDialog(null)} onConfirm={() => setDialog(null)} />
    <ClientContactChecklistDialog open={dialog === 'checklist'} workflow={demoChecklist} saving={false} onPatch={() => undefined} onClose={() => setDialog(null)} />
  </PublicFlowShell>;
}
