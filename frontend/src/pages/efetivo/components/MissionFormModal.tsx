import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import type { MissionInput, PendingMissionProject, PlanningCoordinator, PlanningJobRole, PlanningMission } from '../../../api/efetivoPlanning';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { SearchCombobox } from '../../../components/ui/SearchCombobox';
import { prefillDatesFromProject } from '../../../utils/missionPendencies';
import { missionAllocationPeriod } from '../../../utils/missionAllocationPeriod';
import { missionTeamScheduleStatus, resolveMissionTeamScheduleDates, selectedMissionCollaboratorIds, synchronizeMissionAllocationPeriods, type InitialTeamContext } from '../../../utils/missionTeam';
import { MissionTeamSelector } from './MissionTeamSelector';

const schema = z.object({
  projectId: z.string().min(1, 'Selecione o projeto.'),
  scheduleStatus: z.enum(['CONFIRMED', 'CANCELLED']),
  headquartersResponsibleUserId: z.string().min(1, 'Vincule uma conta de líder.'),
  mobilizationDate: z.string().min(1, 'Informe a mobilização.'),
  executionStartDate: z.string().min(1, 'Informe o início.'),
  executionEndDate: z.string().min(1, 'Informe o fim.'),
  returnDate: z.string(),
  collaboratorIds: z.array(z.string()).max(500, 'Selecione no máximo 500 colaboradores.'),
  allocationPeriods: z.array(z.object({
    collaboratorId: z.string(),
    mobilizationDate: z.string().min(1, 'Informe a mobilização individual.'),
    demobilizationDate: z.string().min(1, 'Informe a desmobilização individual.')
  }).refine(value => value.mobilizationDate <= value.demobilizationDate, {
    path: ['demobilizationDate'],
    message: 'A desmobilização individual não pode ser anterior à mobilização.'
  }))
}).refine(value => value.mobilizationDate <= value.executionStartDate && value.executionStartDate <= value.executionEndDate, { path: ['executionEndDate'], message: 'Use a ordem mobilização ≤ início ≤ fim.' })
  .refine(value => !value.returnDate || value.executionEndDate <= value.returnDate, { path: ['returnDate'], message: 'A desmobilização não pode ser anterior ao fim da execução.' })
  .refine(value => value.scheduleStatus !== 'CONFIRMED' || value.collaboratorIds.length > 0, { path: ['collaboratorIds'], message: 'Selecione ao menos um colaborador para confirmar.' })
  .superRefine((value, context) => {
    const selectedIds = new Set(value.collaboratorIds);
    const missionEndDate = value.returnDate || value.executionEndDate;
    value.allocationPeriods.forEach((period, index) => {
      // Uma troca de equipe pode manter o período removido durante um ciclo do formulário.
      // O envio o descarta; somente períodos da seleção atual devem validar as datas.
      if (!selectedIds.has(period.collaboratorId)) return;
      if (period.mobilizationDate < value.mobilizationDate
        || period.demobilizationDate > missionEndDate) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['allocationPeriods', index],
          message: 'As datas individuais devem ficar dentro do período da missão.'
        });
      }
    });
  });

type FormValues = z.infer<typeof schema>;

function initialValues(mission: PlanningMission | null, project: PendingMissionProject | null, planId?: string, initialTeamMode = false, context?: InitialTeamContext): FormValues & { planId?: string } {
  const suggested = project ? prefillDatesFromProject(project) : null;
  const schedule = resolveMissionTeamScheduleDates(mission, context, {
    ...suggested,
    returnDate: project?.demobilizationDate?.slice(0, 10) || ''
  });
  return {
    planId,
    projectId: mission?.projectId || project?.id || '',
    scheduleStatus: missionTeamScheduleStatus(mission?.scheduleStatus, initialTeamMode),
    headquartersResponsibleUserId: context?.leaderUserId || mission?.headquartersResponsibleUserId || '',
    mobilizationDate: schedule.mobilizationDate,
    executionStartDate: schedule.executionStartDate,
    executionEndDate: schedule.executionEndDate,
    returnDate: schedule.returnDate,
    collaboratorIds: selectedMissionCollaboratorIds(mission),
    allocationPeriods: (mission?.allocations || []).map(allocation => {
      const period = missionAllocationPeriod(allocation, mission!);
      return {
        collaboratorId: allocation.collaboratorId,
        mobilizationDate: period.startDate,
        demobilizationDate: period.endDate
      };
    })
  };
}

