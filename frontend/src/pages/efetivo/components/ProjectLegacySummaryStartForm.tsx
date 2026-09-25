import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PROJECT_WORKFLOW_LEGACY_SUMMARY_STAGES } from '../../../../../shared/schemas/project-workflow.js';
import { updatePlanningMission, type MissionInput, type PlanningJobRole, type PlanningMission } from '../../../api/efetivoPlanning';
import {
  listProjectWorkflowLegacySummaryEquipment,
  type ProjectOperationalMissionSummary,
  type ProjectWorkflowLegacySummaryInput,
  type ProjectWorkflowLegacySummaryStage
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/ToastContext';
import { selectedMissionCollaboratorIds, synchronizeMissionAllocationPeriods, type MissionAllocationPeriodDraft } from '../../../utils/missionTeam';
import { WORKFLOW_STAGE_LABELS, type ProjectKanbanStage } from '../../../utils/projectWorkflow';
import { MissionTeamSelector } from './MissionTeamSelector';
import { resolveLegacySummaryTeamDates } from './legacySummaryTeamDates';

const LEGACY_SUMMARY_STAGES = PROJECT_WORKFLOW_LEGACY_SUMMARY_STAGES as readonly ProjectWorkflowLegacySummaryStage[];
const EXECUTION_INDEX = LEGACY_SUMMARY_STAGES.indexOf('EXECUTION');
export const LEGACY_SUMMARY_FORM_ID = 'project-workflow-legacy-summary-form';

type WorkflowUserOption = { id: string; name: string; email: string | null };

function dateOnly(value: string | null | undefined) {
  return value?.slice(0, 10) || '';
}

export function ProjectLegacySummaryStartForm({ projectId, mission, fullMission, roles, leaders, saving, onSubmit, onBusyChange }: {
  projectId: string;
  mission: ProjectOperationalMissionSummary;
  /** Missão oficial completa, para editar a equipe aqui mesmo; `null` enquanto ainda carrega no board. */
  fullMission: PlanningMission | null;
  roles: PlanningJobRole[];
  leaders: WorkflowUserOption[];
  saving: boolean;
  onSubmit: (payload: ProjectWorkflowLegacySummaryInput) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const equipment = useQuery({
    queryKey: ['project-workflow-legacy-summary-equipment', projectId],
    queryFn: () => listProjectWorkflowLegacySummaryEquipment(projectId)
  });
  const [stage, setStage] = useState<ProjectWorkflowLegacySummaryStage>('EXECUTION');
  const [leaderUserId, setLeaderUserId] = useState('');
  const [plannerUserId, setPlannerUserId] = useState('');
  const [startDate, setStartDate] = useState(dateOnly(mission.executionStartDate));
  const [endDate, setEndDate] = useState('');
  const [demobilizationDate, setDemobilizationDate] = useState(mission.returnDate?.slice(0, 10) || '');
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<Set<string> | null>(null);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement | null>(null);

  // Equipe editável aqui mesmo, sem sair da tela: reaproveita o mesmo seletor usado em "Editar equipe inicial".
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>(() => selectedMissionCollaboratorIds(fullMission));
  const [allocationPeriods, setAllocationPeriods] = useState<MissionAllocationPeriodDraft[]>([]);
  const [confirmedOverlapIds, setConfirmedOverlapIds] = useState<string[]>([]);
  const [confirmedInactiveIds, setConfirmedInactiveIds] = useState<string[]>([]);
  const hydratedMissionKey = useRef('');
  const teamDates = resolveLegacySummaryTeamDates(
    fullMission,
    mission,
    { startDate, endDate, demobilizationDate },
    new Date().toLocaleDateString('en-CA')
  );
  const teamPeriodStart = teamDates.mobilizationDate;
  const teamPeriodEnd = teamDates.teamEndDate;
  useEffect(() => {
    if (!fullMission) return;
    const missionKey = `${fullMission.id}:${fullMission.version}`;
    if (hydratedMissionKey.current === missionKey) return;
    hydratedMissionKey.current = missionKey;
    const ids = selectedMissionCollaboratorIds(fullMission);
    setCollaboratorIds(ids);
    setAllocationPeriods(synchronizeMissionAllocationPeriods(
      ids,
      fullMission.allocations.map(allocation => ({
        collaboratorId: allocation.collaboratorId,
        mobilizationDate: dateOnly(allocation.mobilizationDate) || teamPeriodStart,
        demobilizationDate: dateOnly(allocation.demobilizationDate) || teamPeriodEnd
      })),
      teamPeriodStart,
      teamPeriodEnd
    ));
  }, [fullMission, teamPeriodEnd, teamPeriodStart]);

  const updateTeam = useMutation({
    mutationFn: (payload: MissionInput) => updatePlanningMission(fullMission!.id, fullMission!.version, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['efetivo-planning-missions'] })
  });
  useEffect(() => {
    onBusyChange(updateTeam.isPending);
    return () => onBusyChange(false);
  }, [onBusyChange, updateTeam.isPending]);

  // Pré-marca tudo que o app encontrou nos romaneios assim que a busca termina; o usuário só desmarca o que
  // não deve entrar, ou marca qualquer outro equipamento do catálogo. `null` distingue "ainda carregando" de
  // "carregou e não achou nada".
  useEffect(() => {
    if (equipment.data && selectedEquipmentIds === null) {
      const activeIds = new Set(equipment.data.categories.flatMap(category => category.equipment.map(item => item.id)));
      const suggestedIds = equipment.data.currentEquipmentIds.filter(id => activeIds.has(id));
      setSelectedEquipmentIds(new Set(suggestedIds));
      const suggestedCategories = equipment.data.categories
        .filter(category => category.equipment.some(item => suggestedIds.includes(item.id)))
        .map(category => category.id);
      setExpandedCategoryIds(suggestedCategories.length ? suggestedCategories : equipment.data.categories.slice(0, 1).map(category => category.id));
    }
  }, [equipment.data, selectedEquipmentIds]);

  const categories = equipment.data?.categories || [];
  const stageIndex = LEGACY_SUMMARY_STAGES.indexOf(stage);
  const demobilizationRelevant = stageIndex > EXECUTION_INDEX;
  const disabled = saving || updateTeam.isPending;
  const selectedEquipmentCount = selectedEquipmentIds?.size || 0;

  function toggleEquipment(id: string) {
    setSelectedEquipmentIds(previous => {
      const next = new Set(previous || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCategory(id: string) {
    setExpandedCategoryIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  }

  function showError(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'nearest' }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setError('');
    if (!leaderUserId || !plannerUserId) { showError('Selecione o Líder de Projetos e o Gestor de Contrato.'); return; }
    if (!startDate) { showError('Informe a data de início da obra.'); return; }
    if (demobilizationRelevant && !demobilizationDate) { showError('Informe a data de desmobilização.'); return; }
    if (!collaboratorIds.length) { showError('Selecione ao menos um colaborador para a equipe em campo.'); return; }
    if (!equipment.data) { showError('Aguarde a lista de equipamentos ou tente carregá-la novamente.'); return; }
    const equipmentSelections = categories
      .map(category => ({
        categoryId: category.id,
        equipmentIds: category.equipment.map(item => item.id).filter(id => selectedEquipmentIds?.has(id))
      }))
      .filter(group => group.equipmentIds.length > 0);
    if (fullMission) {
      const teamChanged = JSON.stringify([...collaboratorIds].sort()) !== JSON.stringify([...selectedMissionCollaboratorIds(fullMission)].sort());
      if (teamChanged) {
        try {
          await updateTeam.mutateAsync({
            projectId: fullMission.projectId,
            scheduleStatus: 'CONFIRMED',
            headquartersResponsibleUserId: fullMission.headquartersResponsibleUserId,
            mobilizationDate: teamDates.mobilizationDate,
            executionStartDate: teamDates.executionStartDate,
            executionEndDate: teamDates.executionEndDate,
            returnDate: teamDates.returnDate,
            collaboratorIds,
            allocationPeriods: synchronizeMissionAllocationPeriods(collaboratorIds, allocationPeriods, teamPeriodStart, teamPeriodEnd)
              .map(period => ({
                collaboratorId: period.collaboratorId,
                mobilizationDate: dateOnly(period.mobilizationDate) || teamPeriodStart,
                demobilizationDate: dateOnly(period.demobilizationDate) || teamPeriodEnd
              })),
            confirmedMissionOverlapCollaboratorIds: confirmedOverlapIds,
            confirmedInactiveCollaboratorIds: confirmedInactiveIds
          });
        } catch (mutationError) {
          toast((mutationError as Error).message, 'error');
          return;
        }
      }
    }
    onSubmit({
      stage,
      leaderUserId,
      plannerUserId,
      startDate,
      endDate: endDate || null,
      demobilizationDate: demobilizationDate || null,
      equipmentSelections
    });
  }

  return (
    <form id={LEGACY_SUMMARY_FORM_ID} className="project-workflow-form project-workflow-legacy-summary-form" noValidate onSubmit={event => { void submit(event); }}>
      <p>A gestão nasce direto na etapa escolhida; Handover, Análise inicial, Planejamento e Preparação ficam marcados como "não se aplica" para este projeto.</p>
      {error ? <p ref={errorRef} className="inline-error" role="alert">{error}</p> : null}
      <div className="project-workflow-form-grid">
        <div className="field-group">
          <label htmlFor="legacy-summary-stage">Etapa atual da obra *</label>
          <select id="legacy-summary-stage" disabled={disabled} value={stage} onChange={event => setStage(event.target.value as ProjectWorkflowLegacySummaryStage)}>
            {LEGACY_SUMMARY_STAGES.map(item => <option value={item} key={item}>{WORKFLOW_STAGE_LABELS[item as ProjectKanbanStage]}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="legacy-summary-leader">Líder de Projetos *</label>
          <select id="legacy-summary-leader" disabled={disabled} value={leaderUserId} onChange={event => setLeaderUserId(event.target.value)}>
            <option value="">Selecione</option>
            {leaders.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="legacy-summary-planner">Gestor de Contrato *</label>
          <select id="legacy-summary-planner" disabled={disabled} value={plannerUserId} onChange={event => setPlannerUserId(event.target.value)}>
            <option value="">Selecione</option>
            {leaders.map(item => <option value={item.id} key={item.id}>{item.name}{item.email ? ` · ${item.email}` : ' · sem e-mail cadastrado'}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="legacy-summary-start-date">Data de início da obra *</label>
          <input id="legacy-summary-start-date" type="date" disabled={disabled} value={startDate} onChange={event => setStartDate(event.target.value)} />
        </div>
        <div className="field-group">
          <label htmlFor="legacy-summary-end-date">Data de término</label>
          <input id="legacy-summary-end-date" type="date" disabled={disabled} value={endDate} onChange={event => setEndDate(event.target.value)} />
          <span className="field-hint">Opcional; preencha apenas se a obra já foi concluída.</span>
        </div>
        {demobilizationRelevant ? <div className="field-group">
          <label htmlFor="legacy-summary-demobilization-date">Data de desmobilização *</label>
          <input id="legacy-summary-demobilization-date" type="date" disabled={disabled} value={demobilizationDate} onChange={event => setDemobilizationDate(event.target.value)} />
        </div> : null}
      </div>

      <div className="project-workflow-legacy-summary-team">
        <strong>Equipe em campo</strong>
        {fullMission ? (
          <MissionTeamSelector
            mission={fullMission}
            planId={fullMission.planId}
            roles={roles}
            selectedIds={collaboratorIds}
            allocationPeriods={allocationPeriods}
            startDate={teamPeriodStart}
            endDate={teamPeriodEnd}
            loading={false}
            disabled={disabled}
            onChange={(ids, overlapIds, inactiveIds) => {
              setCollaboratorIds(ids);
              setAllocationPeriods(current => synchronizeMissionAllocationPeriods(ids, current, teamPeriodStart, teamPeriodEnd));
              setConfirmedOverlapIds(overlapIds);
              setConfirmedInactiveIds(inactiveIds);
            }}
            onAllocationPeriodsChange={setAllocationPeriods}
          />
        ) : <p className="field-hint">Carregando a equipe da programação oficial…</p>}
      </div>

      <div className="project-workflow-legacy-summary-equipment">
        <strong>Equipamentos</strong>
        <p className="field-hint">{selectedEquipmentCount} selecionado(s). Confira os equipamentos encontrados nos romaneios e ajuste a lista por categoria.</p>
        {equipment.isLoading ? <p className="field-hint">Procurando equipamentos nos romaneios deste projeto…</p> : null}
        {equipment.isError ? <p className="project-workflow-category-note is-warning">Não foi possível buscar o catálogo de equipamentos. <Button type="button" variant="secondary" onClick={() => void equipment.refetch()}>Tentar novamente</Button></p> : null}
        {!equipment.isLoading && !equipment.isError && !categories.length ? <p className="field-hint">Nenhuma categoria de equipamento ativa cadastrada.</p> : null}
        {categories.length ? <div className="project-workflow-equipment-categories" aria-label="Categorias e equipamentos">
          {categories.map(category => (
            <section className={`project-workflow-equipment-category${expandedCategoryIds.includes(category.id) ? ' is-expanded' : ''}`} key={category.id}>
              <button type="button" className="project-workflow-equipment-category-toggle" aria-expanded={expandedCategoryIds.includes(category.id)} onClick={() => toggleCategory(category.id)}>
                <span><strong>{category.name}</strong><small>{category.equipment.filter(item => selectedEquipmentIds?.has(item.id)).length} de {category.equipment.length} selecionado(s)</small></span>
                <span className="project-workflow-equipment-category-chevron" aria-hidden="true">⌄</span>
              </button>
              {expandedCategoryIds.includes(category.id) ? <div className="project-workflow-equipment-options">
                {category.equipment.length ? category.equipment.map(item => (
                  <label key={item.id} className={`project-workflow-equipment-option${selectedEquipmentIds?.has(item.id) ? ' is-selected' : ''}`}>
                    <input type="checkbox" disabled={disabled} checked={Boolean(selectedEquipmentIds?.has(item.id))} onChange={() => toggleEquipment(item.id)} />
                    <span><strong>{item.code} · {item.name}</strong></span>
                  </label>
                )) : <p>Nenhum equipamento ativo nesta categoria.</p>}
              </div> : null}
            </section>
          ))}
        </div> : null}
      </div>

    </form>
  );
}
