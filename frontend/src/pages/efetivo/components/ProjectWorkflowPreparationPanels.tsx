import { useEffect, useState } from 'react';

import type {
  ProjectWorkflow,
  ProjectWorkflowClientReleases,
  ProjectWorkflowPatch
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { displayDateOnly, todayDateOnly } from '../../../utils/calendarGrid';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';
import { ProjectWorkflowBooleanChoice } from './ProjectWorkflowBooleanChoice';

function sectionProgress(workflow: ProjectWorkflow, key: 'D15_TEAM' | 'D15_CLIENT' | 'D15_EQUIPMENT' | 'D15_MATERIALS' | 'D15_PRE_JOB' | 'D15_TRAVEL') {
  return workflow.preparationReadiness.sections.find(section => section.key === key)
    || { completed: 0, total: 0, percentage: 0 };
}

function PreparationChecks({ workflow, itemType, itemId, checks, saving, onPatch }: {
  workflow: ProjectWorkflow;
  itemType: 'EQUIPMENT' | 'MATERIAL';
  itemId: string;
  checks: ProjectWorkflow['preparationResources']['equipment']['items'][number]['checks'];
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  return (
    <div className="project-workflow-preparation-resource-checks">
      {checks.map(check => (
        <label className={`project-workflow-member-check${check.status === 'DONE' ? ' is-done' : ''}`} key={check.key}>
          <input
            type="checkbox"
            checked={check.status === 'DONE'}
            disabled={saving || !check.canEdit}
            onChange={event => onPatch({
              action: 'preparation_item_check',
              version: workflow.version,
              itemType,
              itemId,
              key: check.key,
              status: event.target.checked ? 'DONE' : 'PENDING'
            })}
          />
          <span>{check.label}</span>
        </label>
      ))}
    </div>
  );
}

function equipmentAvailability(item: ProjectWorkflow['preparationResources']['equipment']['items'][number]) {
  if (item.availabilityStatus === 'AVAILABLE') return { ready: true, text: 'Na sede e disponível na data necessária' };
  if (item.availabilityStatus === 'EXPECTED_RETURN') return { ready: true, text: 'Retorno previsto antes da mobilização' };
  if (item.availabilityStatus === 'ALLOCATED') return { ready: false, text: 'Indisponível na data necessária' };
  return { ready: false, text: 'Disponibilidade não verificada' };
}

function equipmentMaintenance(item: ProjectWorkflow['preparationResources']['equipment']['items'][number]) {
  const maintenance = item.maintenance;
  if (!maintenance) return { ready: false, text: 'Manutenção não verificada' };
  if (!maintenance.required) return null;
  const last = maintenance.lastMaintenanceDate ? ` · última em ${displayDateOnly(maintenance.lastMaintenanceDate)}` : '';
  if (maintenance.status === 'UPCOMING') return { ready: true, text: `Manutenção em dia${last}` };
  if (maintenance.status === 'DUE_TODAY') return { ready: true, text: `Manutenção vence na data prevista${last}` };
  if (maintenance.status === 'OVERDUE') return { ready: false, text: `Manutenção vencida${last}` };
  if (maintenance.status === 'NO_HISTORY') return { ready: false, text: 'Sem histórico de manutenção' };
  return { ready: false, text: 'Periodicidade de manutenção não configurada' };
}

function equipmentCalibration(item: ProjectWorkflow['preparationResources']['equipment']['items'][number]) {
  const calibration = item.calibration;
  if (!calibration) return { ready: false, text: 'Certificados e calibração não verificados' };
  if (calibration.status === 'NOT_REQUIRED') return { ready: true, text: 'Certificados e calibração não aplicáveis' };
  if (calibration.status === 'VALID') return { ready: true, text: `Certificados e calibração válidos até ${displayDateOnly(calibration.expiresAt)}` };
  if (calibration.status === 'EXPIRED') return { ready: false, text: `Certificados ou calibração vencidos em ${displayDateOnly(calibration.expiresAt)}` };
  return { ready: false, text: 'Certificados ou calibração não informados' };
}

export function ProjectWorkflowEquipmentPreparation({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const progress = sectionProgress(workflow, 'D15_EQUIPMENT');
  const items = workflow.preparationResources.equipment.items;
  const complete = items.length > 0 && progress.percentage === 100;
  return (
    <ProjectWorkflowCategory
      title="Equipamentos reservados"
      description="Condições previstas para a mobilização e conferências de preparação por equipamento."
      status={items.length ? `${progress.completed}/${progress.total}` : 'Pendente'}
      complete={complete}
      className="project-workflow-preparation-resources"
      data-project-workflow-preparation-equipment
    >
      {!items.length ? <p className="project-workflow-category-note">Nenhum equipamento foi reservado no planejamento D-30.</p> : (
        <div className="project-workflow-preparation-resource-list">
          {items.map(item => {
            const statuses = [equipmentAvailability(item), equipmentMaintenance(item), equipmentCalibration(item)].filter(status => status !== null);
            return (
              <article className="project-workflow-preparation-resource" key={item.id}>
                <header>
                  <div><strong>{item.code ? `${item.code} · ` : ''}{item.name}</strong><span>{item.categoryName}</span></div>
                  <span>{item.checks.filter(check => check.status === 'DONE').length}/{item.checks.length}</span>
                </header>
                <ul className="project-workflow-preparation-resource-statuses">
                  {statuses.map(status => <li className={status.ready ? 'is-ready' : 'has-warning'} key={status.text}>{status.ready ? '●' : '▲'} {status.text}</li>)}
                </ul>
                <PreparationChecks workflow={workflow} itemType="EQUIPMENT" itemId={item.id} checks={item.checks} saving={saving} onPatch={onPatch} />
              </article>
            );
          })}
        </div>
      )}
      <small className="project-workflow-integration-note">Disponibilidade, manutenção e calibração são consultadas no cadastro de ativos e sinalizam riscos; as conferências são registradas individualmente.</small>
    </ProjectWorkflowCategory>
  );
}

export function ProjectWorkflowPreJobPanel({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const progress = sectionProgress(workflow, 'D15_PRE_JOB');
  const complete = progress.total > 0 && progress.percentage === 100;
  return (
    <ProjectWorkflowCategory
      title="Pré-job"
      description="Registre as datas de agendamento e realização. Cada alteração é salva automaticamente."
      status={`${progress.completed}/${progress.total}`}
      complete={complete}
      data-project-workflow-pre-job
    >
      <div className="project-workflow-form-grid compact">
        <div className="field-group">
          <label htmlFor="workflow-pre-job-scheduled-date">Agendado</label>
          <input
            id="workflow-pre-job-scheduled-date"
            type="date"
            value={workflow.preJob.scheduledDate || ''}
            disabled={saving || !workflow.preJob.canEdit}
            onChange={event => onPatch({
              action: 'pre_job',
              version: workflow.version,
              scheduledDate: event.target.value || null
            })}
          />
        </div>
        <div className="field-group">
          <label htmlFor="workflow-pre-job-completed-date">Realizado</label>
          <input
            id="workflow-pre-job-completed-date"
            type="date"
            min={workflow.preJob.scheduledDate || undefined}
            value={workflow.preJob.completedDate || ''}
            disabled={saving || !workflow.preJob.canEdit}
            onChange={event => onPatch({
              action: 'pre_job',
              version: workflow.version,
              completedDate: event.target.value || null
            })}
          />
        </div>
      </div>
      {workflow.preJob.canEdit ? <small className="project-workflow-autosave-label">Salvamento automático</small> : null}
    </ProjectWorkflowCategory>
  );
}

export function ProjectWorkflowTravelPanel({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const travel = workflow.travel;
  const progress = sectionProgress(workflow, 'D15_TRAVEL');
  const complete = progress.total > 0 && progress.percentage === 100;
  const [transportDescription, setTransportDescription] = useState(travel.teamTransportDescription || '');
  useEffect(() => setTransportDescription(travel.teamTransportDescription || ''), [travel.teamTransportDescription]);
  return (
    <ProjectWorkflowCategory
      title="Viagem e logística"
      description="Confirme hospedagem, transporte da equipe e frete para a saída."
      status={`${progress.completed}/${progress.total}`}
      complete={complete}
      data-project-workflow-travel
    >
      <div className="project-workflow-preparation-resource-list">
        <article className="project-workflow-client-release">
          <header><strong>Hospedagem</strong><span>{travel.lodgingRequired ? 'Necessária' : 'Não necessária'}</span></header>
          {travel.lodgingRequired ? (
            <div className="project-workflow-form-grid compact">
              <div className="field-group">
                <label htmlFor="workflow-lodging-requested-date">Hospedagem solicitada</label>
                <input id="workflow-lodging-requested-date" type="date" value={travel.lodgingRequestedDate || ''} disabled={saving || !travel.canEditLodging} onChange={event => onPatch({ action: 'travel', version: workflow.version, lodgingRequestedDate: event.target.value || null })} />
              </div>
              <div className="field-group">
                <label htmlFor="workflow-lodging-confirmed-date">Hospedagem confirmada</label>
                <input id="workflow-lodging-confirmed-date" type="date" min={travel.lodgingRequestedDate || undefined} value={travel.lodgingConfirmedDate || ''} disabled={saving || !travel.canEditLodging} onChange={event => onPatch({ action: 'travel', version: workflow.version, lodgingConfirmedDate: event.target.value || null })} />
              </div>
            </div>
          ) : <p className="project-workflow-category-note">O planejamento D-30 informa que não haverá hospedagem.</p>}
        </article>

        <article className="project-workflow-client-release">
          <header><strong>Transporte da equipe definido</strong><span>{travel.teamTransportDefined === null ? 'Pendente' : travel.teamTransportDefined ? 'Sim' : 'Não'}</span></header>
          <ProjectWorkflowBooleanChoice
            value={travel.teamTransportDefined}
            label="Transporte da equipe definido"
            disabled={saving || !travel.canEditLogistics}
            onSelect={value => onPatch({
              action: 'travel',
              version: workflow.version,
              teamTransportDefined: value,
              ...(value ? {} : { teamTransportDescription: null })
            })}
          />
          {travel.teamTransportDefined ? (
            <div className="field-group">
              <label htmlFor="workflow-team-transport-description">Descrição do transporte</label>
              <textarea
                id="workflow-team-transport-description"
                value={transportDescription}
                disabled={saving || !travel.canEditLogistics}
                placeholder="Descreva como será feito o transporte da equipe"
                onChange={event => setTransportDescription(event.target.value)}
                onBlur={() => {
                  const normalized = transportDescription.trim();
                  if (normalized !== (travel.teamTransportDescription || '')) {
                    onPatch({ action: 'travel', version: workflow.version, teamTransportDescription: normalized || null });
                  }
                }}
              />
            </div>
          ) : null}
        </article>

        <article className="project-workflow-client-release">
          <header><strong>Frete</strong><span>{!travel.freightRequired ? 'Não necessário' : travel.freightDefined === null ? 'Pendente' : travel.freightDefined ? 'Definido' : 'Não definido'}</span></header>
          {travel.freightRequired ? <ProjectWorkflowBooleanChoice
            value={travel.freightDefined}
            label="Definição do frete"
            yesLabel="Definido"
            noLabel="Não definido"
            disabled={saving || !travel.canEditLogistics}
            onSelect={value => onPatch({
              action: 'travel',
              version: workflow.version,
              freightDefined: value,
              ...(value ? {} : { freightType: null, freightDepartureDate: null, freightDepartureTime: null })
            })}
          /> : <p className="project-workflow-category-note">O planejamento D-30 informa que não haverá frete.</p>}
          {travel.freightRequired && travel.freightDefined ? (
            <div className="project-workflow-form-grid compact">
              <div className="field-group">
                <label htmlFor="workflow-freight-type">Tipo de frete</label>
                <select id="workflow-freight-type" value={travel.freightType || ''} disabled={saving || !travel.canEditLogistics} onChange={event => onPatch({ action: 'travel', version: workflow.version, freightType: event.target.value ? event.target.value as 'OWN' | 'THIRD_PARTY' : null })}>
                  <option value="">Selecione</option>
                  <option value="OWN">Próprio</option>
                  <option value="THIRD_PARTY">Terceiro</option>
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="workflow-freight-departure-date">Data de saída</label>
                <input id="workflow-freight-departure-date" type="date" value={travel.freightDepartureDate || ''} disabled={saving || !travel.canEditLogistics} onChange={event => onPatch({ action: 'travel', version: workflow.version, freightDepartureDate: event.target.value || null })} />
              </div>
              <div className="field-group">
                <label htmlFor="workflow-freight-departure-time">Horário de saída</label>
                <input id="workflow-freight-departure-time" type="time" value={travel.freightDepartureTime || ''} disabled={saving || !travel.canEditLogistics} onChange={event => onPatch({ action: 'travel', version: workflow.version, freightDepartureTime: event.target.value || null })} />
              </div>
            </div>
          ) : null}
        </article>
      </div>
      {(travel.canEditLodging || travel.canEditLogistics) ? <small className="project-workflow-autosave-label">Salvamento automático</small> : null}
    </ProjectWorkflowCategory>
  );
}

export function ProjectWorkflowMaterialsPreparation({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const progress = sectionProgress(workflow, 'D15_MATERIALS');
  const items = workflow.preparationResources.materials.items;
  const complete = items.length > 0 && progress.percentage === 100;
  return (
    <ProjectWorkflowCategory
      title="Materiais e insumos programados"
      description="Saldo atual do estoque e separação individual do que foi definido no planejamento D-30."
      status={items.length ? `${progress.completed}/${progress.total}` : 'Pendente'}
      complete={complete}
      className="project-workflow-preparation-resources"
      data-project-workflow-preparation-materials
    >
      {!items.length ? <p className="project-workflow-category-note">Nenhum material ou insumo foi programado no planejamento D-30.</p> : (
        <div className="project-workflow-preparation-resource-list">
          {items.map(item => (
            <article className="project-workflow-preparation-resource" key={item.id}>
              <header>
                <div><strong>{item.code ? `${item.code} · ` : ''}{item.name}</strong><span>{item.type === 'FILTRO' ? 'Filtro' : 'Produto químico'}</span></div>
                <span>{item.checks.filter(check => check.status === 'DONE').length}/{item.checks.length}</span>
              </header>
              <div className="project-workflow-preparation-stock">
                <span>Programado: <strong>{item.requiredQuantity} {item.unitLabel}</strong></span>
                <span>Estoque atual: <strong>{item.availableQuantity} {item.unitLabel}</strong></span>
                {!item.stockItemId
                  ? <strong className="has-warning">Não cadastrado no estoque</strong>
                  : item.availableInStock
                    ? <strong className="is-ready">● Disponível em estoque</strong>
                    : <strong className="has-warning">▲ Estoque insuficiente · faltam {item.shortageQuantity} {item.unitLabel}</strong>}
              </div>
              {item.purchaseRequired && (item.requestedAt || item.purchasedAt) ? <small className="project-workflow-preparation-purchase">Pedido: {item.requestedAt ? displayDateOnly(item.requestedAt) : 'não informado'} · Compra: {item.purchasedAt ? displayDateOnly(item.purchasedAt) : 'pendente'}</small> : null}
              <PreparationChecks workflow={workflow} itemType="MATERIAL" itemId={item.id} checks={item.checks} saving={saving} onPatch={onPatch} />
            </article>
          ))}
        </div>
      )}
    </ProjectWorkflowCategory>
  );
}

export function ProjectWorkflowDefinitiveTeam({ workflow, saving, onPatch, onOpenTeamProgramming }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
  onOpenTeamProgramming: () => void;
}) {
  const progress = sectionProgress(workflow, 'D15_TEAM');
  const members = workflow.teamPreparation.members;
  const complete = members.length > 0 && progress.percentage === 100;
  return (
    <ProjectWorkflowCategory
      title="Equipe definitiva"
      description="Acompanhe a preparação individual de cada colaborador selecionado."
      status={members.length ? `${progress.completed}/${progress.total}` : 'Pendente'}
      complete={complete}
      className="project-workflow-definitive-team"
      data-project-workflow-definitive-team
    >
      {!members.length ? (
        <div className="project-workflow-empty-team">
          <div><strong>Aguardando definição da equipe</strong><p>Defina os nomes que participarão do primeiro ciclo da obra.</p></div>
          <Button type="button" variant="secondary" onClick={onOpenTeamProgramming}>Definir equipe inicial</Button>
        </div>
      ) : (
        <>
          <div className="project-workflow-team-heading">
            <p>{members.length} colaborador(es) definido(s) para o primeiro ciclo.</p>
            <Button type="button" variant="secondary" onClick={onOpenTeamProgramming}>Editar equipe inicial</Button>
          </div>
          <div className="project-workflow-team-members">
            {members.map(member => (
              <article className="project-workflow-team-member" key={member.collaboratorId}>
                <header><div><strong>{member.name}</strong><span>{member.role}</span></div><span>{member.checks.filter(check => check.status === 'DONE').length}/{member.checks.length}</span></header>
                <div className="project-workflow-team-member-checks">
                  {member.checks.map(check => (
                    <label className={`project-workflow-member-check${check.status === 'DONE' ? ' is-done' : ''}`} key={check.key}>
                      <input
                        type="checkbox"
                        checked={check.status === 'DONE'}
                        disabled={saving || !check.canEdit}
                        onChange={event => onPatch({
                          action: 'team_member_check',
                          version: workflow.version,
                          collaboratorId: member.collaboratorId,
                          key: check.key,
                          status: event.target.checked ? 'DONE' : 'PENDING'
                        })}
                      />
                      <span>{check.label}</span>
                      {check.source === 'EXTERNAL' ? <small>Sincronizado</small> : null}
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <small className="project-workflow-integration-note">Exames e treinamentos estão em confirmação manual. A origem de cada item já está preparada para a futura integração externa.</small>
        </>
      )}
    </ProjectWorkflowCategory>
  );
}

type ReleaseItem = ProjectWorkflowClientReleases['items'][number];

function ClientReleaseItem({ workflow, item, saving, onPatch }: {
  workflow: ProjectWorkflow;
  item: ReleaseItem;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const [values, setValues] = useState({
    requested: item.requested,
    requestedAt: item.requestedAt || '',
    requestedTo: item.requestedTo || '',
    completed: item.completed,
    completedAt: item.completedAt || ''
  });
  useEffect(() => setValues({
    requested: item.requested,
    requestedAt: item.requestedAt || '',
    requestedTo: item.requestedTo || '',
    completed: item.completed,
    completedAt: item.completedAt || ''
  }), [item.completed, item.completedAt, item.requested, item.requestedAt, item.requestedTo]);

  const save = (next: typeof values) => {
    setValues(next);
    onPatch({
      action: 'client_release',
      version: workflow.version,
      key: item.key,
      requested: next.requested,
      requestedAt: next.requestedAt || null,
      requestedTo: next.requestedTo.trim() || null,
      completed: next.completed,
      completedAt: next.completedAt || null
    });
  };
  const requestComplete = values.requested && Boolean(values.requestedAt && values.requestedTo.trim());
  const complete = requestComplete && values.completed && Boolean(values.completedAt);
  const disabled = saving || !item.canEdit;
  return (
    <article className={`project-workflow-client-release${complete ? ' is-complete' : ''}`}>
      <header><strong>{item.label}</strong><span>{complete ? 'Concluído' : values.requested ? 'Em andamento' : 'Pendente'}</span></header>
      <label className="project-workflow-release-toggle">
        <input
          type="checkbox"
          checked={values.requested}
          disabled={disabled}
          onChange={event => {
            const requested = event.target.checked;
            save({
              ...values,
              requested,
              requestedAt: requested ? values.requestedAt || todayDateOnly() : '',
              completed: requested ? values.completed : false,
              completedAt: requested ? values.completedAt : ''
            });
          }}
        />
        <span>Solicitado</span>
      </label>
      {values.requested ? (
        <div className="project-workflow-client-release-fields">
          <div className="field-group"><label htmlFor={`client-release-date-${item.key}`}>Data da solicitação</label><input id={`client-release-date-${item.key}`} type="date" value={values.requestedAt} disabled={disabled} onChange={event => save({ ...values, requestedAt: event.target.value })} /></div>
          <div className="field-group"><label htmlFor={`client-release-to-${item.key}`}>Solicitado para quem</label><input id={`client-release-to-${item.key}`} value={values.requestedTo} disabled={disabled} placeholder="Nome ou setor responsável" onChange={event => setValues(current => ({ ...current, requestedTo: event.target.value }))} onBlur={event => {
            const card = event.currentTarget.closest('.project-workflow-client-release');
            const nextTarget = event.relatedTarget;
            if (nextTarget instanceof Node && card?.contains(nextTarget)) return;
            if (values.requestedTo !== (item.requestedTo || '')) save(values);
          }} /></div>
          <label className="project-workflow-release-toggle">
            <input
              type="checkbox"
              checked={values.completed}
              disabled={disabled}
              onChange={event => {
                const completed = event.target.checked;
                save({ ...values, completed, completedAt: completed ? values.completedAt || todayDateOnly() : '' });
              }}
            />
            <span>Concluído</span>
          </label>
          {values.completed ? <div className="field-group"><label htmlFor={`client-release-completed-${item.key}`}>Data da conclusão</label><input id={`client-release-completed-${item.key}`} type="date" min={values.requestedAt || undefined} value={values.completedAt} disabled={disabled} onChange={event => save({ ...values, completedAt: event.target.value })} /></div> : null}
        </div>
      ) : null}
      {item.source === 'EXTERNAL' ? <small className="project-workflow-integration-note">Dados sincronizados pela integração externa.</small> : null}
    </article>
  );
}

export function ProjectWorkflowClientReleasesPanel({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const attendance = workflow.clientReleases.attendance;
  const [attendanceDate, setAttendanceDate] = useState(attendance.date || '');
  useEffect(() => setAttendanceDate(attendance.date || ''), [attendance.date]);
  const progress = sectionProgress(workflow, 'D15_CLIENT');
  const complete = progress.total > 0 && progress.percentage === 100;
  const attendanceChanged = attendanceDate !== (attendance.date || '');
  return (
    <ProjectWorkflowCategory
      title="Cliente e liberações"
      description="Confirme o atendimento e acompanhe as solicitações enviadas ao cliente."
      status={`${progress.completed}/${progress.total}`}
      complete={complete}
      className="project-workflow-client-releases"
      data-project-workflow-client-releases
    >
      <article className={`project-workflow-client-attendance${attendance.confirmed && !attendanceChanged ? ' is-complete' : ''}`}>
        <header><div><strong>Confirmação do atendimento</strong><span>A previsão comercial de início já aparece preenchida e pode ser ajustada antes da confirmação.</span></div><span>{attendance.confirmed && !attendanceChanged ? 'Confirmado' : 'Pendente'}</span></header>
        <div className="project-workflow-client-attendance-fields">
          <div className="field-group"><label htmlFor="project-workflow-attendance-date">Data do atendimento</label><input id="project-workflow-attendance-date" type="date" value={attendanceDate} disabled={saving || !attendance.canEdit} onChange={event => setAttendanceDate(event.target.value)} /></div>
          <Button type="button" variant="secondary" disabled={saving || !attendance.canEdit || !attendanceDate || (attendance.confirmed && !attendanceChanged)} onClick={() => onPatch({ action: 'client_attendance', version: workflow.version, attendanceDate })}>{attendance.confirmed ? 'Confirmar nova data' : 'Confirmar atendimento'}</Button>
        </div>
      </article>
      <div className="project-workflow-client-release-list">
        {workflow.clientReleases.items.map(item => <ClientReleaseItem workflow={workflow} item={item} saving={saving} onPatch={onPatch} key={item.key} />)}
      </div>
    </ProjectWorkflowCategory>
  );
}
