import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  listPlanningAbsences,
  listPlanningCollaborators,
  listPlanningMissions,
  type PlanningJobRole,
  type PlanningMission
} from '../../../api/efetivoPlanning';
import { Alert, Badge, Button, Card, EmptyState, Field, SearchInput, Select, Skeleton } from '../../../components/ui/ds';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { AVAILABILITY_STATUSES, buildMissionAvailabilityColumns, type AvailabilityStatus } from '../../../utils/collaboratorAvailability';
import { allocationOverlapsPeriod } from '../../../utils/missionAllocationPeriod';
import { filterCollaboratorsByActivity, filterMissionTeamCollaborators, plannedRoleCoverage, plannedRoleIdSet, toggleMissionCollaborator, type CollaboratorActivityFilter, type PlannedTeamRole } from '../../../utils/missionTeam';
import { MissionPeriodFields, type MissionPeriodDraft } from './MissionPeriodFields';
import '../EfetivoTeam.ds.css';

const COLUMN_META: Record<AvailabilityStatus, { label: string; description: string }> = {
  AVAILABLE: { label: 'Disponíveis', description: 'Livres durante todo o período' },
  AWAITING_MOBILIZATION: { label: 'Aguardando mobilização', description: 'Já previstos em outra missão' },
  MOBILIZED: { label: 'Mobilizados', description: 'Alocados em missão no período' },
  ON_VACATION: { label: 'De férias', description: 'Férias sobrepostas às datas' }
};

type AllocationPeriodDraft = {
  collaboratorId: string;
  mobilizationDate: string;
  demobilizationDate: string;
};

function initials(name: string) {
  return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toLocaleUpperCase('pt-BR');
}

function selectedAllocationCollaborator(mission: PlanningMission | null, collaboratorId: string) {
  return mission?.allocations.find(allocation => allocation.collaboratorId === collaboratorId)?.collaborator || null;
}

