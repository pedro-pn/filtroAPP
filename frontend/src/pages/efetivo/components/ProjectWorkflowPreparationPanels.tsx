import { useEffect, useState } from 'react';

import {
  PROJECT_WORKFLOW_TRANSPORT_MODES,
  PROJECT_WORKFLOW_TRANSPORT_MODE_LABELS,
  PROJECT_WORKFLOW_TRANSPORT_VEHICLE_TYPES,
  PROJECT_WORKFLOW_TRANSPORT_VEHICLE_TYPE_LABELS
} from '../../../../../shared/schemas/project-workflow.js';
import type {
  ProjectWorkflow,
  ProjectWorkflowClientReleases,
  ProjectWorkflowPatch,
  ProjectWorkflowScheduleConfirmationField,
  ProjectWorkflowTransportMode
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { DateInput } from '../../../components/ui/DateInput';
import { displayDateOnly, todayDateOnly } from '../../../utils/calendarGrid';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';
import { ProjectWorkflowBooleanChoice } from './ProjectWorkflowBooleanChoice';
import { ProjectWorkflowIcon } from './ProjectWorkflowIcon';
import { initialsOf } from '../../../utils/projectWorkflowPresentation';

function sectionProgress(workflow: ProjectWorkflow, key: 'D15_TEAM' | 'D15_CLIENT' | 'D15_EQUIPMENT' | 'D15_MATERIALS' | 'D15_PRE_JOB' | 'D15_TRAVEL' | 'D15_QSMS') {
  return workflow.preparationReadiness.sections.find(section => section.key === key)
    || { completed: 0, total: 0, percentage: 0, optional: false };
}

// Rótulo curto para o cabeçalho da frente; a contagem completa aparece no índice da etapa.
function preparationStatusLabel(progress: { completed: number; total: number; optional?: boolean }) {
  // Na Sede a frente é opcional: continua visível, mas não bloqueia o avanço.
  if (progress.optional) return progress.total && progress.completed >= progress.total ? 'Concluído (opcional)' : 'Opcional';
  if (!progress.total) return 'Sem itens';
  if (progress.completed >= progress.total) return 'Concluído';
  return `${progress.total - progress.completed} pendente${progress.total - progress.completed === 1 ? '' : 's'}`;
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
          <span className="project-workflow-check-box" aria-hidden="true"><ProjectWorkflowIcon name="check" /></span>
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
      area="Ativos"
      progress={progress}
      status={items.length ? preparationStatusLabel(progress) : 'Sem equipamentos'}
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
      area="Operações"
      progress={progress}
      status={preparationStatusLabel(progress)}
      complete={complete}
      data-project-workflow-pre-job
    >
      <div className="project-workflow-client-release-fields">
        <label className="project-workflow-release-toggle">
          <input
            type="checkbox"
            checked={Boolean(workflow.preJob.scheduledDate)}
            disabled={saving || !workflow.preJob.canEdit}
            onChange={event => onPatch({
              action: 'pre_job',
              version: workflow.version,
              scheduledDate: event.target.checked ? todayDateOnly() : null,
              ...(event.target.checked ? {} : { completedDate: null })
            })}
          />
          <span>Agendado{workflow.preJob.scheduledDate ? ` em ${displayDateOnly(workflow.preJob.scheduledDate)}` : ''}</span>
        </label>
        <label className="project-workflow-release-toggle">
          <input
            type="checkbox"
            checked={Boolean(workflow.preJob.completedDate)}
            disabled={saving || !workflow.preJob.canEdit || !workflow.preJob.scheduledDate}
            onChange={event => onPatch({
              action: 'pre_job',
              version: workflow.version,
              completedDate: event.target.checked ? todayDateOnly() : null
            })}
          />
          <span>Realizado{workflow.preJob.completedDate ? ` em ${displayDateOnly(workflow.preJob.completedDate)}` : ''}</span>
        </label>
      </div>
      {workflow.preJob.canEdit ? <small className="project-workflow-autosave-label">Salvamento automático</small> : null}
    </ProjectWorkflowCategory>
  );
}

