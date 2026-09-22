import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, formatPhoneLocal, formatPhoneValue, parsePhoneValue, phoneCountryFlag, phoneDigits, type PhoneCountry } from '../../../utils/phoneCountries';

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
import { DateInput } from '../../../components/ui/DateInput';
import { displayDateOnly, todayDateOnly } from '../../../utils/calendarGrid';
import { projectExecutionSchedule } from '../../../utils/projectExecutionSchedule';
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
      description="Dados de consulta recebidos do Comercial e dos anexos do projeto. Eles não são pendências do Gestor de Contrato."
      area="Comercial"
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
      area="Comercial"
      progress={{ completed: workflow.commercialReadiness.resolvedCount, total: workflow.commercialReadiness.totalCount }}
      status={workflow.commercialReadiness.status === 'RELEASED' ? 'Sinais completos' : `${workflow.commercialReadiness.totalCount - workflow.commercialReadiness.resolvedCount} a receber`}
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
  const [contactCountry, setContactCountry] = useState<PhoneCountry>(parsePhoneValue(workflow.analysisClientContactPhone || '').country || DEFAULT_PHONE_COUNTRY);
  const [contactPhone, setContactPhone] = useState(parsePhoneValue(workflow.analysisClientContactPhone || '').local);
  const [contactDate, setContactDate] = useState(workflow.analysisClientContactDate || '');
  const [countryListOpen, setCountryListOpen] = useState(false);
  const [countryListPosition, setCountryListPosition] = useState({ top: 0, left: 0, width: 280 });
  const countryTriggerRef = useRef<HTMLButtonElement>(null);
  const countryListRef = useRef<HTMLDivElement>(null);
  const countrySearchRef = useRef<{ value: string; timeout: ReturnType<typeof setTimeout> | null }>({ value: '', timeout: null });
  useEffect(() => {
    setContactMade(workflow.analysisClientContactMade ?? false);
    setContactName(workflow.analysisClientContactName || '');
    const parsedPhone = parsePhoneValue(workflow.analysisClientContactPhone || '');
    setContactCountry(parsedPhone.country);
    setContactPhone(parsedPhone.local);
    setContactDate(workflow.analysisClientContactDate || '');
  }, [workflow.analysisClientContactDate, workflow.analysisClientContactMade, workflow.analysisClientContactName, workflow.analysisClientContactPhone]);
  useEffect(() => {
    if (!countryListOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !countryTriggerRef.current?.contains(target) && !countryListRef.current?.contains(target)) setCountryListOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCountryListOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [countryListOpen]);
  const schedule = projectExecutionSchedule(workflow);
  const saveSchedule = (start: string, end: string) => onPatch({
    action: 'analysis_schedule',
    version: workflow.version,
    plannedExecutionStartDate: start || null,
    plannedExecutionEndDate: end || null
  });
  const scheduleHint = (source: 'PLANNED' | 'COMMERCIAL' | null) => source === 'PLANNED'
    ? 'Definida aqui e refletida na definição da equipe.'
    : source === 'COMMERCIAL' ? 'Sugestão da previsão comercial. Ajuste se a operação for diferente.' : 'Informe para preencher a definição da equipe.';
  const saveContact = (name = contactName, phone = contactPhone, country = contactCountry, date = contactDate) => {
    const normalizedName = name.trim();
    const normalizedPhone = formatPhoneValue(country, phone);
    if (contactMade !== true || !normalizedName || !normalizedPhone || !date) return;
    if (normalizedName === workflow.analysisClientContactName && normalizedPhone === workflow.analysisClientContactPhone && date === workflow.analysisClientContactDate) return;
    onPatch({ action: 'analysis_contact', version: workflow.version, made: true, contactName: normalizedName, contactPhone: normalizedPhone, contactDate: date });
  };
  const chooseContact = (made: boolean) => {
    setContactMade(made);
    if (made) {
      // A data não é escolhida à parte: o próprio registro do contato já a captura.
      if (!contactDate) setContactDate(todayDateOnly());
      return;
    }
    setContactName('');
    setContactCountry(DEFAULT_PHONE_COUNTRY);
    setContactPhone('');
    setContactDate('');
    if (workflow.analysisClientContactMade !== false) {
      onPatch({ action: 'analysis_contact', version: workflow.version, made: false, contactName: null, contactPhone: null, contactDate: null });
    }
  };
  const contactStatus = contactMade
    ? contactName.trim() && contactPhone.trim() && contactDate ? 'Contato registrado' : 'Complete o contato'
    : 'Contato pendente';
  const toggleCountryList = () => {
    if (countryListOpen) {
      setCountryListOpen(false);
      return;
    }
    const rect = countryTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const listHeight = Math.min(280, window.innerHeight - 16);
    const top = rect.bottom + 4 + listHeight <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - listHeight - 4);
    setCountryListPosition({ top, left: rect.left, width: Math.max(rect.width, 280) });
    setCountryListOpen(true);
  };
  const handleCountryKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setCountryListOpen(false);
      countrySearchRef.current.value = '';
      return;
    }
    if (event.key.length !== 1 || !/[\p{L}\d]/u.test(event.key)) return;
    event.preventDefault();
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    const search = `${countrySearchRef.current.value}${event.key}`;
    const country = PHONE_COUNTRIES.find(item => normalize(item.name).startsWith(normalize(search)));
    if (country) {
      setContactCountry(country);
      document.getElementById(`analysis-phone-country-${country.iso}`)?.scrollIntoView({ block: 'nearest' });
    } else {
      countrySearchRef.current.value = event.key;
    }
    countrySearchRef.current.value = search;
    if (countrySearchRef.current.timeout) clearTimeout(countrySearchRef.current.timeout);
    countrySearchRef.current.timeout = setTimeout(() => { countrySearchRef.current.value = ''; }, 800);
  };
  return (
    <ProjectWorkflowCategory
      title="Datas e contato inicial"
      description="As datas comerciais são digitadas manualmente enquanto não existe integração com o CRM. O contato operacional é registrado pelo Líder de Projetos e salvo automaticamente."
      area="Análise"
      status={contactStatus}
      complete={Boolean(contactMade && contactName.trim() && contactPhone.trim() && contactDate)}
      className="project-workflow-initial-analysis"
      data-project-workflow-initial-analysis
    >
      <div className="project-workflow-analysis-dates">
        {workflow.executedAtHeadquarters ? null : <div className="field-group"><label htmlFor="analysis-commercial-mobilization-date">Mobilização estimada</label><DateInput id="analysis-commercial-mobilization-date" value={workflow.commercialExpectedMobilizationDate || ''} disabled={saving || !workflow.permissions.canEdit} onCommit={value => onPatch({ action: 'commercial_dates', version: workflow.version, expectedMobilizationDate: value || null })} /><small>Confirmada (ou corrigida) no D-15, antes da mobilização.</small></div>}
        <div className="field-group"><label htmlFor="analysis-commercial-start-date">Início estimado</label><DateInput id="analysis-commercial-start-date" value={workflow.commercialExpectedStartDate || ''} disabled={saving || !workflow.permissions.canEdit} onCommit={value => onPatch({ action: 'commercial_dates', version: workflow.version, expectedStartDate: value || null })} /><small>Confirmado (ou corrigido) no D-15, antes da mobilização.</small></div>
        <div className="field-group"><label htmlFor="analysis-execution-start-date">Início da execução previsto</label><DateInput id="analysis-execution-start-date" value={schedule.executionStartDate} disabled={saving || !workflow.permissions.canEdit} onCommit={value => saveSchedule(value, schedule.executionEndDate)} /><small>{scheduleHint(schedule.executionStartSource)}</small></div>
        <div className="field-group"><label htmlFor="analysis-execution-end-date">Fim da execução previsto</label><DateInput id="analysis-execution-end-date" min={schedule.executionStartDate || undefined} value={schedule.executionEndDate} disabled={saving || !workflow.permissions.canEdit} onCommit={value => saveSchedule(schedule.executionStartDate, value)} /><small>{scheduleHint(schedule.executionEndSource)}</small></div>
      </div>
      <article className="project-workflow-analysis-contact">
        <header><div><strong>Contato inicial com o cliente realizado?</strong><p>Esta confirmação exige “Sim”, nome, telefone e data. Enquanto estiver em “Não”, permanece pendente.</p></div><ProjectWorkflowBooleanChoice value={contactMade} label="Contato inicial com o cliente realizado?" disabled={saving || !workflow.permissions.canEdit} onSelect={chooseContact} /></header>
        {contactMade === true ? <div className="project-workflow-analysis-contact-fields">
          <div className="field-group"><label htmlFor="analysis-client-contact-name">Nome do contato *</label><input id="analysis-client-contact-name" value={contactName} maxLength={160} disabled={saving || !workflow.permissions.canEdit} onChange={event => setContactName(event.target.value)} onBlur={() => saveContact()} /></div>
          <div className="field-group project-workflow-phone-field"><label htmlFor="analysis-client-contact-phone">Telefone do contato *</label><div className="project-workflow-phone-control"><div className="project-workflow-country-picker"><button ref={countryTriggerRef} type="button" className="project-workflow-country-trigger" aria-label={`País do telefone: ${contactCountry.name}`} aria-expanded={countryListOpen} aria-haspopup="listbox" disabled={saving || !workflow.permissions.canEdit} onClick={toggleCountryList} onKeyDown={handleCountryKeyDown}><span aria-hidden="true">{phoneCountryFlag(contactCountry.iso)}</span><span>+{contactCountry.callingCode}</span><span aria-hidden="true">▾</span></button>{countryListOpen ? <div ref={countryListRef} className="project-workflow-country-list" role="listbox" aria-label="País do telefone" style={{ top: countryListPosition.top, left: countryListPosition.left, width: countryListPosition.width }}>{PHONE_COUNTRIES.map(country => <button id={`analysis-phone-country-${country.iso}`} type="button" role="option" aria-selected={country.iso === contactCountry.iso} className="project-workflow-country-option" key={`${country.iso}-${country.callingCode}`} onClick={() => { setContactCountry(country); setCountryListOpen(false); saveContact(contactName, contactPhone, country); }}><span aria-hidden="true">{phoneCountryFlag(country.iso)}</span><span>{country.name}</span><span>+{country.callingCode}</span></button>)}</div> : null}</div><input id="analysis-client-contact-phone" type="tel" inputMode="tel" value={contactPhone} placeholder={contactCountry.iso === 'BR' ? 'DDD 00000-0000' : 'Número de telefone'} maxLength={contactCountry.iso === 'BR' ? 13 : 30} disabled={saving || !workflow.permissions.canEdit} onChange={event => setContactPhone(formatPhoneLocal(contactCountry, event.target.value))} onBlur={() => saveContact()} /></div></div>
          <div className="field-group"><span className="field-hint">Data do contato: {contactDate ? displayDateOnly(contactDate) : 'capturada automaticamente ao registrar'}</span></div>
        </div> : null}
        {contactMade === true && (!contactName.trim() || !phoneDigits(contactPhone)) ? <small>Preencha nome e telefone para registrar o contato.</small> : null}
      </article>
    </ProjectWorkflowCategory>
  );
}