export function MissionFormModal({ open, mission, project, planId, roles, rolesLoading, coordinators, coordinatorsLoading, saving, initialTeamMode = false, context, onClose, onSubmit }: {
  open: boolean;
  mission: PlanningMission | null;
  project: PendingMissionProject | null;
  planId?: string;
  roles: PlanningJobRole[];
  rolesLoading: boolean;
  coordinators: PlanningCoordinator[];
  coordinatorsLoading: boolean;
  saving: boolean;
  initialTeamMode?: boolean;
  /** Presente ao definir a equipe inicial a partir do fluxo de gestão: líder, datas e cargos vêm do fluxo. */
  context?: InitialTeamContext;
  onClose: () => void;
  onSubmit: (payload: MissionInput) => void;
}) {
  const [confirmedMissionOverlapCollaboratorIds, setConfirmedMissionOverlapCollaboratorIds] = useState<string[]>([]);
  const [confirmedInactiveCollaboratorIds, setConfirmedInactiveCollaboratorIds] = useState<string[]>([]);
  const [pendingInactiveSubmission, setPendingInactiveSubmission] = useState<MissionInput | null>(null);
  const individualPeriodBoundsRef = useRef({ startDate: '', endDate: '' });
  const { register, control, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: initialValues(mission, project, planId, initialTeamMode, context) });
  const [teamStartDate, executionEndDate, demobilizationDate, allocationPeriods] = useWatch({ control, name: ['mobilizationDate', 'executionEndDate', 'returnDate', 'allocationPeriods'] });
  const teamEndDate = demobilizationDate || executionEndDate || '';
  useEffect(() => {
    if (!open) return;
    const values = initialValues(mission, project, planId, initialTeamMode, context);
    reset(values);
    setConfirmedInactiveCollaboratorIds([]);
    setPendingInactiveSubmission(null);
    individualPeriodBoundsRef.current = {
      startDate: values.mobilizationDate,
      endDate: values.returnDate || values.executionEndDate
    };
    setConfirmedMissionOverlapCollaboratorIds(mission?.allocations
      .filter(allocation => allocation.allowMissionOverlap)
      .map(allocation => allocation.collaboratorId) || []);
  }, [context, initialTeamMode, mission, open, planId, project, reset]);
  useEffect(() => {
    if (!open || !teamStartDate || !teamEndDate) return;
    const previous = individualPeriodBoundsRef.current;
    individualPeriodBoundsRef.current = { startDate: teamStartDate, endDate: teamEndDate };
    if (!previous.startDate || !previous.endDate) return;
    const nextPeriods = (allocationPeriods || []).map(period => ({
      ...period,
      mobilizationDate: period.mobilizationDate === previous.startDate ? teamStartDate : period.mobilizationDate,
      demobilizationDate: period.demobilizationDate === previous.endDate ? teamEndDate : period.demobilizationDate
    }));
    if (nextPeriods.some((period, index) => period.mobilizationDate !== allocationPeriods?.[index]?.mobilizationDate
      || period.demobilizationDate !== allocationPeriods?.[index]?.demobilizationDate)) {
      setValue('allocationPeriods', nextPeriods, { shouldDirty: true, shouldValidate: true });
    }
  }, [allocationPeriods, open, setValue, teamEndDate, teamStartDate]);
  const identity = mission?.project || project;
  const leaderAccounts = coordinators.filter(item => item.collaborator?.isActive && item.collaborator.role);
  const invalidAllocationPeriod = Array.isArray(errors.allocationPeriods)
    ? errors.allocationPeriods.find(period => period?.message || period?.mobilizationDate?.message || period?.demobilizationDate?.message)
    : undefined;
  const allocationPeriodError = errors.allocationPeriods?.message
    || invalidAllocationPeriod?.message
    || invalidAllocationPeriod?.mobilizationDate?.message
    || invalidAllocationPeriod?.demobilizationDate?.message;
  const inactiveAllocations = (mission?.allocations || []).filter(allocation => allocation.collaborator?.isActive === false);
  const submit = (values: FormValues) => {
    const allocationPeriods = synchronizeMissionAllocationPeriods(
      values.collaboratorIds,
      values.allocationPeriods,
      values.mobilizationDate,
      values.returnDate || values.executionEndDate
    );
    const payload: MissionInput = { ...values, allocationPeriods, returnDate: values.returnDate || null, planId, confirmedMissionOverlapCollaboratorIds, confirmedInactiveCollaboratorIds };
    if (inactiveAllocations.some(allocation => values.collaboratorIds.includes(allocation.collaboratorId)
      && !confirmedInactiveCollaboratorIds.includes(allocation.collaboratorId))) {
      setPendingInactiveSubmission(payload);
    } else onSubmit(payload);
  };
  return (
    <>
    <Modal open={open} onClose={onClose} ariaLabelledBy="mission-form-title" panelClassName="modal-card efetivo-detail-modal efetivo-modal efetivo-team-dialog">
      <form className="efetivo-modal-layout" noValidate onSubmit={handleSubmit(submit)}>
        <header className="efetivo-modal-header"><div><h3 id="mission-form-title">{initialTeamMode ? mission ? 'Editar equipe inicial' : 'Definir equipe inicial' : mission ? 'Editar programação' : 'Completar programação da missão'}</h3><p>{initialTeamMode ? 'A equipe definida aqui será vinculada ao primeiro ciclo da obra e poderá ser personalizada durante a execução.' : 'A missão permanece em Stand by até receber líder, datas, equipe e confirmação.'}</p></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose}>×</button></header>
        <div className="efetivo-modal-body efetivo-form-grid">
          <input type="hidden" {...register('projectId')} />
          <div className="field-group efetivo-form-wide efetivo-mission-identity"><span className="efetivo-eyebrow">Projeto/missão</span><strong>{identity ? `${identity.code} · ${identity.name}` : 'Projeto não identificado'}</strong><span className="field-hint">{identity ? `${identity.clientName || 'Sem cliente'} · ${identity.location || 'Sem local'}` : 'Selecione a missão pela lista de projetos.'}</span>{errors.projectId ? <span className="field-error">{errors.projectId.message}</span> : null}</div>
          <p className="efetivo-form-wide efetivo-form-section-title">Liderança</p>
          {context ? (
            <div className="field-group efetivo-form-wide efetivo-team-reflected" data-efetivo-team-leader>
              <input type="hidden" {...register('headquartersResponsibleUserId')} />
              <span>Líder de Projetos</span>
              <strong>{context.leaderName}</strong>
              <span className="field-hint">O Líder de Projetos já foi definido no fluxo de gestão e responde por esta equipe.</span>
            </div>
          ) : (
          <Controller name="headquartersResponsibleUserId" control={control} render={({ field }) => <SearchCombobox id="mission-leader-user" label="Vincular líder" required value={field.value} loading={coordinatorsLoading} disabled={saving} error={errors.headquartersResponsibleUserId?.message} emptyText="Nenhuma conta com colaborador e cargo vinculados." options={leaderAccounts.map(item => ({ value: item.id, label: item.collaborator?.name || item.name, description: `${item.collaborator?.role || ''} · conta ${item.name}` }))} onChange={field.onChange} />} />
          )}
          <p className="efetivo-form-wide efetivo-form-section-title">Programação</p>
          {initialTeamMode ? (
            <div className="field-group efetivo-team-reflected">
              <span>Situação da programação</span>
              <input type="hidden" {...register('scheduleStatus')} />
              <strong>Confirmada</strong>
              <span className="field-hint">Ao definir a equipe inicial, a programação passa a integrar a operação ativa da obra.</span>
            </div>
          ) : <div className="field-group"><label htmlFor="mission-status">Situação da programação *</label><select id="mission-status" disabled={saving} {...register('scheduleStatus')}><option value="CONFIRMED">Confirmada</option><option value="CANCELLED">Cancelada</option></select></div>}
          {([['mobilizationDate', 'Previsão de mobilização'], ['executionStartDate', 'Início da execução'], ['executionEndDate', 'Fim da execução']] as const).map(([name, label]) => {
            const reflected = Boolean(context?.[name]);
            return <div className={`field-group ${errors[name] ? 'field-invalid' : ''}${reflected ? ' efetivo-team-reflected' : ''}`} key={name}><label htmlFor={`mission-${name}`}>{label} *</label><input id={`mission-${name}`} type="date" readOnly={reflected} disabled={saving} aria-invalid={Boolean(errors[name])} {...register(name)} />{reflected ? <span className="field-hint">Definido no fluxo de gestão.</span> : context ? <span className="field-hint">Ainda não definido na análise inicial; informe aqui ou preencha lá para refletir nas demais etapas.</span> : null}{errors[name] ? <span className="field-error">{errors[name]?.message}</span> : null}</div>;
          })}
          {context ? <input type="hidden" {...register('returnDate')} /> : (
          <div className={`field-group ${errors.returnDate ? 'field-invalid' : ''}`}><label htmlFor="mission-returnDate">Desmobilização</label><input id="mission-returnDate" type="date" disabled={saving} aria-invalid={Boolean(errors.returnDate)} {...register('returnDate')} /><span className="field-hint">Opcional. Informe somente a data em que a desmobilização de fato ocorreu.</span>{errors.returnDate ? <span className="field-error">{errors.returnDate.message}</span> : null}</div>
          )}
          <Controller name="collaboratorIds" control={control} render={({ field }) => <MissionTeamSelector mission={mission} planId={planId} roles={roles} plannedRoles={context?.plannedRoles} selectedIds={field.value} allocationPeriods={allocationPeriods || []} startDate={teamStartDate || ''} endDate={teamEndDate} loading={rolesLoading} disabled={saving} allowIndividualPeriods={!initialTeamMode} error={errors.collaboratorIds?.message || allocationPeriodError} onAllocationPeriodsChange={periods => setValue('allocationPeriods', periods, { shouldDirty: true, shouldValidate: true })} onChange={(ids, confirmedIds, inactiveIds) => {
            const nextPeriods = synchronizeMissionAllocationPeriods(
              ids,
              allocationPeriods || [],
              teamStartDate || '',
              teamEndDate
            );
            field.onChange(ids);
            setValue('allocationPeriods', nextPeriods, { shouldDirty: true, shouldValidate: true });
            setConfirmedMissionOverlapCollaboratorIds(confirmedIds);
            setConfirmedInactiveCollaboratorIds(inactiveIds);
          }} />} />
        </div>
        <footer className="efetivo-modal-footer"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Salvando…' : initialTeamMode ? 'Salvar equipe inicial' : 'Salvar programação'}</Button></footer>
      </form>
    </Modal>
    <ConfirmDialog open={Boolean(pendingInactiveSubmission)} title="Registrar histórico de colaboradores inativos?"
      description="A equipe contém colaboradores inativos. Confirme o registro das datas de mobilização e desmobilização para manter o histórico da missão."
      highlight={inactiveAllocations.filter(allocation => pendingInactiveSubmission?.collaboratorIds.includes(allocation.collaboratorId)).map(allocation => allocation.collaborator?.name).join(', ')}
      confirmLabel="Confirmar e salvar" confirmDisabled={saving} danger={false}
      onConfirm={() => {
        if (!pendingInactiveSubmission) return;
        onSubmit({ ...pendingInactiveSubmission, confirmedInactiveCollaboratorIds: [...new Set([
          ...(pendingInactiveSubmission.confirmedInactiveCollaboratorIds || []),
          ...inactiveAllocations.filter(allocation => pendingInactiveSubmission.collaboratorIds.includes(allocation.collaboratorId)).map(allocation => allocation.collaboratorId)
        ])] });
        setPendingInactiveSubmission(null);
      }} onCancel={() => setPendingInactiveSubmission(null)} />
    </>
  );
}