export function ProjectWorkflowQsmsPanel({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const progress = sectionProgress(workflow, 'D15_QSMS');
  const qsms = workflow.qsms;
  const complete = progress.total > 0 && progress.percentage === 100;
  const [verificationNote, setVerificationNote] = useState(qsms.verificationNote || '');
  useEffect(() => setVerificationNote(qsms.verificationNote || ''), [qsms.verificationNote]);
  const status = qsms.verified === null
    ? progress.optional ? 'Opcional' : 'Pendente'
    : qsms.verified ? 'Verificado' : 'Não verificado';
  return (
    <ProjectWorkflowCategory
      title="QSMS"
      description="Confirme a verificação e registre o que foi verificado para o projeto."
      area="QSMS"
      status={status}
      complete={complete}
      data-project-workflow-qsms
    >
      <article className="project-workflow-client-release">
        <header><strong>Foi verificado?</strong><span>{status}</span></header>
        <ProjectWorkflowBooleanChoice
          value={qsms.verified}
          label="QSMS verificado"
          disabled={saving || !qsms.canEdit}
          onSelect={verified => onPatch({
            action: 'qsms',
            version: workflow.version,
            verified,
            ...(verified ? {} : { verificationNote: null })
          })}
        />
        {qsms.verified ? (
          <div className="field-group">
            <label htmlFor="workflow-qsms-verification-note">O que foi verificado? (opcional)</label>
            <textarea
              id="workflow-qsms-verification-note"
              value={verificationNote}
              disabled={saving || !qsms.canEdit}
              placeholder="Registre os requisitos, documentos ou condições verificados"
              onChange={event => setVerificationNote(event.target.value)}
              onBlur={() => {
                const normalized = verificationNote.trim();
                if (normalized !== (qsms.verificationNote || '')) {
                  onPatch({ action: 'qsms', version: workflow.version, verificationNote: normalized || null });
                }
              }}
            />
          </div>
        ) : null}
      </article>
      {qsms.canEdit ? <small className="project-workflow-autosave-label">Salvamento automático</small> : null}
    </ProjectWorkflowCategory>
  );
}

// Seletor de veículo/transporte usado tanto no transporte da equipe quanto no frete: "Nosso" e "Frete"
// escolhem um tipo de veículo do catálogo daquele modo; "Locação de carro" não tem tipo, só quantidade.
function TransportVehicleSelector({ idPrefix, mode, vehicleType, quantity, disabled, onModeChange, onVehicleTypeChange, onQuantityChange }: {
  idPrefix: string;
  mode: ProjectWorkflowTransportMode | null;
  vehicleType: string | null;
  quantity: number | null;
  disabled: boolean;
  onModeChange: (mode: ProjectWorkflowTransportMode) => void;
  onVehicleTypeChange: (vehicleType: string | null) => void;
  onQuantityChange: (quantity: number | null) => void;
}) {
  const vehicleOptions: readonly string[] = mode === 'OWN' || mode === 'THIRD_PARTY' ? PROJECT_WORKFLOW_TRANSPORT_VEHICLE_TYPES[mode] : [];
  return (
    <div className="project-workflow-form-grid compact">
      <div className="field-group">
        <label htmlFor={`${idPrefix}-mode`}>Veículo</label>
        <select id={`${idPrefix}-mode`} value={mode || ''} disabled={disabled} onChange={event => onModeChange(event.target.value as ProjectWorkflowTransportMode)}>
          <option value="">Selecione</option>
          {PROJECT_WORKFLOW_TRANSPORT_MODES.map((item: ProjectWorkflowTransportMode) => <option value={item} key={item}>{PROJECT_WORKFLOW_TRANSPORT_MODE_LABELS[item]}</option>)}
        </select>
      </div>
      {mode && mode !== 'RENTAL' ? (
        <div className="field-group">
          <label htmlFor={`${idPrefix}-vehicle-type`}>Tipo</label>
          <select id={`${idPrefix}-vehicle-type`} value={vehicleType || ''} disabled={disabled} onChange={event => onVehicleTypeChange(event.target.value || null)}>
            <option value="">Selecione</option>
            {vehicleOptions.map(item => <option value={item} key={item}>{PROJECT_WORKFLOW_TRANSPORT_VEHICLE_TYPE_LABELS[item] || item}</option>)}
          </select>
        </div>
      ) : null}
      {mode ? (
        <div className="field-group">
          <label htmlFor={`${idPrefix}-quantity`}>Quantos vão</label>
          <input id={`${idPrefix}-quantity`} type="number" min="1" max="99" value={quantity ?? ''} disabled={disabled} onChange={event => onQuantityChange(event.target.value ? Number(event.target.value) : null)} />
        </div>
      ) : null}
    </div>
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
  return (
    <ProjectWorkflowCategory
      title="Viagem e logística"
      description={workflow.executedAtHeadquarters ? 'Projeto na Sede: transporte da equipe e frete são opcionais e não há hospedagem.' : 'Confirme hospedagem, transporte da equipe e frete para a saída.'}
      area="Logística"
      progress={progress}
      status={preparationStatusLabel(progress)}
      complete={complete}
      data-project-workflow-travel
    >
      <div className="project-workflow-preparation-resource-list">
        {workflow.executedAtHeadquarters ? null : <article className="project-workflow-client-release">
          <header><strong>Hospedagem</strong><span>{travel.lodgingRequired ? 'Necessária' : 'Não necessária'}</span></header>
          {travel.lodgingRequired ? (
            <div className="project-workflow-client-release-fields">
              <label className="project-workflow-release-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(travel.lodgingRequestedDate)}
                  disabled={saving || !travel.canEditLodging}
                  onChange={event => onPatch({
                    action: 'travel',
                    version: workflow.version,
                    lodgingRequestedDate: event.target.checked ? todayDateOnly() : null,
                    ...(event.target.checked ? {} : { lodgingConfirmedDate: null })
                  })}
                />
                <span>Hospedagem solicitada{travel.lodgingRequestedDate ? ` em ${displayDateOnly(travel.lodgingRequestedDate)}` : ''}</span>
              </label>
              <label className="project-workflow-release-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(travel.lodgingConfirmedDate)}
                  disabled={saving || !travel.canEditLodging || !travel.lodgingRequestedDate}
                  onChange={event => onPatch({ action: 'travel', version: workflow.version, lodgingConfirmedDate: event.target.checked ? todayDateOnly() : null })}
                />
                <span>Hospedagem confirmada{travel.lodgingConfirmedDate ? ` em ${displayDateOnly(travel.lodgingConfirmedDate)}` : ''}</span>
              </label>
            </div>
          ) : <p className="project-workflow-category-note">O planejamento D-30 informa que não haverá hospedagem.</p>}
        </article>}

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
              ...(value ? {} : { teamTransportMode: null, teamTransportVehicleType: null, teamTransportQuantity: null })
            })}
          />
          {travel.teamTransportDefined ? (
            <TransportVehicleSelector
              idPrefix="workflow-team-transport"
              mode={travel.teamTransportMode}
              vehicleType={travel.teamTransportVehicleType}
              quantity={travel.teamTransportQuantity}
              disabled={saving || !travel.canEditLogistics}
              onModeChange={mode => onPatch({
                action: 'travel',
                version: workflow.version,
                teamTransportMode: mode,
                ...(mode === 'RENTAL' ? { teamTransportVehicleType: null } : {})
              })}
              onVehicleTypeChange={vehicleType => onPatch({ action: 'travel', version: workflow.version, teamTransportVehicleType: vehicleType })}
              onQuantityChange={quantity => onPatch({ action: 'travel', version: workflow.version, teamTransportQuantity: quantity })}
            />
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
              ...(value ? {} : { freightMode: null, freightVehicleType: null, freightQuantity: null, freightDepartureDate: null, freightDepartureTime: null })
            })}
          /> : <p className="project-workflow-category-note">O planejamento D-30 informa que não haverá frete.</p>}
          {travel.freightRequired && travel.freightDefined ? (
            <>
              <TransportVehicleSelector
                idPrefix="workflow-freight"
                mode={travel.freightMode}
                vehicleType={travel.freightVehicleType}
                quantity={travel.freightQuantity}
                disabled={saving || !travel.canEditLogistics}
                onModeChange={mode => onPatch({
                  action: 'travel',
                  version: workflow.version,
                  freightMode: mode,
                  ...(mode === 'RENTAL' ? { freightVehicleType: null } : {})
                })}
                onVehicleTypeChange={vehicleType => onPatch({ action: 'travel', version: workflow.version, freightVehicleType: vehicleType })}
                onQuantityChange={quantity => onPatch({ action: 'travel', version: workflow.version, freightQuantity: quantity })}
              />
              <div className="project-workflow-form-grid compact">
                <div className="field-group">
                  <label htmlFor="workflow-freight-departure-date">Data de saída</label>
                  <DateInput id="workflow-freight-departure-date" value={travel.freightDepartureDate || ''} disabled={saving || !travel.canEditLogistics} onCommit={value => onPatch({ action: 'travel', version: workflow.version, freightDepartureDate: value || null })} />
                </div>
                <div className="field-group">
                  <label htmlFor="workflow-freight-departure-time">Horário de saída</label>
                  <input id="workflow-freight-departure-time" type="time" value={travel.freightDepartureTime || ''} disabled={saving || !travel.canEditLogistics} onChange={event => onPatch({ action: 'travel', version: workflow.version, freightDepartureTime: event.target.value || null })} />
                </div>
              </div>
            </>
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
      area="Suprimentos"
      progress={progress}
      status={items.length ? preparationStatusLabel(progress) : 'Sem materiais'}
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
                <div className={`project-workflow-stock-meter${item.stockItemId && !item.availableInStock ? ' is-short' : ''}`} aria-hidden="true">
                  <i style={{ width: `${item.requiredQuantity > 0 ? Math.min(100, Math.round((item.availableQuantity / item.requiredQuantity) * 100)) : 100}%` }} />
                </div>
                <span><strong>{item.availableQuantity}</strong> de <strong>{item.requiredQuantity} {item.unitLabel}</strong> em estoque</span>
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
      area="Operações"
      icon="users"
      progress={progress}
      status={members.length ? preparationStatusLabel(progress) : 'Equipe não definida'}
      complete={complete}
      initiallyOpen
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
                <header><span className="project-workflow-avatar is-large" aria-hidden="true">{initialsOf(member.name)}</span><div><strong>{member.name}</strong><span>{member.role}</span></div><span className={member.checks.every(check => check.status === 'DONE') ? 'is-complete' : undefined}>{member.checks.filter(check => check.status === 'DONE').length}/{member.checks.length}</span></header>
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
                      <span className="project-workflow-check-box" aria-hidden="true"><ProjectWorkflowIcon name="check" /></span>
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
    completed: item.completed,
    completedAt: item.completedAt || ''
  });
  useEffect(() => setValues({
    requested: item.requested,
    requestedAt: item.requestedAt || '',
    completed: item.completed,
    completedAt: item.completedAt || ''
  }), [item.completed, item.completedAt, item.requested, item.requestedAt]);

  const save = (next: typeof values) => {
    setValues(next);
    onPatch({
      action: 'client_release',
      version: workflow.version,
      key: item.key,
      requested: next.requested,
      requestedAt: next.requestedAt || null,
      completed: next.completed,
      completedAt: next.completedAt || null
    });
  };
  const complete = values.requested && Boolean(values.requestedAt) && values.completed && Boolean(values.completedAt);
  const disabled = saving || !item.canEdit;
  return (
    <article className={`project-workflow-client-release${complete ? ' is-complete' : ''}`}>
      <header><strong>{item.label}</strong><span>{complete ? 'Concluído' : values.requested ? 'Em andamento' : 'Pendente'}</span></header>
      <div className="project-workflow-client-release-fields">
        <label className="project-workflow-release-toggle">
          <input
            type="checkbox"
            checked={values.requested}
            disabled={disabled}
            onChange={event => {
              const requested = event.target.checked;
              save({
                requested,
                requestedAt: requested ? values.requestedAt || todayDateOnly() : '',
                completed: requested ? values.completed : false,
                completedAt: requested ? values.completedAt : ''
              });
            }}
          />
          <span>Solicitado{values.requestedAt ? ` em ${displayDateOnly(values.requestedAt)}` : ''}</span>
        </label>
        <label className="project-workflow-release-toggle">
          <input
            type="checkbox"
            checked={values.completed}
            disabled={disabled || !values.requested}
            onChange={event => {
              const completed = event.target.checked;
              save({ ...values, completed, completedAt: completed ? values.completedAt || todayDateOnly() : '' });
            }}
          />
          <span>Concluído{values.completedAt ? ` em ${displayDateOnly(values.completedAt)}` : ''}</span>
        </label>
      </div>
      {item.source === 'EXTERNAL' ? <small className="project-workflow-integration-note">Dados sincronizados pela integração externa.</small> : null}
    </article>
  );
}