export function MissionTeamSelector({ mission, planId, roles, plannedRoles, selectedIds, allocationPeriods, startDate, endDate, loading, disabled, allowIndividualPeriods = true, error, autoOpen = false, minSelected = 0, onChange, onAllocationPeriodsChange, onCancel }: {
  mission: PlanningMission | null;
  planId?: string;
  roles: PlanningJobRole[];
  plannedRoles?: PlannedTeamRole[];
  selectedIds: string[];
  allocationPeriods: AllocationPeriodDraft[];
  startDate: string;
  endDate: string;
  loading: boolean;
  disabled: boolean;
  allowIndividualPeriods?: boolean;
  error?: string;
  autoOpen?: boolean;
  minSelected?: number;
  onChange: (value: string[], confirmedMissionOverlapCollaboratorIds: string[], confirmedInactiveCollaboratorIds: string[]) => void;
  onAllocationPeriodsChange: (value: AllocationPeriodDraft[]) => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const closeDialog = () => { setOpen(false); onCancel?.(); };
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activityFilter, setActivityFilter] = useState<CollaboratorActivityFilter>('ACTIVE');
  const [inactiveConfirmationIds, setInactiveConfirmationIds] = useState<string[]>([]);
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const [overlapConfirmationIds, setOverlapConfirmationIds] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const validPeriod = Boolean(/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && startDate <= endDate);
  const collaborators = useQuery({
    queryKey: ['efetivo-mission-team-collaborators', startDate, 'include-inactive'],
    queryFn: () => listPlanningCollaborators({ date: startDate, includeInactive: true }),
    enabled: open && validPeriod
  });
  const missions = useQuery({
    queryKey: ['efetivo-planning-missions', 'team-availability', planId || 'official'],
    queryFn: () => listPlanningMissions({ planId }),
    enabled: open && validPeriod
  });
  const absences = useQuery({
    queryKey: ['efetivo-mission-team-absences', startDate, endDate],
    queryFn: () => listPlanningAbsences({ startDate, endDate }),
    enabled: open && validPeriod
  });
  useEffect(() => {
    if (open) setDraftIds(selectedIds);
  }, [open, selectedIds]);

  const options = useMemo(() => {
    const result = [...(collaborators.data || [])];
    for (const collaboratorId of selectedIds) {
      if (result.some(item => item.id === collaboratorId)) continue;
      const collaborator = selectedAllocationCollaborator(mission, collaboratorId);
      if (!collaborator) continue;
      result.push({
        id: collaborator.id,
        name: collaborator.name,
        role: collaborator.role,
        jobRoleId: collaborator.jobRoleId,
        admissionDate: null,
        terminationDate: null,
        isActive: collaborator.isActive ?? true,
        status: 'OUTSIDE_EMPLOYMENT' as const,
        plannedUtilization90d: null,
        vacationAlert: null
      });
    }
    return result;
  }, [collaborators.data, mission, selectedIds]);
  const { columns, otherUnavailable } = useMemo(() => validPeriod
    ? buildMissionAvailabilityColumns(filterCollaboratorsByActivity(options, 'ACTIVE'), missions.data || [], absences.data || [], startDate, endDate, mission?.id)
    : buildMissionAvailabilityColumns([], [], [], '2000-01-01', '2000-01-01'),
  [absences.data, endDate, mission?.id, missions.data, options, startDate, validPeriod]);
  const operationalRoleIds = useMemo(() => new Set(roles.filter(role => role.isOperational).map(role => role.id)), [roles]);
  const plannedIds = useMemo(() => plannedRoleIdSet(plannedRoles), [plannedRoles]);
  const filterByPlan = Boolean(plannedRoles?.length) && !showAll;
  const inPlan = (jobRoleId: string | null | undefined) => !filterByPlan || plannedIds.has(jobRoleId || '');
  const coverage = plannedRoleCoverage(plannedRoles, options.filter(collaborator => draftIds.includes(collaborator.id)));
  const selectedPeople = options.filter(collaborator => selectedIds.includes(collaborator.id));
  const roleSummary = [...selectedPeople.reduce((summary, collaborator) => {
    const label = collaborator.role || 'Cargo não informado';
    summary.set(label, (summary.get(label) || 0) + 1);
    return summary;
  }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right, 'pt-BR'));
  const queryLoading = loading || collaborators.isLoading || missions.isLoading || absences.isLoading;
  const queryError = collaborators.isError || missions.isError || absences.isError;
  const visibleIds = new Set(AVAILABILITY_STATUSES.flatMap(status => columns[status].map(entry => entry.collaborator.id)));
  const hiddenSelected = options.filter(collaborator => draftIds.includes(collaborator.id) && !visibleIds.has(collaborator.id)
    && (activityFilter === 'ACTIVE' || collaborator.isActive !== false));
  const inactivePeople = filterMissionTeamCollaborators(filterCollaboratorsByActivity(options, 'INACTIVE'), search)
    .filter(person => !roleFilter || person.jobRoleId === roleFilter);
  const inactiveDraftIds = options.filter(person => person.isActive === false && draftIds.includes(person.id)).map(person => person.id);
  const existingConfirmedOverlapIds = mission?.allocations
    .filter(allocation => allocation.allowMissionOverlap)
    .map(allocation => allocation.collaboratorId) || [];
  const overlappingDraftIds = draftIds.filter(id => !existingConfirmedOverlapIds.includes(id)
    && (missions.data || []).some(otherMission => otherMission.id !== mission?.id
      && otherMission.scheduleStatus === 'CONFIRMED'
      && otherMission.allocations.some(allocation => allocation.collaboratorId === id
        && allocationOverlapsPeriod(allocation, otherMission, startDate, endDate))));
  const applyTeam = (confirmedIds: string[] = [], confirmedInactiveIds: string[] = []) => {
    if (disabled || !validPeriod || queryLoading || queryError || draftIds.length < minSelected) return;
    onChange(draftIds, [...new Set([
      ...existingConfirmedOverlapIds.filter(id => draftIds.includes(id)),
      ...confirmedIds
    ])], confirmedInactiveIds);
    setOverlapConfirmationIds([]);
    setInactiveConfirmationIds([]);
    setOpen(false);
  };
  const requestApplyTeam = () => {
    if (disabled || !validPeriod || queryLoading || queryError || draftIds.length < minSelected) return;
    if (overlappingDraftIds.length || inactiveDraftIds.length) {
      setOverlapConfirmationIds(overlappingDraftIds);
      setInactiveConfirmationIds(inactiveDraftIds);
      return;
    }
    applyTeam();
  };
  const updateAllocationPeriod = (collaboratorId: string, value: MissionPeriodDraft) => {
    onAllocationPeriodsChange([
      ...allocationPeriods.filter(period => period.collaboratorId !== collaboratorId),
      { collaboratorId, ...value }
    ]);
  };

  return (
    <>
      {autoOpen ? null : <fieldset className="efetivo-team-fieldset efetivo-form-wide efetivo-team-v2">
        <legend>Equipe da missão</legend>
        <div className="efetivo-team-picker-trigger">
          <div><strong>{selectedIds.length} {selectedIds.length === 1 ? 'colaborador selecionado' : 'colaboradores selecionados'}</strong><span>Consulte a disponibilidade considerando todas as datas da programação.</span></div>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => { setSearch(''); setRoleFilter(''); setOverlapConfirmationIds([]); setInactiveConfirmationIds([]); setOpen(true); }}>Ver colaboradores</Button>
        </div>
        {!validPeriod ? <p className="efetivo-team-help">Preencha a mobilização e o fim da execução para consultar os colaboradores.</p> : null}
        {roleSummary.length ? <div className="efetivo-team-role-summary" aria-label="Resumo da equipe por cargo">{roleSummary.map(([role, count]) => <Badge key={role}>{role} · {count}</Badge>)}</div> : null}
        {selectedIds.length && mission && allowIndividualPeriods ? <p className="efetivo-team-help" aria-label="Ciclos de mobilização da equipe">Salve a programação e use “Equipe” na missão para gerenciar ciclos de mobilização, pausas, retornos e datas individuais.</p> : null}
        {selectedIds.length && !allowIndividualPeriods ? <p className="efetivo-team-help" aria-label="Primeiro ciclo da equipe inicial">Todos os colaboradores selecionados seguirão as datas gerais. Os ciclos individuais poderão ser personalizados durante a execução.</p> : null}
        {selectedIds.length && !mission && allowIndividualPeriods ? <section className="efetivo-team-section" aria-label="Mobilização e desmobilização por colaborador">
          <header><h4>Datas individuais da equipe</h4><p>As datas gerais são usadas como padrão. Ajuste somente quem entra ou sai em outro dia.</p></header>
          {selectedIds.map(collaboratorId => {
            const collaborator = options.find(item => item.id === collaboratorId);
            const period = allocationPeriods.find(item => item.collaboratorId === collaboratorId) || { collaboratorId, mobilizationDate: startDate, demobilizationDate: endDate };
            return <div className="efetivo-team-cycle-row" key={collaboratorId}>
              <div className="efetivo-team-person-heading"><div><strong>{collaborator?.name || 'Colaborador selecionado'}</strong><p>{collaborator?.role || 'Cargo não informado'}</p></div></div>
              <MissionPeriodFields id={'mission-team-' + collaboratorId} value={period} min={startDate} max={endDate} disabled={disabled} onChange={value => updateAllocationPeriod(collaboratorId, value)} />
            </div>;
          })}
        </section> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </fieldset>}

      {typeof document === 'undefined' ? null : createPortal(<Modal open={open} onClose={closeDialog}
        appearance="design-system" size="lg" fullscreenOnMobile={false} title="Colaboradores por disponibilidade"
        ariaDescribedBy="mission-team-dialog-description" backdropClassName="efetivo-team-availability-backdrop"
        panelClassName="efetivo-dialog efetivo-team-v2 efetivo-team-selection-dialog"
        footer={<>
          <Button variant="secondary" size="sm" onClick={closeDialog}>Cancelar</Button>
          <Button variant="primary" size="sm" disabled={disabled || !validPeriod || queryLoading || queryError || draftIds.length < minSelected} onClick={requestApplyTeam}>Aplicar equipe</Button>
        </>}>
        <div className="efetivo-team-stack">
          <p className="efetivo-dialog-description" id="mission-team-dialog-description">{validPeriod ? displayDateOnly(startDate) + ' a ' + displayDateOnly(endDate) + ' · ' : ''}Pessoas já alocadas podem ser selecionadas mediante confirmação.</p>
          <div className="efetivo-team-selection-toolbar">
            <Field id="mission-team-activity" label="Situação cadastral" optionalText="">
              <Select size="sm" value={activityFilter} onChange={event => setActivityFilter(event.target.value as CollaboratorActivityFilter)}><option value="ACTIVE">Ativos</option><option value="INACTIVE">Inativos</option><option value="ALL">Todos</option></Select>
            </Field>
            <SearchInput size="sm" label="Buscar por nome ou cargo" placeholder="Buscar por nome ou cargo" value={search} onChange={setSearch} />
            {plannedRoles?.length ? <Button variant="secondary" size="sm" onClick={() => setShowAll(value => !value)}>{showAll ? 'Somente cargos planejados' : 'Mostrar todos os colaboradores'}</Button> : null}
            <Field id="mission-team-role-filter" label="Filtrar por cargo" optionalText="">
              <Select size="sm" value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">Todos os cargos</option>{roles.filter(role => role.isOperational && inPlan(role.id)).map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</Select>
            </Field>
          </div>
          <p className="efetivo-team-selection-count" role="status">{draftIds.length} selecionado(s)</p>
          {plannedRoles?.length ? <p className="efetivo-team-help" aria-label="Cobertura dos cargos planejados">{coverage.rows.map(row => `${row.role.name}: ${row.selected}/${row.role.requiredCount}`).join(' · ')}</p> : null}
          {draftIds.length < minSelected ? <p className="efetivo-team-help">Selecione ao menos {minSelected} colaborador(es) para aplicar a equipe.</p> : null}
          {!validPeriod ? <EmptyState title="Informe o período da missão" description="Preencha a mobilização e o fim da execução para calcular quais colaboradores estarão disponíveis." />
            : queryLoading ? <div aria-label="Calculando disponibilidade no período" aria-busy="true"><Skeleton variant="card" height={160} /></div>
              : queryError ? <Alert tone="danger" title="Não foi possível consultar a disponibilidade" action={{ label: 'Tentar novamente', onClick: () => { void Promise.all([collaborators.refetch(), missions.refetch(), absences.refetch()]); } }}>A seleção foi mantida. Tente atualizar a consulta.</Alert>
                : <>
                  {otherUnavailable ? <Alert tone="info">{otherUnavailable} colaborador(es) não estará disponível no período por folga, afastamento ou fim do vínculo e não aparece no quadro.</Alert> : null}
                  {hiddenSelected.length ? <section className="efetivo-team-section" aria-label="Selecionados fora do quadro">
                    <header><h4>Selecionados fora do quadro</h4><p>Use o filtro Inativos para consultar os colaboradores desligados.</p></header>
                    {hiddenSelected.map(collaborator => <div className="efetivo-team-cycle-row" key={collaborator.id}>
                      <div className="efetivo-team-person-heading"><div><strong>{collaborator.name}</strong><p>{collaborator.role || 'Cargo não informado'}</p></div></div>
                      <div className="efetivo-team-actions"><Button variant="secondary" size="sm" disabled={disabled} onClick={() => setDraftIds(current => toggleMissionCollaborator(current, collaborator.id, false))}>Remover</Button></div>
                    </div>)}
                  </section> : null}
                  {activityFilter !== 'ACTIVE' ? <section className="efetivo-team-section" aria-label="Colaboradores inativos">
                    <p className="efetivo-team-help">Colaboradores inativos podem ser selecionados para registrar o histórico de mobilização e desmobilização, mediante confirmação.</p>
                    <div className="efetivo-team-stack">{inactivePeople.map(person => {
                      const selected = draftIds.includes(person.id);
                      const hasRole = Boolean(person.jobRoleId && operationalRoleIds.has(person.jobRoleId));
                      return <Card padding="sm" selected={selected} className="efetivo-team-choice-card" key={person.id}>
                        <label className="efetivo-team-choice"><input type="checkbox" checked={selected} disabled={disabled || (!hasRole && !selected)} onChange={event => setDraftIds(current => toggleMissionCollaborator(current, person.id, event.target.checked))} /><div className="efetivo-team-choice-person"><i aria-hidden="true">{initials(person.name)}</i><span><strong>{person.name}</strong><small>{person.role || 'Cargo não informado'} · Inativo</small></span></div></label>
                      </Card>;
                    })}{!inactivePeople.length ? <p>Nenhum colaborador inativo encontrado.</p> : null}</div>
                  </section> : null}
                  {activityFilter !== 'INACTIVE' ? <section className="efetivo-team-availability-kanban" aria-label="Disponibilidade dos colaboradores para a missão">
                    {AVAILABILITY_STATUSES.map(status => {
                      const entries = columns[status].filter(entry => (
                        inPlan(entry.collaborator.jobRoleId)
                        &&
                        (!roleFilter || entry.collaborator.jobRoleId === roleFilter)
                        && filterMissionTeamCollaborators([entry.collaborator], search).length > 0
                      ));
                      return <section className="efetivo-team-availability-column" data-availability-status={status} key={status} aria-label={COLUMN_META[status].label}>
                        <header><div><h3>{COLUMN_META[status].label}</h3><Badge>{entries.length}</Badge></div><p>{COLUMN_META[status].description}</p></header>
                        <div className="efetivo-team-stack">
                          {entries.length ? entries.map(entry => {
                            const selected = draftIds.includes(entry.collaborator.id);
                            const hasOperationalRole = Boolean(entry.collaborator.jobRoleId && operationalRoleIds.has(entry.collaborator.jobRoleId));
                            const hasMissionOverlap = status === 'AWAITING_MOBILIZATION' || status === 'MOBILIZED';
                            const selectable = status !== 'ON_VACATION' && entry.collaborator.isActive && hasOperationalRole;
                            return <Card padding="sm" selected={selected} className="efetivo-team-choice-card" data-collaborator-id={entry.collaborator.id} key={entry.collaborator.id}>
                              <label className="efetivo-team-choice">
                                <input type="checkbox" checked={selected} disabled={disabled || (!selectable && !selected)} onChange={event => setDraftIds(current => toggleMissionCollaborator(current, entry.collaborator.id, event.target.checked))} />
                                <span className="efetivo-team-choice-person"><i aria-hidden="true">{initials(entry.collaborator.name)}</i><span><strong>{entry.collaborator.name}</strong><small>{entry.collaborator.role || 'Cargo não informado'}</small></span></span>
                              </label>
                              {entry.mission ? <p className="efetivo-team-help">{entry.mission.project.code} · {entry.mission.project.name}<br />Mobilização em {displayDateOnly(entry.mission.mobilizationDate)}</p> : null}
                              {hasMissionOverlap ? <p className="efetivo-team-warning">Exige confirmação de sobreposição.</p> : null}
                              {entry.absence ? <p className="efetivo-team-help">Férias no período · até {displayDateOnly(entry.absence.endDate)}</p> : null}
                              {status === 'AVAILABLE' && !hasOperationalRole ? <p className="efetivo-team-help">Sem função operacional vinculada</p> : null}
                              {plannedRoles?.length && !plannedIds.has(entry.collaborator.jobRoleId || '') ? <p className="efetivo-team-help">Cargo fora do planejamento desta obra</p> : null}
                            </Card>;
                          }) : <p className="efetivo-team-help">{search || roleFilter ? 'Nenhum colaborador para estes filtros.' : 'Nenhum colaborador nesta situação.'}</p>}
                        </div>
                      </section>;
                    })}
                  </section> : null}
                </>}
        </div>
      </Modal>, document.body)}
      <ConfirmDialog appearance="design-system"
        open={overlapConfirmationIds.length > 0 || inactiveConfirmationIds.length > 0}
        title={inactiveConfirmationIds.length ? 'Confirmar colaboradores inativos?' : 'Confirmar colaborador em mais de uma missão?'}
        description={[inactiveConfirmationIds.length ? 'A equipe inclui colaboradores inativos. Confirme a inclusão para registrar o histórico de mobilização e desmobilização.' : '', overlapConfirmationIds.length ? 'Há colaboradores em outra missão no período. A sobreposição também será confirmada.' : ''].filter(Boolean).join(' ')}
        highlight={[...new Set([...inactiveConfirmationIds, ...overlapConfirmationIds])].map(id => options.find(item => item.id === id)?.name).filter(Boolean).join(', ')}
        confirmLabel={inactiveConfirmationIds.length ? 'Confirmar inclusão' : 'Confirmar sobreposição'}
        confirmDisabled={disabled || !validPeriod || queryLoading || queryError}
        danger={false}
        onConfirm={() => applyTeam(overlapConfirmationIds, inactiveConfirmationIds)}
        onCancel={() => { setOverlapConfirmationIds([]); setInactiveConfirmationIds([]); }}
      />
    </>
  );
}