/**
 * Definição/edição da equipe inicial sem o formulário intermediário: abre direto no painel "Colaboradores por
 * disponibilidade" (via `MissionTeamSelector` com `autoOpen`). Líder, datas e cargos vêm do fluxo de gestão
 * (`context`); quando a análise inicial ainda não definiu as datas da obra, uma etapa mínima as pede antes.
 */
export function InitialTeamAvailabilityModal({ open, mission, project, planId, roles, rolesLoading, saving, context, onClose, onSubmit }: {
  open: boolean;
  mission: PlanningMission | null;
  project: PendingMissionProject | null;
  planId?: string;
  roles: PlanningJobRole[];
  rolesLoading: boolean;
  saving: boolean;
  context?: InitialTeamContext;
  onClose: () => void;
  onSubmit: (payload: MissionInput) => void;
}) {
  const initial = initialValues(mission, project, planId, true, context);
  const [mobilizationDate, setMobilizationDate] = useState(initial.mobilizationDate);
  const [executionStartDate, setExecutionStartDate] = useState(initial.executionStartDate);
  const [executionEndDate, setExecutionEndDate] = useState(initial.executionEndDate);
  const [datesConfirmed, setDatesConfirmed] = useState(Boolean(initial.mobilizationDate && initial.executionStartDate && initial.executionEndDate));
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>(initial.collaboratorIds);
  const [allocationPeriods, setAllocationPeriods] = useState(initial.allocationPeriods);
  const [pendingInactiveSubmission, setPendingInactiveSubmission] = useState<MissionInput | null>(null);

  useEffect(() => {
    if (!open) return;
    const values = initialValues(mission, project, planId, true, context);
    setMobilizationDate(values.mobilizationDate);
    setExecutionStartDate(values.executionStartDate);
    setExecutionEndDate(values.executionEndDate);
    setDatesConfirmed(Boolean(values.mobilizationDate && values.executionStartDate && values.executionEndDate));
    setCollaboratorIds(values.collaboratorIds);
    setAllocationPeriods(values.allocationPeriods);
    setPendingInactiveSubmission(null);
  }, [context, mission, open, planId, project]);

  if (!open) return null;

  const identity = mission?.project || project;
  const inactiveAllocations = (mission?.allocations || []).filter(allocation => allocation.collaborator?.isActive === false);
  const datesValid = Boolean(mobilizationDate && executionStartDate && executionEndDate
    && mobilizationDate <= executionStartDate && executionStartDate <= executionEndDate);
  const showDateForm = !datesConfirmed || !datesValid;

  const trySubmit = (ids: string[], periods: typeof allocationPeriods, confirmedOverlapIds: string[], confirmedInactiveIds: string[]) => {
    const synchronizedPeriods = synchronizeMissionAllocationPeriods(
      ids,
      periods,
      mobilizationDate,
      initial.returnDate || executionEndDate
    );
    const payload: MissionInput = {
      projectId: identity?.id || '',
      scheduleStatus: 'CONFIRMED',
      headquartersResponsibleUserId: context?.leaderUserId || mission?.headquartersResponsibleUserId || '',
      mobilizationDate,
      executionStartDate,
      executionEndDate,
      returnDate: initial.returnDate || null,
      collaboratorIds: ids,
      allocationPeriods: synchronizedPeriods,
      planId,
      confirmedMissionOverlapCollaboratorIds: confirmedOverlapIds,
      confirmedInactiveCollaboratorIds: confirmedInactiveIds
    };
    if (inactiveAllocations.some(allocation => ids.includes(allocation.collaboratorId) && !confirmedInactiveIds.includes(allocation.collaboratorId))) {
      setPendingInactiveSubmission(payload);
      return;
    }
    onSubmit(payload);
  };

  return (
    <>
      <Modal open={showDateForm} onClose={onClose} ariaLabelledBy="initial-team-dates-title" panelClassName="modal-card efetivo-modal efetivo-team-dialog">
        <div className="efetivo-modal-layout">
          <header className="efetivo-modal-header"><div><h3 id="initial-team-dates-title">{mission ? 'Editar equipe inicial' : 'Definir equipe inicial'}</h3><p>{identity ? `${identity.code} · ${identity.name} · ` : ''}Confirme as datas da obra para consultar a disponibilidade dos colaboradores.</p></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose}>×</button></header>
          <div className="efetivo-modal-body efetivo-form-grid">
            {([['mobilizationDate', 'Previsão de mobilização', mobilizationDate, setMobilizationDate], ['executionStartDate', 'Início da execução', executionStartDate, setExecutionStartDate], ['executionEndDate', 'Fim da execução', executionEndDate, setExecutionEndDate]] as const).map(([name, label, value, setValue]) => (
              <div className="field-group" key={name}>
                <label htmlFor={`initial-team-${name}`}>{label} *</label>
                <input id={`initial-team-${name}`} type="date" disabled={saving} value={value} onChange={event => setValue(event.target.value)} />
              </div>
            ))}
            {mobilizationDate && executionStartDate && executionEndDate && !datesValid ? <span className="field-error efetivo-form-wide">Use a ordem mobilização ≤ início ≤ fim.</span> : null}
          </div>
          <footer className="efetivo-modal-footer"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="button" disabled={!datesValid || saving} onClick={() => setDatesConfirmed(true)}>Continuar</Button></footer>
        </div>
      </Modal>
      {showDateForm ? null : (
        <MissionTeamSelector
          mission={mission}
          planId={planId}
          roles={roles}
          plannedRoles={context?.plannedRoles}
          selectedIds={collaboratorIds}
          allocationPeriods={allocationPeriods}
          startDate={mobilizationDate}
          endDate={executionEndDate}
          loading={rolesLoading}
          disabled={saving}
          allowIndividualPeriods={false}
          autoOpen
          minSelected={1}
          onCancel={onClose}
          onAllocationPeriodsChange={setAllocationPeriods}
          onChange={(ids, confirmedOverlapIds, confirmedInactiveIds) => {
            const nextPeriods = synchronizeMissionAllocationPeriods(
              ids,
              allocationPeriods,
              mobilizationDate,
              initial.returnDate || executionEndDate
            );
            setCollaboratorIds(ids);
            setAllocationPeriods(nextPeriods);
            trySubmit(ids, nextPeriods, confirmedOverlapIds, confirmedInactiveIds);
          }}
        />
      )}
      <ConfirmDialog open={Boolean(pendingInactiveSubmission)} title="Registrar histórico de colaboradores inativos?"
        description="A equipe contém colaboradores inativos. Confirme o registro das datas de mobilização e desmobilização para manter o histórico da missão."
        highlight={inactiveAllocations.filter(allocation => pendingInactiveSubmission?.collaboratorIds.includes(allocation.collaboratorId)).map(allocation => allocation.collaborator?.name).join(', ')}
        confirmLabel="Confirmar e salvar" confirmDisabled={saving} danger={false}
        onConfirm={() => {
          if (!pendingInactiveSubmission) return;
          onSubmit({ ...pendingInactiveSubmission, confirmedInactiveCollaboratorIds: [...new Set([
            ...(pendingInactiveSubmission.confirmedInactiveCollaboratorIds || []),
            ...inactiveAllocations.filter(allocation => pendingInactiveSubmission.collaboratorIds.includes(allocation.collaboratorId)).map(allocation => allocation.collaboratorId)
          ])] });
          setPendingInactiveSubmission(null);
        }} onCancel={() => setPendingInactiveSubmission(null)} />
    </>
  );
}
