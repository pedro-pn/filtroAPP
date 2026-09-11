import { useEffect, useMemo, useState } from 'react';

import type {
  ProjectWorkflow,
  ProjectWorkflowEquipmentPlanningItem,
  ProjectWorkflowPatch
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { ProjectWorkflowCategory } from './ProjectWorkflowCategory';

type PatchHandler = (payload: ProjectWorkflowPatch) => void;
type TeamDraft = Array<{ jobRoleId: string; requiredCount: number }>;

function choiceStatus(defined: boolean | null, completeLabel: string, pendingLabel: string) {
  if (defined === true) return completeLabel;
  if (defined === false) return pendingLabel;
  return 'Pendente · selecione Sim ou Não';
}

function availabilityLabel(item: ProjectWorkflowEquipmentPlanningItem) {
  if (item.availabilityStatus === 'AVAILABLE') return 'Disponível';
  if (item.availabilityStatus === 'EXPECTED_RETURN') return 'Retorno previsto antes da mobilização';
  return 'Indisponível na data';
}

function calibrationLabel(item: ProjectWorkflowEquipmentPlanningItem) {
  if (item.calibration.status === 'NOT_REQUIRED') return 'Não requer calibração';
  if (item.calibration.status === 'VALID') return `Calibração válida até ${displayDateOnly(item.calibration.expiresAt!)}`;
  if (item.calibration.status === 'EXPIRED') return `Calibração vencida em ${displayDateOnly(item.calibration.expiresAt!)}`;
  return 'Calibração sem validade cadastrada';
}

function maintenanceLabel(item: ProjectWorkflowEquipmentPlanningItem) {
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
      status={choiceStatus(planning.defined, `${planning.demands.length} cargo(s) planejado(s)`, 'Pendente · equipe ainda não definida')}
      complete={planning.defined === true && planning.demands.length > 0}
      className="project-workflow-resource-card"
      data-project-workflow-team-plan
    >
      <div className="project-workflow-resource-question">
        <div><strong>A equipe necessária para esta obra já foi definida?</strong><p>“Não” mantém esta frente pendente.</p></div>
        <div className="project-workflow-documentation-choice">
          <Button type="button" variant={planning.defined === true ? 'primary' : 'secondary'} disabled={saving || !workflow.permissions.canEdit} onClick={() => setEditing(true)}>Sim</Button>
          <Button type="button" variant={planning.defined === false ? 'primary' : 'secondary'} disabled={saving || !workflow.permissions.canEdit} onClick={selectNo}>Não</Button>
        </div>
      </div>
      {editing ? <div className="project-workflow-resource-editor">
        <div className="project-workflow-resource-add">
          <div className="field-group"><label htmlFor="workflow-team-role">Cargo</label><select id="workflow-team-role" value={jobRoleId} disabled={saving} onChange={event => setJobRoleId(event.target.value)}><option value="">Selecione um cargo</option>{availableRoles.map(role => <option value={role.id} key={role.id}>{role.name} · {role.availableCount} disponível(is)</option>)}</select></div>
          <div className="field-group"><label htmlFor="workflow-team-quantity">Quantidade</label><input id="workflow-team-quantity" type="number" min="1" max="1000" value={requiredCount} disabled={saving} onChange={event => setRequiredCount(Math.max(1, Number(event.target.value) || 1))} /></div>
          <Button type="button" variant="secondary" disabled={saving || !jobRoleId} onClick={addRole}>Adicionar</Button>
        </div>
        {draftSummary.length ? <div className="project-workflow-resource-summary">{draftSummary.map(item => <article key={item.jobRoleId}><span className="project-workflow-resource-color" style={{ background: item.role?.calendarColor || '#64748B' }} /><div><strong>{item.role?.name || 'Cargo indisponível'}</strong><span>{item.requiredCount} necessário(s) · {item.availableCount} disponível(is) na mobilização</span>{item.hiringNeed > 0 ? <em>⚠ Necessidade de contratação: {item.hiringNeed}</em> : null}</div><input aria-label={`Quantidade de ${item.role?.name || 'cargo'}`} type="number" min="1" max="1000" value={item.requiredCount} disabled={saving} onChange={event => setDraft(current => current.map(demand => demand.jobRoleId === item.jobRoleId ? { ...demand, requiredCount: Math.max(1, Number(event.target.value) || 1) } : demand))} /><Button type="button" variant="mini" disabled={saving} onClick={() => setDraft(current => current.filter(demand => demand.jobRoleId !== item.jobRoleId))}>Remover</Button></article>)}</div> : <p className="project-workflow-resource-empty">Adicione ao menos um cargo para confirmar a equipe.</p>}
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
  const [editing, setEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(planning.categoryIds);
  useEffect(() => setSelectedIds(planning.categoryIds), [planning.categoryIds]);
  const selectedCategories = planning.catalog.filter(category => selectedIds.includes(category.id));
  const selectNo = () => {
    setEditing(false);
    setSelectedIds([]);
    if (planning.defined !== false || planning.categoryIds.length) {
      onPatch({ action: 'equipment_plan', version: workflow.version, defined: false, categoryIds: [] });
    }
  };
  const confirm = () => {
    if (!selectedIds.length) return;
    setEditing(false);
    onPatch({ action: 'equipment_plan', version: workflow.version, defined: true, categoryIds: selectedIds });
  };
  return (
    <ProjectWorkflowCategory
      title="Equipamentos"
      description={`Consulte disponibilidade, calibração e manutenção para ${workflow.resourcePlanning.targetDate ? displayDateOnly(workflow.resourcePlanning.targetDate) : 'a mobilização prevista'}.`}
      status={choiceStatus(planning.defined, `${planning.categoryIds.length} categoria(s) planejada(s)`, 'Pendente · equipamentos ainda não definidos')}
      complete={planning.defined === true && planning.categoryIds.length > 0}
      className="project-workflow-resource-card"
      data-project-workflow-equipment-plan
    >
      <div className="project-workflow-resource-question">
        <div><strong>Os equipamentos necessários para esta obra já foram definidos?</strong><p>“Não” mantém esta frente pendente.</p></div>
        <div className="project-workflow-documentation-choice">
          <Button type="button" variant={planning.defined === true ? 'primary' : 'secondary'} disabled={saving || !workflow.permissions.canEdit} onClick={() => setEditing(true)}>Sim</Button>
          <Button type="button" variant={planning.defined === false ? 'primary' : 'secondary'} disabled={saving || !workflow.permissions.canEdit} onClick={selectNo}>Não</Button>
        </div>
      </div>
      {editing ? <div className="project-workflow-resource-editor">
        <fieldset className="project-workflow-equipment-categories"><legend>Categorias necessárias</legend>{planning.catalog.map(category => <label key={category.id}><input type="checkbox" checked={selectedIds.includes(category.id)} disabled={saving} onChange={event => setSelectedIds(current => event.target.checked ? [...current, category.id] : current.filter(id => id !== category.id))} /><span><strong>{category.name}</strong><small>{category.availableCount}/{category.totalCount} disponível(is) na data</small></span></label>)}</fieldset>
        {!planning.catalog.length ? <p className="project-workflow-resource-empty">Nenhuma categoria ativa foi encontrada no cadastro de equipamentos.</p> : null}
        <EquipmentCategorySummary categories={selectedCategories} />
        <div className="project-workflow-inline-actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditing(false); setSelectedIds(planning.categoryIds); }}>Cancelar</Button><Button type="button" disabled={saving || !selectedIds.length} onClick={confirm}>Confirmar equipamentos</Button></div>
      </div> : null}
      {!editing && planning.categories.length ? <EquipmentCategorySummary categories={planning.categories} /> : null}
    </ProjectWorkflowCategory>
  );
}

function EquipmentCategorySummary({ categories }: { categories: ProjectWorkflow['resourcePlanning']['equipment']['categories'] }) {
  if (!categories.length) return null;
  return <div className="project-workflow-equipment-summary">{categories.map(category => <section key={category.id}><header><strong>{category.name}</strong><span>{category.availableCount}/{category.totalCount} disponível(is)</span></header>{category.equipment.length ? <div>{category.equipment.map(item => <article className={item.availableAtMobilization && item.calibration.valid && item.maintenance.valid ? 'is-ready' : 'has-warning'} key={item.id}><div><strong>{item.code} · {item.name}</strong><span>{availabilityLabel(item)}</span></div><ul><li className={item.calibration.valid ? 'is-ready' : 'has-warning'}>{calibrationLabel(item)}</li><li className={item.maintenance.valid ? 'is-ready' : 'has-warning'}>{maintenanceLabel(item)}</li></ul>{item.assignments.length ? <small>Em uso em outra obra{item.assignments.some(assignment => assignment.expectedReturnDate) ? ` · retorno(s): ${item.assignments.filter(assignment => assignment.expectedReturnDate).map(assignment => displayDateOnly(assignment.expectedReturnDate!)).join(', ')}` : ''}</small> : null}</article>)}</div> : <p>Nenhum equipamento ativo cadastrado nesta categoria.</p>}</section>)}</div>;
}