// Enquanto não existe integração com o CRM, as datas comerciais estimadas são digitadas manualmente na Análise
// inicial; aqui no D-15 pedimos para confirmar se continuam valendo ou corrigir, antes da mobilização.
function CommercialScheduleConfirmationItem({ workflow, field, label, data, saving, onPatch }: {
  workflow: ProjectWorkflow;
  field: 'START' | 'MOBILIZATION';
  label: string;
  data: ProjectWorkflowScheduleConfirmationField;
  saving: boolean;
  onPatch: (payload: ProjectWorkflowPatch) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [newDate, setNewDate] = useState(data.value || '');
  useEffect(() => { setEditing(false); setNewDate(data.value || ''); }, [data.value]);
  const disabled = saving || !workflow.clientReleases.scheduleConfirmation.canEdit;
  const confirm = (date?: string) => {
    onPatch({ action: 'commercial_schedule_confirm', version: workflow.version, field, ...(date !== undefined ? { date } : {}) });
    setEditing(false);
  };
  return (
    <article className={`project-workflow-client-attendance${data.confirmed ? ' is-complete' : ''}`}>
      <header><div><strong>{label}</strong><span>{data.value ? displayDateOnly(data.value) : 'Sem data'}</span></div><span>{data.confirmed ? 'Confirmado' : 'Pendente'}</span></header>
      {editing ? (
        <div className="project-workflow-client-attendance-fields">
          <div className="field-group"><label htmlFor={`commercial-schedule-${field}`}>Nova data</label><DateInput id={`commercial-schedule-${field}`} value={newDate} disabled={disabled} onCommit={setNewDate} /></div>
          <Button type="button" variant="secondary" disabled={disabled || !newDate} onClick={() => confirm(newDate)}>Salvar e confirmar</Button>
          <Button type="button" variant="mini" disabled={disabled} onClick={() => setEditing(false)}>Cancelar</Button>
        </div>
      ) : (
        <div className="project-workflow-commercial-schedule-choice">
          <span>Essa data continua igual?</span>
          <ProjectWorkflowBooleanChoice
            value={data.confirmed ? true : null}
            label={`${label} continua igual?`}
            yesLabel="Sim, continua igual"
            noLabel="Não, mudou"
            disabled={disabled}
            onSelect={value => { if (value) confirm(); else setEditing(true); }}
          />
        </div>
      )}
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
      description={workflow.executedAtHeadquarters ? 'Projeto na Sede: confirme apenas a data do atendimento ao cliente.' : 'Confirme o atendimento e acompanhe as solicitações enviadas ao cliente.'}
      area="Administrativo"
      progress={progress}
      status={preparationStatusLabel(progress)}
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
      {workflow.clientReleases.scheduleConfirmation.mobilization.relevant ? <CommercialScheduleConfirmationItem workflow={workflow} field="MOBILIZATION" label="Mobilização estimada" data={workflow.clientReleases.scheduleConfirmation.mobilization} saving={saving} onPatch={onPatch} /> : null}
      {workflow.clientReleases.scheduleConfirmation.start.relevant ? <CommercialScheduleConfirmationItem workflow={workflow} field="START" label="Início estimado" data={workflow.clientReleases.scheduleConfirmation.start} saving={saving} onPatch={onPatch} /> : null}
      <div className="project-workflow-client-release-list">
        {workflow.clientReleases.items.map(item => <ClientReleaseItem workflow={workflow} item={item} saving={saving} onPatch={onPatch} key={item.key} />)}
      </div>
    </ProjectWorkflowCategory>
  );
}
