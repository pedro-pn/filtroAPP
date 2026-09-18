import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  addProjectDocumentVersion,
  archiveProjectDocument,
  createProjectDocument,
  fetchProjectDocumentFile,
  listProjectDocuments,
  prepareProjectDocumentSignature,
  projectDocumentsQueryKey,
  recordProjectDocumentAcceptance,
  restoreProjectDocument,
  updateProjectDocument,
  PROJECT_DOCUMENT_TYPE_OPTIONS,
  type ProjectDocument,
  type ProjectDocumentCreateInput,
  type ProjectDocumentRequirementStage,
  type ProjectDocumentUpdateInput
} from '../../../api/projectDocuments';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { downloadBlob } from '../../../utils/download';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';
import {
  ProjectDocumentAcceptanceForm,
  ProjectDocumentForm,
  ProjectDocumentVersionForm
} from './ProjectDocumentForm';

const typeLabels = Object.fromEntries(PROJECT_DOCUMENT_TYPE_OPTIONS.map(item => [item.key, item.label]));
const requirementLabels: Record<ProjectDocumentRequirementStage, string> = {
  HANDOVER: 'Handover',
  MOBILIZATION: 'Mobilização',
  CLOSEOUT: 'Encerramento'
};
const acceptanceLabels = {
  NOT_REQUIRED: 'Sem aceite',
  PENDING: 'Aceite pendente',
  ACCEPTED: 'Aceito',
  REJECTED: 'Rejeitado'
} as const;

