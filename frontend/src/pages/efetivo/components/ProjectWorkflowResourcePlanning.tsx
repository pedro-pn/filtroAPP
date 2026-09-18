import { useEffect, useMemo, useState } from 'react';

import type {
  ProjectWorkflow,
  ProjectWorkflowEquipmentPlanningItem,
  ProjectWorkflowPatch
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { ProjectWorkflowBooleanChoice } from './ProjectWorkflowBooleanChoice';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';

type PatchHandler = (payload: ProjectWorkflowPatch) => void;
type TeamDraft = Array<{ jobRoleId: string; requiredCount: number }>;
type EquipmentSelection = { categoryId: string; equipmentIds: string[]; exceptionReasons: Record<string, string> };

function choiceStatus(defined: boolean | null, completeLabel: string, pendingLabel: string) {
  if (defined === true) return completeLabel;
  if (defined === false) return pendingLabel;
  return 'Pendente';
}

function availabilityLabel(item: ProjectWorkflowEquipmentPlanningItem) {
  if (item.availabilityStatus === 'AVAILABLE') return 'Disponível';
  if (item.availabilityStatus === 'EXPECTED_RETURN') return 'Retorno previsto antes da mobilização';
  if (item.availabilityStatus === 'RESERVED') return 'Reservado para outra obra no período';
  return 'Indisponível na data';
}

function calibrationLabel(item: ProjectWorkflowEquipmentPlanningItem) {
  if (item.calibration.status === 'NOT_REQUIRED') return 'Não requer calibração';
  if (item.calibration.status === 'VALID') return `Calibração válida até ${displayDateOnly(item.calibration.expiresAt!)}`;
  if (item.calibration.status === 'EXPIRED') return `Calibração vencida em ${displayDateOnly(item.calibration.expiresAt!)}`;
  return 'Calibração sem validade cadastrada';
}

function maintenanceLabel(item: ProjectWorkflowEquipmentPlanningItem) {
  if (item.maintenance.status === 'NOT_REQUIRED') return null;
  if (item.maintenance.status === 'UPCOMING') return `Manutenção em dia${item.maintenance.nextMaintenanceDate ? ` até ${displayDateOnly(item.maintenance.nextMaintenanceDate)}` : ''}`;
  if (item.maintenance.status === 'DUE_TODAY') return 'Manutenção prevista para a mobilização';
  if (item.maintenance.status === 'OVERDUE') return `Manutenção vencida${item.maintenance.nextMaintenanceDate ? ` em ${displayDateOnly(item.maintenance.nextMaintenanceDate)}` : ''}`;
  if (item.maintenance.status === 'NO_HISTORY') return 'Sem manutenção aprovada no histórico';
  return 'Periodicidade de manutenção não configurada';
}

export function ProjectWorkflowTeamPlanningCard({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: PatchHandler;
}) {
  const planning = workflow.resourcePlanning.team;
  const persistedDraft = useMemo(() => planning.demands.map(item => ({ jobRoleId: item.jobRoleId, requiredCount: item.requiredCount })), [planning.demands]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TeamDraft>(persistedDraft);
  const [jobRoleId, setJobRoleId] = useState('');
  const [requiredCount, setRequiredCount] = useState(1);
  useEffect(() => {
    setDraft(persistedDraft);
  }, [persistedDraft]);
  const roleById = useMemo(() => new Map(planning.catalog.map(role => [role.id, role])), [planning.catalog]);
  const availableRoles = planning.catalog.filter(role => !draft.some(item => item.jobRoleId === role.id));
  const draftSummary = draft.map(item => {
    const role = roleById.get(item.jobRoleId);
    const availableCount = role?.availableCount || 0;
    return { ...item, role, availableCount, hiringNeed: Math.max(0, item.requiredCount - availableCount) };
  });
  const addRole = () => {
    if (!jobRoleId || requiredCount < 1) return;
    setDraft(current => [...current, { jobRoleId, requiredCount }]);
    setJobRoleId('');
    setRequiredCount(1);
  };
  const selectNo = () => {
    setEditing(false);
    setDraft([]);
    if (planning.defined !== false || planning.demands.length) {
      onPatch({ action: 'team_plan', version: workflow.version, defined: false, demands: [] });
    }
  };
  const confirm = () => {
    if (!draft.length) return;
    setEditing(false);
    onPatch({ action: 'team_plan', version: workflow.version, defined: true, demands: draft });
  };
  return (
    <ProjectWorkflowCategory
      title="Equipe"
      description="Defina os cargos e a quantidade necessária para a obra."
      area="Operações"
      icon="users"
      status={choiceStatus(planning.defined, `${planning.demands.length} cargo(s)`, 'Equipe não definida')}
      complete={planning.defined === true && planning.demands.length > 0}
      className="project-workflow-resource-card"
      data-project-workflow-team-plan
    >
      <div className="project-workflow-resource-question">
        <div><strong>A equipe necessária para esta obra já foi definida?</strong><p>“Não” mantém esta frente pendente.</p></div>
        <ProjectWorkflowBooleanChoice value={editing ? true : planning.defined} label="Equipe necessária definida?" disabled={saving || !workflow.permissions.canEditTeamPlanning} onSelect={value => value ? setEditing(true) : selectNo()} />
      </div>
      {editing ? <div className="project-workflow-resource-editor">
        <div className="project-workflow-resource-add">
          <div className="field-group"><label htmlFor="workflow-team-role">Cargo</label><select id="workflow-team-role" value={jobRoleId} disabled={saving} onChange={event => setJobRoleId(event.target.value)}><option value="">Selecione um cargo</option>{availableRoles.map(role => <option value={role.id} key={role.id}>{role.name} · {role.availableCount} disponível(is)</option>)}</select></div>
          <div className="field-group"><label htmlFor="workflow-team-quantity">Quantidade</label><input id="workflow-team-quantity" type="number" min="1" max="1000" step="1" inputMode="numeric" value={requiredCount} disabled={saving} onChange={event => setRequiredCount(Math.max(1, Number(event.target.value) || 1))} /></div>
          <Button type="button" variant="secondary" disabled={saving || !jobRoleId} onClick={addRole}>Adicionar</Button>
        </div>
        {draftSummary.length ? <div className="project-workflow-resource-summary">{draftSummary.map(item => <article key={item.jobRoleId}><span className="project-workflow-resource-color" style={{ background: item.role?.calendarColor || '#64748B' }} /><div><strong>{item.role?.name || 'Cargo indisponível'}</strong><span>{item.requiredCount} necessário(s) · {item.availableCount} disponível(is) na mobilização</span>{item.hiringNeed > 0 ? <em>⚠ Necessidade de contratação: {item.hiringNeed}</em> : null}</div><div className="field-group project-workflow-resource-quantity"><label htmlFor={`workflow-team-quantity-${item.jobRoleId}`}>Quantidade</label><input id={`workflow-team-quantity-${item.jobRoleId}`} type="number" min="1" max="1000" step="1" inputMode="numeric" value={item.requiredCount} disabled={saving} onChange={event => setDraft(current => current.map(demand => demand.jobRoleId === item.jobRoleId ? { ...demand, requiredCount: Math.max(1, Number(event.target.value) || 1) } : demand))} /></div><Button type="button" variant="mini" disabled={saving} onClick={() => setDraft(current => current.filter(demand => demand.jobRoleId !== item.jobRoleId))}>Remover</Button></article>)}</div> : <p className="project-workflow-resource-empty">Adicione ao menos um cargo para confirmar a equipe.</p>}
        <div className="project-workflow-inline-actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditing(false); setDraft(persistedDraft); }}>Cancelar</Button><Button type="button" disabled={saving || !draft.length} onClick={confirm}>Confirmar equipe</Button></div>
      </div> : null}
      {!editing && planning.demands.length ? <div className="project-workflow-resource-summary" aria-label="Resumo dos cargos planejados">{planning.demands.map(item => <article key={item.jobRoleId}><span className="project-workflow-resource-color" style={{ background: item.calendarColor }} /><div><strong>{item.jobRoleName}</strong><span>{item.requiredCount} necessário(s) · {item.availableCount} disponível(is) na mobilização</span>{item.hiringNeed > 0 ? <em>⚠ Necessidade de contratação: {item.hiringNeed}</em> : null}</div></article>)}</div> : null}
    </ProjectWorkflowCategory>
  );
}

export function ProjectWorkflowEquipmentPlanningCard({ workflow, saving, onPatch }: {
  workflow: ProjectWorkflow;
  saving: boolean;
  onPatch: PatchHandler;
}) {
  const planning = workflow.resourcePlanning.equipment;
  const persistedSelections = useMemo<EquipmentSelection[]>(() => planning.selections.map(selection => ({
    categoryId: selection.categoryId,
    equipmentIds: [...selection.equipmentIds],
    exceptionReasons: { ...selection.exceptionReasons }
  })), [planning.selections]);
  const [editing, setEditing] = useState(false);
  const [selections, setSelections] = useState<EquipmentSelection[]>(persistedSelections);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<string[]>([]);
  useEffect(() => setSelections(persistedSelections), [persistedSelections]);
  const selectedEquipmentIds = new Set(selections.flatMap(selection => selection.equipmentIds));
  const completeSelection = selectedEquipmentIds.size > 0;
  const toggleCategory = (categoryId: string) => {
    setExpandedCategoryIds(current => current.includes(categoryId)
      ? current.filter(id => id !== categoryId)
      : [...current, categoryId]);
  };
  const toggleEquipment = (categoryId: string, equipmentId: string, selected: boolean) => {
    setSelections(current => {
      const categorySelection = current.find(selection => selection.categoryId === categoryId);
      if (selected) {
        if (categorySelection) return current.map(selection => selection.categoryId === categoryId ? { ...selection, equipmentIds: [...selection.equipmentIds, equipmentId] } : selection);
        return [...current, { categoryId, equipmentIds: [equipmentId], exceptionReasons: {} }];
      }
      if (!categorySelection) return current;
      const equipmentIds = categorySelection.equipmentIds.filter(id => id !== equipmentId);
      return equipmentIds.length
        ? current.map(selection => selection.categoryId === categoryId ? { ...selection, equipmentIds, exceptionReasons: Object.fromEntries(Object.entries(selection.exceptionReasons).filter(([id]) => id !== equipmentId)) } : selection)
        : current.filter(selection => selection.categoryId !== categoryId);
    });
  };
  const updateExceptionReason = (categoryId: string, equipmentId: string, reason: string) => {
    setSelections(current => current.map(selection => selection.categoryId === categoryId
      ? { ...selection, exceptionReasons: { ...selection.exceptionReasons, [equipmentId]: reason } }
      : selection));
  };
  const selectNo = () => {
    setEditing(false);
    setSelections([]);
    setExpandedCategoryIds([]);
    if (planning.defined !== false || planning.categoryIds.length) {
      onPatch({ action: 'equipment_plan', version: workflow.version, defined: false, selections: [] });
    }
  };
  const confirm = () => {
    if (!completeSelection) return;
    setEditing(false);
    onPatch({
      action: 'equipment_plan',
      version: workflow.version,
      defined: true,
      selections: selections.map(selection => ({
        categoryId: selection.categoryId,
        equipmentIds: selection.equipmentIds,
        exceptions: Object.entries(selection.exceptionReasons)
          .filter(([equipmentId, reason]) => selection.equipmentIds.includes(equipmentId) && reason.trim().length >= 3)
          .map(([equipmentId, reason]) => ({ equipmentId, reason: reason.trim() }))
      }))
    });
  };
  return (
    <ProjectWorkflowCategory
      title="Equipamentos"
      description={`Consulte disponibilidade, calibração e manutenção para ${workflow.resourcePlanning.targetDate ? displayDateOnly(workflow.resourcePlanning.targetDate) : 'a mobilização prevista'}.`}
      area="Ativos"
      status={choiceStatus(planning.defined, `${planning.equipmentIds.length} equipamento(s)`, 'Equipamentos não definidos')}
      complete={planning.defined === true && planning.equipmentIds.length > 0}
      className="project-workflow-resource-card"
      data-project-workflow-equipment-plan
    >
      <div className="project-workflow-resource-question">
        <div><strong>Os equipamentos necessários para esta obra já foram definidos?</strong><p>“Não” mantém esta frente pendente.</p></div>
        <ProjectWorkflowBooleanChoice value={editing ? true : planning.defined} label="Equipamentos necessários definidos?" disabled={saving || !workflow.permissions.canEditEquipmentPlanning} onSelect={value => value ? setEditing(true) : selectNo()} />
      </div>
      {editing ? <div className="project-workflow-resource-editor">
        <fieldset className="project-workflow-equipment-categories"><legend>Categorias e equipamentos necessários</legend>{planning.catalog.map(category => {
          const categoryExpanded = expandedCategoryIds.includes(category.id);
          const categorySelection = selections.find(selection => selection.categoryId === category.id);
          return <section className={`project-workflow-equipment-category${categoryExpanded ? ' is-expanded' : ''}`} key={category.id}>
            <button type="button" className="project-workflow-equipment-category-toggle" aria-expanded={categoryExpanded} disabled={saving} onClick={() => toggleCategory(category.id)}>
              <span><strong>{category.name}</strong><small>{category.availableCount}/{category.totalCount} disponível(is) na data · {categorySelection?.equipmentIds.length || 0} selecionado(s)</small></span>
              <span className="project-workflow-equipment-category-chevron" aria-hidden="true">⌄</span>
            </button>
            {categoryExpanded ? <div className="project-workflow-equipment-options">{category.equipment.length ? category.equipment.map(item => {
              const selected = selectedEquipmentIds.has(item.id);
              const ready = item.availableAtMobilization && item.calibration.valid && item.maintenance.valid;
              const exceptionReason = categorySelection?.exceptionReasons[item.id] || item.reservationExceptionReason || '';
              return <article className={`project-workflow-equipment-option${selected ? ' is-selected' : ''}${ready ? ' is-ready' : ' has-warning'}`} key={item.id}>
                <label>
                  <input type="checkbox" checked={selected} disabled={saving} onChange={event => toggleEquipment(category.id, item.id, event.target.checked)} />
                  <span><strong>{item.code} · {item.name}</strong><small>{availabilityLabel(item)}</small><small className={item.calibration.valid ? 'is-ready' : 'has-warning'}>{calibrationLabel(item)}</small>{item.maintenance.required ? <small className={item.maintenance.valid ? 'is-ready' : 'has-warning'}>{maintenanceLabel(item)}</small> : null}{item.reservationConflicts.length ? <small className="has-warning">Conflito: {item.reservationConflicts.map(conflict => `${conflict.projectCode} (${displayDateOnly(conflict.startsOn)} a ${displayDateOnly(conflict.endsOn)})`).join(', ')}</small> : null}</span>
                </label>
                {selected && !item.availableAtMobilization ? <div className="field-group project-workflow-reservation-exception"><label htmlFor={`workflow-equipment-exception-${item.id}`}>Justificativa para manter a reserva</label><textarea id={`workflow-equipment-exception-${item.id}`} rows={2} maxLength={1000} value={exceptionReason} disabled={saving} placeholder="Registre o motivo da exceção, se aplicável." onChange={event => updateExceptionReason(category.id, item.id, event.target.value)} /></div> : null}
              </article>;
            }) : <p>Nenhum equipamento ativo cadastrado nesta categoria.</p>}</div> : null}
          </section>;
        })}</fieldset>
        {!planning.catalog.length ? <p className="project-workflow-resource-empty">Nenhuma categoria ativa foi encontrada no cadastro de equipamentos.</p> : null}
        {!completeSelection ? <p className="project-workflow-resource-warning">Selecione ao menos um equipamento para confirmar o planejamento.</p> : null}
        <div className="project-workflow-inline-actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditing(false); setSelections(persistedSelections); setExpandedCategoryIds([]); }}>Cancelar</Button><Button type="button" disabled={saving || !completeSelection} onClick={confirm}>Confirmar equipamentos</Button></div>
      </div> : null}
      {!editing && planning.categories.length ? <EquipmentCategorySummary categories={planning.categories} /> : null}
    </ProjectWorkflowCategory>
  );
}

function EquipmentCategorySummary({ categories }: { categories: ProjectWorkflow['resourcePlanning']['equipment']['categories'] }) {
  if (!categories.length) return null;
  return <div className="project-workflow-equipment-summary">{categories.map(category => <details key={category.id}><summary><strong>{category.name}</strong><span>{category.equipment.length} equipamento(s) selecionado(s)</span><span aria-hidden="true">⌄</span></summary>{category.equipment.length ? <div>{category.equipment.map(item => <article className={item.availableAtMobilization && item.calibration.valid && item.maintenance.valid ? 'is-ready' : 'has-warning'} key={item.id}><div><strong>{item.code} · {item.name}</strong><span>{availabilityLabel(item)}</span></div><ul><li className={item.calibration.valid ? 'is-ready' : 'has-warning'}>{calibrationLabel(item)}</li>{item.maintenance.required ? <li className={item.maintenance.valid ? 'is-ready' : 'has-warning'}>{maintenanceLabel(item)}</li> : null}</ul>{item.assignments.length ? <small>Em uso em outra obra{item.assignments.some(assignment => assignment.expectedReturnDate) ? ` · retorno(s): ${item.assignments.filter(assignment => assignment.expectedReturnDate).map(assignment => displayDateOnly(assignment.expectedReturnDate!)).join(', ')}` : ''}</small> : null}{item.reservationConflicts.length ? <small>Reserva conflitante: {item.reservationConflicts.map(conflict => conflict.projectCode).join(', ')}</small> : null}{item.reservationExceptionReason ? <small>Exceção registrada: {item.reservationExceptionReason}</small> : null}</article>)}</div> : <p>Nenhum equipamento selecionado.</p>}</details>)}</div>;
}
