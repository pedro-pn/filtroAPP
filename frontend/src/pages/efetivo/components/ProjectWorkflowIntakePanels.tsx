import { useEffect, useState } from 'react';

import type { ProjectDocument } from '../../../api/projectDocuments';
import type {
  ProjectWorkflow,
  ProjectWorkflowCommercialFact,
  ProjectWorkflowDetail,
  ProjectWorkflowDocumentationCategory,
  ProjectWorkflowDocumentationRequirement,
  ProjectWorkflowDocumentationStatus,
  ProjectWorkflowPatch
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { ProjectWorkflowBooleanChoice } from './ProjectWorkflowBooleanChoice';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';

type PatchHandler = (payload: ProjectWorkflowPatch) => void;

function signalStatus(confirmed: boolean, waitingLabel = 'Aguardando CRM') {
  return <span className={`project-workflow-signal-status ${confirmed ? 'is-confirmed' : ''}`}>{confirmed ? 'Confirmado' : waitingLabel}</span>;
}

function documentLink(document: ProjectDocument | undefined) {
  if (!document?.currentVersion) return null;
  const url = document.currentVersion.downloadUrl || document.currentVersion.externalUrl;
  return url ? <a href={url} target="_blank" rel="noreferrer">Abrir anexo</a> : <span>{document.title}</span>;
}

export function ProjectWorkflowHandoverSignals({ detail, documents }: {
  detail: ProjectWorkflowDetail;
  documents: ProjectDocument[];
}) {
  const workflow = detail.workflow!;
  const commercialProposal = documents.find(item => item.type === 'COMMERCIAL_PROPOSAL' && item.currentVersion && !item.archivedAt);
  const technicalProposal = documents.find(item => item.type === 'TECHNICAL_PROPOSAL' && item.currentVersion && !item.archivedAt);
  const sourceDocuments = documents.filter(item => ['DRAWING', 'SPECIFICATION'].includes(item.type) && item.currentVersion && !item.archivedAt);
  const rows = [
    { label: 'Projeto criado no sistema', confirmed: true, detail: `${detail.project.code} · ${detail.project.name}` },
    { label: 'Líder de Projetos definido', confirmed: true, detail: workflow.leader.name },
    { label: 'Grupo de WhatsApp criado', confirmed: workflow.commercialWhatsappGroupCreated === true, detail: workflow.commercialWhatsappGroupUrl ? <a href={workflow.commercialWhatsappGroupUrl} target="_blank" rel="noreferrer">Abrir grupo</a> : 'Será atualizado pela integração comercial.' },
    { label: 'Participantes do handover incluídos', confirmed: workflow.commercialParticipantsIncluded === true, detail: workflow.commercialParticipantsIncluded === true ? 'Participantes informados pelo CRM.' : 'Será atualizado pela integração comercial.' },
    { label: 'Proposta comercial', confirmed: Boolean(commercialProposal), detail: documentLink(commercialProposal) },
    { label: 'Proposta técnica', confirmed: Boolean(technicalProposal), detail: documentLink(technicalProposal) },
    { label: 'Desenhos e especificações usados na proposta', confirmed: sourceDocuments.length > 0, detail: sourceDocuments.length ? `${sourceDocuments.length} anexo(s) disponível(is)` : null },
    { label: 'Contato responsável do cliente', confirmed: Boolean(workflow.commercialClientContactName || workflow.commercialClientContactEmail || detail.project.clientEmailPrimary), detail: [workflow.commercialClientContactName, workflow.commercialClientContactPhone, workflow.commercialClientContactEmail || detail.project.clientEmailPrimary].filter(Boolean).join(' · ') || 'Será atualizado pela integração comercial.' },
    { label: 'Previsão comercial de início', confirmed: Boolean(workflow.commercialExpectedStartDate), detail: workflow.commercialExpectedStartDate ? displayDateOnly(workflow.commercialExpectedStartDate) : 'Será preenchida pelo CRM.' },
    { label: 'Prazo comercial previsto', confirmed: workflow.commercialExpectedDurationDays != null, detail: workflow.commercialExpectedDurationDays != null ? `${workflow.commercialExpectedDurationDays} dia(s)` : 'Será preenchido pelo CRM.' },
    { label: 'Condições e premissas comerciais', confirmed: Boolean(workflow.commercialAssumptions), detail: workflow.commercialAssumptions || 'Serão preenchidas pelo CRM.' }
  ];
  return (
    <ProjectWorkflowCategory
      title="Informações do handover"
      description="Dados de consulta recebidos do Comercial e dos anexos do projeto. Eles não são pendências do planejador."
      status="Consulta"
      className="project-workflow-handover-signals"
      data-project-workflow-handover-signals
    >
      <div className="project-workflow-signal-list">
        {rows.map(row => <article className="project-workflow-signal" key={row.label}><div><strong>{row.label}</strong>{row.detail ? <span>{row.detail}</span> : null}</div>{signalStatus(row.confirmed)}</article>)}
      </div>
      {workflow.commercialSourceUpdatedAt ? <small className="project-workflow-source-detail">Última atualização comercial: {new Date(workflow.commercialSourceUpdatedAt).toLocaleString('pt-BR')}</small> : null}
    </ProjectWorkflowCategory>
  );
}

function commercialDetail(item: ProjectWorkflowCommercialFact) {
  const values = [item.reference, item.note, item.occurredOn ? displayDateOnly(item.occurredOn) : null].filter(Boolean);
  return values.length ? values.join(' · ') : 'O CRM ainda não enviou esta informação.';
}

export function ProjectWorkflowCommercialSignals({ workflow }: { workflow: ProjectWorkflow }) {
  return (
    <ProjectWorkflowCategory
      title="Liberação comercial e contratual"
      description="Sinalização de acompanhamento preenchida automaticamente pelo CRM. Nenhum item desta área gera pendência ou bloqueia o planejamento."
      status={workflow.commercialReadiness.status === 'RELEASED' ? '🟢 Sinais completos' : `${workflow.commercialReadiness.resolvedCount}/${workflow.commercialReadiness.totalCount} recebidos`}
      complete={workflow.commercialReadiness.status === 'RELEASED'}
      className="project-workflow-commercial"
      data-project-workflow-commercial
    >
      <div className="project-workflow-commercial-list">
        {workflow.commercialFacts.map(item => (
          <article className={`project-workflow-commercial-fact ${item.source === 'CRM' ? 'is-crm' : ''}`} key={item.key}>
            <header><div><strong>{item.label}</strong><span>{item.source === 'CRM' ? 'Sincronizado pelo CRM' : 'Aguardando integração com o CRM'}</span></div>{item.status === 'CONFIRMED' ? signalStatus(true) : signalStatus(false, item.status === 'NOT_APPLICABLE' ? 'Não aplicável' : 'Aguardando CRM')}</header>
            <p className="project-workflow-source-detail">{commercialDetail(item)}</p>
            {item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noreferrer">Abrir no CRM</a> : null}
          </article>
        ))}
      </div>
    </ProjectWorkflowCategory>
  );
}

export function ProjectWorkflowInitialAnalysisData({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: PatchHandler;
}) {
  const [contactMade, setContactMade] = useState<boolean>(workflow.analysisClientContactMade ?? false);
  const [contactName, setContactName] = useState(workflow.analysisClientContactName || '');
  const [contactDate, setContactDate] = useState(workflow.analysisClientContactDate || '');
  useEffect(() => {
    setContactMade(workflow.analysisClientContactMade ?? false);
    setContactName(workflow.analysisClientContactName || '');
    setContactDate(workflow.analysisClientContactDate || '');
  }, [workflow.analysisClientContactDate, workflow.analysisClientContactMade, workflow.analysisClientContactName]);
  const saveContact = (name = contactName, date = contactDate) => {
    const normalizedName = name.trim();
    if (contactMade !== true || !normalizedName || !date) return;
    if (normalizedName === workflow.analysisClientContactName && date === workflow.analysisClientContactDate) return;
    onPatch({ action: 'analysis_contact', version: workflow.version, made: true, contactName: normalizedName, contactDate: date });
  };
  const chooseContact = (made: boolean) => {
    setContactMade(made);
    if (made) return;
    setContactName('');
    setContactDate('');
    if (workflow.analysisClientContactMade !== false) {
      onPatch({ action: 'analysis_contact', version: workflow.version, made: false, contactName: null, contactDate: null });
    }
  };
  const contactStatus = contactMade
    ? contactName.trim() && contactDate ? 'Contato registrado' : 'Complete o contato'
    : 'Contato pendente';
  return (
    <ProjectWorkflowCategory
      title="Datas e contato inicial"
      description="As datas são recebidas do CRM. O contato operacional é registrado pelo Líder de Projetos e salvo automaticamente."
      status={contactStatus}
      complete={Boolean(contactMade && contactName.trim() && contactDate)}
      className="project-workflow-initial-analysis"
      data-project-workflow-initial-analysis
    >
      <div className="project-workflow-analysis-dates">
        <div className="field-group"><label htmlFor="analysis-commercial-mobilization-date">Mobilização estimada</label><input id="analysis-commercial-mobilization-date" type="date" value={workflow.commercialExpectedMobilizationDate || ''} readOnly aria-readonly="true" /><small>{workflow.commercialExpectedMobilizationDate ? 'Data recebida do CRM.' : 'Aguardando preenchimento pelo CRM.'}</small></div>
        <div className="field-group"><label htmlFor="analysis-commercial-start-date">Início estimado</label><input id="analysis-commercial-start-date" type="date" value={workflow.commercialExpectedStartDate || ''} readOnly aria-readonly="true" /><small>{workflow.commercialExpectedStartDate ? 'Data recebida do CRM.' : 'Aguardando preenchimento pelo CRM.'}</small></div>
      </div>
      <article className="project-workflow-analysis-contact">
        <header><div><strong>Contato inicial com o cliente realizado?</strong><p>Esta confirmação exige “Sim”, nome e data. Enquanto estiver em “Não”, permanece pendente.</p></div><ProjectWorkflowBooleanChoice value={contactMade} label="Contato inicial com o cliente realizado?" disabled={saving || !workflow.permissions.canEdit} onSelect={chooseContact} /></header>
        {contactMade === true ? <div className="project-workflow-analysis-contact-fields">
          <div className="field-group"><label htmlFor="analysis-client-contact-name">Nome do contato *</label><input id="analysis-client-contact-name" value={contactName} maxLength={160} disabled={saving || !workflow.permissions.canEdit} onChange={event => setContactName(event.target.value)} onBlur={() => saveContact()} /></div>
          <div className="field-group"><label htmlFor="analysis-client-contact-date">Data do contato *</label><input id="analysis-client-contact-date" type="date" value={contactDate} disabled={saving || !workflow.permissions.canEdit} onChange={event => { const value = event.target.value; setContactDate(value); saveContact(contactName, value); }} /></div>
        </div> : null}
        {contactMade === true && (!contactName.trim() || !contactDate) ? <small>Preencha nome e data para registrar o contato.</small> : null}
      </article>
    </ProjectWorkflowCategory>
  );
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

const STATUS_LABELS: Record<ProjectWorkflowDocumentationStatus, string> = {
  PENDING: 'Pendente',
  REQUESTED: 'Solicitado',
  CONFIRMED: 'Confirmado'
};

function RequirementHistory({ item }: { item: ProjectWorkflowDocumentationRequirement }) {
  if (!item.history.length) return null;
  return (
    <details className="project-workflow-documentation-history">
      <summary>Histórico ({item.history.length})</summary>
      <ul>{item.history.map(entry => {
        const after = entry.changes.after;
        return <li key={entry.id}><strong>{new Date(entry.createdAt).toLocaleString('pt-BR')}</strong><span>{entry.actor?.name || 'Sistema'} · {entry.changes.before ? 'Atualizado' : 'Adicionado'} · {STATUS_LABELS[after.status]}{after.requestedAt ? ` · solicitado em ${displayDateOnly(after.requestedAt)}` : ''}{after.confirmedAt ? ` · confirmado em ${displayDateOnly(after.confirmedAt)}` : ''}</span></li>;
      })}</ul>
    </details>
  );
}

function DocumentationRequirementEditor({ item, version, saving, canEdit, onPatch }: {
  item: ProjectWorkflowDocumentationRequirement;
  version: number;
  saving: boolean;
  canEdit: boolean;
  onPatch: PatchHandler;
}) {
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.name]);
  const changeStatus = (status: ProjectWorkflowDocumentationStatus) => {
    const currentDay = today();
    onPatch({
      action: 'documentation_requirement_update',
      version,
      requirementId: item.id,
      status,
      requestedAt: status === 'PENDING' ? null : item.requestedAt || currentDay,
      confirmedAt: status === 'CONFIRMED' ? item.confirmedAt || currentDay : null
    });
  };
  return (
    <article className="project-workflow-documentation-requirement">
      <div className="project-workflow-documentation-fields">
        <div className="field-group"><label htmlFor={`documentation-name-${item.id}`}>Nome</label><input id={`documentation-name-${item.id}`} value={name} disabled={saving || !canEdit} onChange={event => setName(event.target.value)} onBlur={() => { const value = name.trim(); if (value && value !== item.name) onPatch({ action: 'documentation_requirement_update', version, requirementId: item.id, name: value }); }} /></div>
        <div className="field-group"><label htmlFor={`documentation-status-${item.id}`}>Acompanhamento</label><select id={`documentation-status-${item.id}`} value={item.status} disabled={saving || !canEdit} onChange={event => changeStatus(event.target.value as ProjectWorkflowDocumentationStatus)}><option value="PENDING">Pendente</option><option value="REQUESTED">Solicitado ao setor responsável</option><option value="CONFIRMED">Confirmado</option></select></div>
        <div className="field-group"><label htmlFor={`documentation-requested-${item.id}`}>Data da solicitação</label><input id={`documentation-requested-${item.id}`} type="date" value={item.requestedAt || ''} disabled={saving || !canEdit || item.status === 'PENDING'} onChange={event => onPatch({ action: 'documentation_requirement_update', version, requirementId: item.id, requestedAt: event.target.value || null })} /></div>
        <div className="field-group"><label htmlFor={`documentation-confirmed-${item.id}`}>Data da confirmação</label><input id={`documentation-confirmed-${item.id}`} type="date" min={item.requestedAt || undefined} value={item.confirmedAt || ''} disabled={saving || !canEdit || item.status !== 'CONFIRMED'} onChange={event => onPatch({ action: 'documentation_requirement_update', version, requirementId: item.id, confirmedAt: event.target.value || null })} /></div>
      </div>
      <div className="project-workflow-documentation-requirement-footer"><RequirementHistory item={item} />{canEdit ? <Button type="button" variant="mini" disabled={saving} onClick={() => onPatch({ action: 'documentation_requirement_archive', version, requirementId: item.id, archived: true })}>Remover item</Button> : null}</div>
    </article>
  );
}

function DocumentationTypeCard({ category, workflow, saving, onPatch }: {
  category: ProjectWorkflowDocumentationCategory;
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: PatchHandler;
}) {
  const [newName, setNewName] = useState('');
  const activeRequirements = category.requirements.filter(item => !item.archivedAt);
  const create = () => {
    const name = newName.trim();
    if (!name) return;
    onPatch({ action: 'documentation_requirement_create', version: workflow.version, type: category.type, name });
    setNewName('');
  };
  return (
    <article className={`project-workflow-documentation-type is-${category.required === true ? 'required' : category.required === false ? 'not-required' : 'unanswered'}`}>
      <header><div><h5>{category.label}</h5><p>É necessário {category.label.toLocaleLowerCase('pt-BR')} para o projeto?</p></div><ProjectWorkflowBooleanChoice value={category.required} label={`Necessidade de ${category.label.toLocaleLowerCase('pt-BR')}`} disabled={saving || !workflow.permissions.canEdit} onSelect={required => onPatch({ action: 'documentation_category', version: workflow.version, type: category.type, required })} /></header>
      {category.required === true ? <div className="project-workflow-documentation-items">
        <div className="project-workflow-documentation-add"><div className="field-group"><label htmlFor={`documentation-add-${category.type}`}>{category.nameLabel}</label><input id={`documentation-add-${category.type}`} value={newName} disabled={saving || !workflow.permissions.canEdit} placeholder={`Ex.: ${category.type === 'EXAM' ? 'Audiometria' : category.type === 'TRAINING' ? 'NR-35' : category.type === 'CERTIFICATION' ? 'Certificado de operador' : 'Cadastro no portal do cliente'}`} onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); create(); } }} /></div><Button type="button" variant="mini" disabled={saving || !workflow.permissions.canEdit || !newName.trim()} onClick={create}>Adicionar</Button></div>
        {activeRequirements.length ? activeRequirements.map(item => <DocumentationRequirementEditor item={item} version={workflow.version} saving={saving} canEdit={workflow.permissions.canEdit} onPatch={onPatch} key={item.id} />) : <p className="project-workflow-category-note">Adicione cada {category.singularLabel} que precisa ser acompanhado.</p>}
      </div> : null}
    </article>
  );
}

export function ProjectWorkflowDocumentationTracking({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: PatchHandler;
}) {
  const status = workflow.documentationReadiness.status === 'OK' ? '🟢 OK' : workflow.documentationReadiness.status === 'CRITICAL' ? '🔴 Crítica' : '🟡 Em andamento';
  return (
    <ProjectWorkflowCategory
      title="Documentação antecipada"
      description="Defina os tipos necessários e acompanhe cada solicitação até a confirmação. Alterações são salvas automaticamente e registradas no histórico."
      status={`${status} · ${workflow.documentationReadiness.completed}/${workflow.documentationReadiness.total}`}
      complete={workflow.documentationReadiness.status === 'OK'}
      className={`project-workflow-documentation is-${workflow.documentationReadiness.status.toLowerCase()}`}
      data-project-workflow-documentation-tracking
    >
      <div className="project-workflow-documentation-types">{workflow.documentationCategories.map(category => <DocumentationTypeCard category={category} workflow={workflow} saving={saving} onPatch={onPatch} key={category.type} />)}</div>
    </ProjectWorkflowCategory>
  );
}