function fileSize(value: number | null) {
  if (!value) return '—';
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function sourceLabel(source: string) {
  return source === 'CRM' ? 'CRM' : source === 'SYSTEM' ? 'Sistema' : 'Manual';
}

function VersionAccess({ version, busy, onDownload, onSignedDownload }: {
  version: ProjectDocument['currentVersion'];
  busy: boolean;
  onDownload: (url: string, name: string) => void;
  onSignedDownload: (url: string, name: string) => void;
}) {
  if (!version) return <span className="project-document-unavailable">Sem versão anexada</span>;
  if (version.externalUrl) return <a className="mini-btn project-document-link-button" href={version.externalUrl} target="_blank" rel="noreferrer">Abrir na origem</a>;
  if (version.downloadUrl || version.signature?.finalFileUrl) return <>
    {version.downloadUrl ? <Button type="button" variant="mini" disabled={busy} onClick={() => onDownload(version.downloadUrl!, version.originalFileName || 'documento')}>Baixar</Button> : null}
    {version.signature?.finalFileUrl ? <Button type="button" variant="mini" disabled={busy} onClick={() => onSignedDownload(version.signature!.finalFileUrl!, `${version.originalFileName || 'documento'}-assinado.pdf`)}>PDF assinado</Button> : null}
  </>;
  return <span className="project-document-unavailable">Conteúdo indisponível</span>;
}

function DocumentCard({ document, busy, onEdit, onVersion, onAcceptance, onSignature, onArchive, onRestore, onDownload }: {
  document: ProjectDocument;
  busy: boolean;
  onEdit: () => void;
  onVersion: () => void;
  onAcceptance: () => void;
  onSignature: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDownload: (url: string, name: string) => void;
}) {
  const current = document.currentVersion;
  return <article className={`project-document-card ${document.readiness.ready ? 'is-ready' : 'is-pending'} ${document.archivedAt ? 'is-archived' : ''}`}>
    <header>
      <div><span>{typeLabels[document.type]}</span><h5>{document.title}</h5></div>
      <span className={`project-document-readiness ${document.readiness.ready ? 'is-ready' : 'is-pending'}`}>{document.readiness.ready ? '🟢 Pronto' : '🟡 Pendente'}</span>
    </header>
    {document.description ? <p>{document.description}</p> : null}
    <div className="project-document-badges">
      <span className={`is-source-${(current?.source || 'MANUAL').toLowerCase()}`}>Fonte: {sourceLabel(current?.source || 'MANUAL')}</span>
      {document.requirementStage ? <span>Obrigatório: {requirementLabels[document.requirementStage]}</span> : <span>Sem bloqueio no fluxo</span>}
      <span>{acceptanceLabels[current?.acceptanceStatus || 'NOT_REQUIRED']}</span>
      {current?.signature ? <span>Assinatura: {current.signature.status}</span> : null}
    </div>
    <dl className="project-document-meta">
      <div><dt>Versão vigente</dt><dd>{current ? current.versionLabel || `#${current.sequence}` : '—'}</dd></div>
      <div><dt>Arquivo</dt><dd>{current?.originalFileName || (current?.externalUrl ? 'Referência externa' : '—')}</dd></div>
      <div><dt>Tamanho</dt><dd>{fileSize(current?.fileSizeBytes || null)}</dd></div>
      <div><dt>Responsável</dt><dd>{document.responsible?.name || 'Não definido'}</dd></div>
    </dl>
    {!document.readiness.ready ? <p className="project-document-blocker">{document.readiness.reason}</p> : null}
    {current?.source === 'CRM' ? <p className="project-workflow-source-detail">Conteúdo sincronizado pelo CRM e mantido como somente leitura{current.sourceVersion ? ` · versão ${current.sourceVersion}` : ''}{current.lastSyncedAt ? ` · ${new Date(current.lastSyncedAt).toLocaleString('pt-BR')}` : ''}.</p> : null}
    <div className="project-document-actions">
      <VersionAccess version={current} busy={busy} onDownload={onDownload} onSignedDownload={onDownload} />
      {current?.signature?.openUrl ? <a className="mini-btn project-document-link-button" href={current.signature.openUrl}>Abrir assinatura</a> : null}
      {document.permissions.update ? <Button type="button" variant="mini" disabled={busy} onClick={onEdit}>Editar</Button> : null}
      {document.permissions.addVersion ? <Button type="button" variant="mini" disabled={busy} onClick={onVersion} data-project-document-version>Nova versão</Button> : null}
      {document.permissions.recordAcceptance && current ? <Button type="button" variant="mini" disabled={busy} onClick={onAcceptance} data-project-document-acceptance>Registrar aceite</Button> : null}
      {document.permissions.prepareSignature && current ? <Button type="button" variant="mini" disabled={busy} onClick={onSignature}>Preparar assinatura</Button> : null}
      {document.permissions.archive ? document.archivedAt
        ? <Button type="button" variant="mini" disabled={busy} onClick={onRestore}>Restaurar</Button>
        : <Button type="button" variant="mini" disabled={busy} onClick={onArchive}>Arquivar</Button> : null}
    </div>
    {(document.versions?.length || 0) > 1 ? <details className="project-document-history"><summary>Histórico de versões ({document.versions!.length})</summary><div>{document.versions!.map(version => <article key={version.id}><div><strong>{version.versionLabel || `Versão ${version.sequence}`}</strong><span>{sourceLabel(version.source)} · {new Date(version.createdAt).toLocaleString('pt-BR')}</span></div><span>{acceptanceLabels[version.acceptanceStatus]}</span><VersionAccess version={version} busy={busy} onDownload={onDownload} onSignedDownload={onDownload} /></article>)}</div></details> : null}
  </article>;
}

export function ProjectDocumentsCategory({ projectId, users }: { projectId: string; users: Array<{ id: string; name: string }> }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [formDocument, setFormDocument] = useState<ProjectDocument | 'new' | null>(null);
  const [versionDocument, setVersionDocument] = useState<ProjectDocument | null>(null);
  const [acceptanceDocument, setAcceptanceDocument] = useState<ProjectDocument | null>(null);
  const [downloading, setDownloading] = useState(false);
  const query = useQuery({
    queryKey: [...projectDocumentsQueryKey(projectId), includeArchived],
    queryFn: () => listProjectDocuments(projectId, includeArchived)
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: projectDocumentsQueryKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['project-workflow', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['project-workflows'] })
    ]);
  };
  const success = async (message: string, invalidated = false) => {
    await refresh();
    setFormDocument(null);
    setVersionDocument(null);
    setAcceptanceDocument(null);
    toast(invalidated ? `${message} A autorização de mobilização precisa ser revalidada.` : message, 'success');
  };
  const createMutation = useMutation({ mutationFn: (input: ProjectDocumentCreateInput) => createProjectDocument(projectId, input), onSuccess: result => success('Documento adicionado.', result.authorizationInvalidated), onError: (error: Error) => toast(error.message, 'error') });
  const updateMutation = useMutation({ mutationFn: ({ id, input }: { id: string; input: ProjectDocumentUpdateInput }) => updateProjectDocument(projectId, id, input), onSuccess: result => success('Documento atualizado.', result.authorizationInvalidated), onError: (error: Error) => toast(error.message, 'error') });
  const versionMutation = useMutation({ mutationFn: ({ document, input }: { document: ProjectDocument; input: Parameters<typeof addProjectDocumentVersion>[2] }) => addProjectDocumentVersion(projectId, document.id, input), onSuccess: result => success('Nova versão adicionada.', result.authorizationInvalidated), onError: (error: Error) => toast(error.message, 'error') });
  const acceptanceMutation = useMutation({ mutationFn: ({ document, input }: { document: ProjectDocument; input: Parameters<typeof recordProjectDocumentAcceptance>[2] }) => recordProjectDocumentAcceptance(projectId, document.id, input), onSuccess: result => success('Decisão registrada.', result.authorizationInvalidated), onError: (error: Error) => toast(error.message, 'error') });
  const archiveMutation = useMutation({ mutationFn: ({ document, restore }: { document: ProjectDocument; restore: boolean }) => restore ? restoreProjectDocument(projectId, document.id, document.version) : archiveProjectDocument(projectId, document.id, document.version), onSuccess: async () => { await refresh(); toast('Situação do documento atualizada.', 'success'); }, onError: (error: Error) => toast(error.message, 'error') });
  const signatureMutation = useMutation({ mutationFn: (document: ProjectDocument) => prepareProjectDocumentSignature(projectId, document.id, { expectedVersion: document.version, versionId: document.currentVersion!.id }), onSuccess: async result => { await refresh(); toast('Documento preparado para assinatura.', 'success'); navigate(result.openUrl); }, onError: (error: Error) => toast(error.message, 'error') });
  const busy = createMutation.isPending || updateMutation.isPending || versionMutation.isPending || acceptanceMutation.isPending || archiveMutation.isPending || signatureMutation.isPending || downloading;
  const requirements = query.data?.requirements;
  const blockerCount = requirements ? Object.values(requirements).reduce((sum, item) => sum + item.blockers.length, 0) : 0;
  const ready = Boolean(query.data && query.data.documents.length > 0 && blockerCount === 0);
  const download = async (url: string, name: string) => {
    setDownloading(true);
    try { downloadBlob(await fetchProjectDocumentFile(url), name); } catch (error) { toast((error as Error).message, 'error'); } finally { setDownloading(false); }
  };

  return <ProjectWorkflowCategory title="Documentos do projeto" description="Propostas, contratos, desenhos, certificados e demais arquivos com histórico por versão." area="Documentação" tone={blockerCount ? 'crit' : undefined} status={query.isLoading ? 'Carregando…' : blockerCount ? `${blockerCount} bloqueio(s)` : `${query.data?.documents.length || 0} documento(s)`} complete={ready} data-project-documents>
    {query.isLoading ? <p className="placeholder-copy">Carregando documentos do projeto…</p> : query.isError || !query.data ? <div className="placeholder-copy"><p>Não foi possível carregar os documentos deste projeto.</p><Button variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button></div> : <>
      <div className="project-documents-toolbar">
        <label><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} /> Mostrar arquivados</label>
        {query.data.allowedTypes.length && !query.data.projectReadOnly ? <Button type="button" variant="secondary" onClick={() => setFormDocument('new')} data-project-document-add>Adicionar documento</Button> : null}
      </div>
      {blockerCount ? <div className="project-document-requirement-blockers" data-project-document-blockers><strong>Documentos que bloqueiam o fluxo</strong>{(['HANDOVER', 'MOBILIZATION', 'CLOSEOUT'] as const).map(stage => requirements![stage].blockers.length ? <div key={stage}><span>{requirementLabels[stage]}</span><ul>{requirements![stage].blockers.map(item => <li key={item.documentId}>{item.reason}</li>)}</ul></div> : null)}</div> : null}
      {query.data.documents.length ? <div className="project-document-list">{query.data.documents.map(document => <DocumentCard document={document} busy={busy} onEdit={() => setFormDocument(document)} onVersion={() => setVersionDocument(document)} onAcceptance={() => setAcceptanceDocument(document)} onSignature={() => signatureMutation.mutate(document)} onArchive={() => archiveMutation.mutate({ document, restore: false })} onRestore={() => archiveMutation.mutate({ document, restore: true })} onDownload={download} key={document.id} />)}</div> : <p className="placeholder-copy">Nenhum documento cadastrado. Adicione o primeiro arquivo ou deixe o projeto sem exigências documentais.</p>}
      {query.data.operationalDocuments.length ? <section className="project-operational-documents"><header><div><h5>RDOs e relatórios técnicos</h5><p>Consulta integrada aos registros operacionais, sem criar cópias no catálogo.</p></div></header><div>{query.data.operationalDocuments.map(item => <article key={item.id}><div><strong>{item.title}</strong><span>{item.kind === 'RDO' ? 'RDO' : 'Relatório técnico'} · {item.issuedAt ? displayDateOnly(item.issuedAt) : 'sem data'} · {item.status}</span></div><div><a className="mini-btn project-document-link-button" href={item.sourceRoute}>Abrir origem</a><Button type="button" variant="mini" disabled={busy} onClick={() => void download(item.downloadUrl, `${item.title}.pdf`)}>Baixar PDF</Button></div></article>)}</div></section> : null}
      {query.data.projectReadOnly ? <p className="project-document-read-only">Projeto encerrado: documentos disponíveis somente para consulta.</p> : null}
      {formDocument ? <ProjectDocumentForm document={formDocument === 'new' ? null : formDocument} allowedTypes={query.data.allowedTypes} users={users} saving={createMutation.isPending || updateMutation.isPending} onClose={() => setFormDocument(null)} onCreate={input => createMutation.mutate(input)} onUpdate={(id, input) => updateMutation.mutate({ id, input })} /> : null}
      {versionDocument ? <ProjectDocumentVersionForm document={versionDocument} saving={versionMutation.isPending} onClose={() => setVersionDocument(null)} onSubmit={input => versionMutation.mutate({ document: versionDocument, input })} /> : null}
      {acceptanceDocument ? <ProjectDocumentAcceptanceForm document={acceptanceDocument} saving={acceptanceMutation.isPending} onClose={() => setAcceptanceDocument(null)} onSubmit={input => acceptanceMutation.mutate({ document: acceptanceDocument, input })} /> : null}
    </>}
  </ProjectWorkflowCategory>;
}