export function ProjectWorkflowCriticalityDecision({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: PatchHandler;
}) {
  const [isCritical, setIsCritical] = useState<boolean | null>(workflow.isCritical);
  const [preparationLeadTimeDays, setPreparationLeadTimeDays] = useState(String(workflow.preparationLeadTimeDays || 15));
  useEffect(() => {
    setIsCritical(workflow.isCritical);
    setPreparationLeadTimeDays(String(workflow.preparationLeadTimeDays || 15));
  }, [workflow.isCritical, workflow.preparationLeadTimeDays]);
  const parsedPreparationLeadTimeDays = Number(preparationLeadTimeDays);
  const validPreparationLeadTime = Number.isInteger(parsedPreparationLeadTimeDays) && parsedPreparationLeadTimeDays >= 15;
  const complete = isCritical === false || (isCritical === true && validPreparationLeadTime);
  const chooseCriticality = (value: boolean) => {
    const days = value && validPreparationLeadTime ? parsedPreparationLeadTimeDays : 15;
    setIsCritical(value);
    setPreparationLeadTimeDays(String(days));
    if (value === workflow.isCritical && days === workflow.preparationLeadTimeDays) return;
    onPatch({ action: 'analysis_criticality', version: workflow.version, isCritical: value, preparationLeadTimeDays: value ? days : undefined });
  };
  const savePreparationLeadTime = () => {
    if (isCritical !== true || !validPreparationLeadTime || parsedPreparationLeadTimeDays === workflow.preparationLeadTimeDays) return;
    onPatch({ action: 'analysis_criticality', version: workflow.version, isCritical: true, preparationLeadTimeDays: parsedPreparationLeadTimeDays });
  };
  return (
    <ProjectWorkflowCategory
      title="Classificação final da análise"
      description="Confirme se a obra é crítica antes de avançar para o planejamento."
      area="Análise"
      status={isCritical == null ? 'Decisão pendente' : isCritical ? `Crítica · D-${preparationLeadTimeDays}` : 'Não crítica · D-15'}
      complete={complete}
      className="project-workflow-initial-analysis"
      data-project-workflow-criticality
    >
      <article className="project-workflow-analysis-contact project-workflow-analysis-criticality">
        <header><div><strong>Esta obra é crítica?</strong><p>Obras não críticas usam preparação em D-15. Para uma obra crítica, aumente livremente a antecedência da preparação.</p></div><ProjectWorkflowBooleanChoice value={isCritical} label="Esta obra é crítica?" disabled={saving || !workflow.permissions.canEdit} onSelect={chooseCriticality} /></header>
        {isCritical === true ? <div className="project-workflow-analysis-criticality-fields">
          <div className={`field-group ${preparationLeadTimeDays && !validPreparationLeadTime ? 'field-invalid' : ''}`}>
            <label htmlFor="analysis-preparation-lead-time">Iniciar preparação em D-</label>
            <input id="analysis-preparation-lead-time" type="number" min="15" step="1" inputMode="numeric" value={preparationLeadTimeDays} disabled={saving || !workflow.permissions.canEdit} aria-invalid={!validPreparationLeadTime} onChange={event => setPreparationLeadTimeDays(event.target.value)} />
            <small>Informe 15 dias ou mais; não há limite máximo.</small>
            {!validPreparationLeadTime ? <span className="field-error">Informe um número inteiro igual ou maior que 15.</span> : null}
          </div>
          <Button type="button" variant="secondary" disabled={saving || !workflow.permissions.canEdit || !validPreparationLeadTime || parsedPreparationLeadTimeDays === workflow.preparationLeadTimeDays} onClick={savePreparationLeadTime}>Salvar antecedência</Button>
        </div> : null}
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
        <div className="field-group">
          <span className="project-workflow-toggle-group-label">Acompanhamento</span>
          <div className="project-workflow-toggle-row">
            <label className="project-workflow-release-toggle">
              <input type="checkbox" checked={item.status !== 'PENDING'} disabled={saving || !canEdit} onChange={event => changeStatus(event.target.checked ? 'REQUESTED' : 'PENDING')} />
              <span>Solicitado{item.requestedAt ? ` em ${displayDateOnly(item.requestedAt)}` : ''}</span>
            </label>
            <label className="project-workflow-release-toggle">
              <input type="checkbox" checked={item.status === 'CONFIRMED'} disabled={saving || !canEdit || item.status === 'PENDING'} onChange={event => changeStatus(event.target.checked ? 'CONFIRMED' : 'REQUESTED')} />
              <span>Confirmado{item.confirmedAt ? ` em ${displayDateOnly(item.confirmedAt)}` : ''}</span>
            </label>
          </div>
        </div>
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
      <header><div><h5>{category.label}</h5><p>{category.description}</p></div><ProjectWorkflowBooleanChoice value={category.required} label={`Necessidade de ${category.label.toLocaleLowerCase('pt-BR')}`} disabled={saving || !workflow.permissions.canEdit} onSelect={required => onPatch({ action: 'documentation_category', version: workflow.version, type: category.type, required })} /></header>
      {category.required === true ? <div className="project-workflow-documentation-items">
        <div className="project-workflow-documentation-add"><div className="field-group"><label htmlFor={`documentation-add-${category.type}`}>{category.nameLabel}</label><input id={`documentation-add-${category.type}`} value={newName} disabled={saving || !workflow.permissions.canEdit} placeholder={`Ex.: ${category.type === 'EXAM' ? 'Audiometria' : category.type === 'TRAINING' ? 'APR específica' : category.type === 'QUALITY' ? 'RCPU' : category.type === 'CERTIFICATION' ? 'Calibração de equipamento' : 'Instrução de trabalho'}`} onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); create(); } }} /></div><Button type="button" variant="mini" disabled={saving || !workflow.permissions.canEdit || !newName.trim()} onClick={create}>Adicionar</Button></div>
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
      area="Administrativo"
      progress={workflow.documentationReadiness}
      status={status}
      complete={workflow.documentationReadiness.status === 'OK'}
      className={`project-workflow-documentation is-${workflow.documentationReadiness.status.toLowerCase()}`}
      data-project-workflow-documentation-tracking
    >
      <div className="project-workflow-documentation-types">{workflow.documentationCategories.map(category => <DocumentationTypeCard category={category} workflow={workflow} saving={saving} onPatch={onPatch} key={category.type} />)}</div>
    </ProjectWorkflowCategory>
  );
}
