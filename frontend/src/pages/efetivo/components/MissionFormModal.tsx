import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import type { MissionInput, PendingMissionProject, PlanningCoordinator, PlanningJobRole, PlanningMission } from '../../../api/efetivoPlanning';
import { Alert, Button, Field, Input, Select } from '../../../components/ui/ds';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { SearchCombobox } from '../../../components/ui/SearchCombobox';
import { prefillDatesFromProject } from '../../../utils/missionPendencies';
import { missionAllocationPeriod } from '../../../utils/missionAllocationPeriod';
import { missionTeamScheduleStatus, resolveMissionTeamScheduleDates, selectedMissionCollaboratorIds, synchronizeMissionAllocationPeriods, type InitialTeamContext } from '../../../utils/missionTeam';
import { MissionTeamSelector } from './MissionTeamSelector';
import '../EfetivoDialogs.css';
import '../EfetivoMissions.ds.css';

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
      if (!selectedIds.has(period.collaboratorId)
        || period.mobilizationDate < value.mobilizationDate
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

export function MissionFormModal({ open, mission, project, planId, roles, rolesLoading, coordinators, coordinatorsLoading, saving, onClose, onSubmit }: {
  open: boolean;
  mission: PlanningMission | null;
  project: PendingMissionProject | null;
  planId?: string;
  roles: PlanningJobRole[];
  rolesLoading: boolean;
  coordinators: PlanningCoordinator[];
  coordinatorsLoading: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: MissionInput) => void;
}) {
  const [confirmedMissionOverlapCollaboratorIds, setConfirmedMissionOverlapCollaboratorIds] = useState<string[]>([]);
  const [confirmedInactiveCollaboratorIds, setConfirmedInactiveCollaboratorIds] = useState<string[]>([]);
  const [pendingInactiveSubmission, setPendingInactiveSubmission] = useState<MissionInput | null>(null);
  const individualPeriodBoundsRef = useRef({ startDate: '', endDate: '' });
  const { register, control, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: initialValues(mission, project, planId) });
  const [teamStartDate, executionEndDate, demobilizationDate, allocationPeriods] = useWatch({ control, name: ['mobilizationDate', 'executionEndDate', 'returnDate', 'allocationPeriods'] });
  const teamEndDate = demobilizationDate || executionEndDate || '';
  useEffect(() => {
    if (!open) return;
    const values = initialValues(mission, project, planId);
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
  }, [mission, open, planId, project, reset]);
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
    const payload: MissionInput = { ...values, returnDate: values.returnDate || null, planId, confirmedMissionOverlapCollaboratorIds, confirmedInactiveCollaboratorIds };
    if (inactiveAllocations.some(allocation => values.collaboratorIds.includes(allocation.collaboratorId)
      && !confirmedInactiveCollaboratorIds.includes(allocation.collaboratorId))) {
      setPendingInactiveSubmission(payload);
    } else onSubmit(payload);
  };
  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      closeOnEscape={!saving}
      showCloseButton={!saving}
      appearance="design-system"
      title={mission ? 'Editar programação' : 'Completar programação da missão'}
      size="lg"
      fullscreenOnMobile={false}
      panelClassName="efetivo-dialog efetivo-mission-programming-dialog"
      ariaDescribedBy="mission-form-description"
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button variant="primary" size="sm" type="submit" form="mission-programming-form" loading={saving} loadingLabel="Salvando programação">Salvar programação</Button>
      </>}
    >
      <form id="mission-programming-form" className="efetivo-dialog-form" noValidate onSubmit={handleSubmit(submit)}>
        <p className="efetivo-dialog-description" id="mission-form-description">A missão permanece em Stand by até receber líder, datas, equipe e confirmação.</p>
          <input type="hidden" {...register('projectId')} />
          <div className="efetivo-mission-form-identity"><span className="efetivo-eyebrow">Projeto/missão</span><strong>{identity ? `${identity.code} · ${identity.name}` : 'Projeto não identificado'}</strong><span>{identity ? `${identity.clientName || 'Sem cliente'} · ${identity.location || 'Sem local'}` : 'Selecione a missão pela lista de projetos.'}</span></div>
          {errors.projectId ? <Alert tone="danger">{errors.projectId.message}</Alert> : null}
          <fieldset className="efetivo-mission-form-section">
          <legend>Liderança</legend>
          <Controller name="headquartersResponsibleUserId" control={control} render={({ field }) => <SearchCombobox id="mission-leader-user" label="Vincular líder" required value={field.value} loading={coordinatorsLoading} disabled={saving} error={errors.headquartersResponsibleUserId?.message} emptyText="Nenhuma conta com colaborador e cargo vinculados." options={leaderAccounts.map(item => ({ value: item.id, label: item.collaborator?.name || item.name, description: `${item.collaborator?.role || ''} · conta ${item.name}` }))} onChange={field.onChange} />} />
          </fieldset>
          <fieldset className="efetivo-mission-form-section">
            <legend>Programação</legend>
            <div className="efetivo-dialog-fields">
              <Field id="mission-status" label="Situação da programação" required errorText={errors.scheduleStatus?.message}>
                <Select size="sm" disabled={saving} {...register('scheduleStatus')}><option value="CONFIRMED">Confirmada</option><option value="CANCELLED">Cancelada</option></Select>
              </Field>
              {([['mobilizationDate', 'Previsão de mobilização'], ['executionStartDate', 'Início da execução'], ['executionEndDate', 'Fim da execução']] as const).map(([name, label]) => (
                <Field id={`mission-${name}`} label={label} required errorText={errors[name]?.message} key={name}>
                  <Input size="sm" type="date" disabled={saving} {...register(name)} />
                </Field>
              ))}
              <Field id="mission-returnDate" label="Desmobilização" optionalText="" errorText={errors.returnDate?.message} helperText="Opcional. Informe somente a data em que a desmobilização de fato ocorreu.">
                <Input size="sm" type="date" disabled={saving} {...register('returnDate')} />
              </Field>
            </div>
          </fieldset>
          <Controller name="collaboratorIds" control={control} render={({ field }) => <MissionTeamSelector mission={mission} planId={planId} roles={roles} selectedIds={field.value} allocationPeriods={allocationPeriods || []} startDate={teamStartDate || ''} endDate={teamEndDate} loading={rolesLoading} disabled={saving} error={errors.collaboratorIds?.message || allocationPeriodError} onAllocationPeriodsChange={periods => setValue('allocationPeriods', periods, { shouldDirty: true, shouldValidate: true })} onChange={(ids, confirmedIds, inactiveIds) => {
            const periodsById = new Map((allocationPeriods || []).map(period => [period.collaboratorId, period]));
            const nextPeriods = ids.map(collaboratorId => periodsById.get(collaboratorId) || {
              collaboratorId,
              mobilizationDate: teamStartDate || '',
              demobilizationDate: teamEndDate
            });
            field.onChange(ids);
            setValue('allocationPeriods', nextPeriods, { shouldDirty: true, shouldValidate: true });
            setConfirmedMissionOverlapCollaboratorIds(confirmedIds);
            setConfirmedInactiveCollaboratorIds(inactiveIds);
          }} />} />
      </form>
    </Modal>
    <ConfirmDialog appearance="design-system" open={Boolean(pendingInactiveSubmission)} title="Registrar histórico de colaboradores inativos?"
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
      <Modal open={showDateForm} onClose={onClose} appearance="design-system" size="md" fullscreenOnMobile={false}
        title={mission ? 'Editar equipe inicial' : 'Definir equipe inicial'} panelClassName="efetivo-dialog efetivo-team-dialog"
        footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="primary" type="button" disabled={!datesValid || saving} onClick={() => setDatesConfirmed(true)}>Continuar</Button></>}>
          <p className="efetivo-dialog-description">{identity ? `${identity.code} · ${identity.name} · ` : ''}Confirme as datas da obra para consultar a disponibilidade dos colaboradores.</p>
          <div className="efetivo-form-grid">
            {([['mobilizationDate', 'Previsão de mobilização', mobilizationDate, setMobilizationDate], ['executionStartDate', 'Início da execução', executionStartDate, setExecutionStartDate], ['executionEndDate', 'Fim da execução', executionEndDate, setExecutionEndDate]] as const).map(([name, label, value, setValue]) => (
              <Field id={`initial-team-${name}`} label={label} required key={name}>
                <Input id={`initial-team-${name}`} size="sm" type="date" disabled={saving} value={value} onChange={event => setValue(event.target.value)} />
              </Field>
            ))}
            {mobilizationDate && executionStartDate && executionEndDate && !datesValid ? <Alert tone="danger">Use a ordem mobilização ≤ início ≤ fim.</Alert> : null}
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
      <ConfirmDialog appearance="design-system" open={Boolean(pendingInactiveSubmission)} title="Registrar histórico de colaboradores inativos?"
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
