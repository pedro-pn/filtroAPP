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
import { selectedMissionCollaboratorIds } from '../../../utils/missionTeam';
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

function initialValues(mission: PlanningMission | null, project: PendingMissionProject | null, planId?: string): FormValues & { planId?: string } {
  const suggested = project ? prefillDatesFromProject(project) : null;
  const mobilizationDate = mission?.mobilizationDate?.slice(0, 10) || suggested?.mobilizationDate || '';
  const executionEndDate = mission?.executionEndDate?.slice(0, 10) || suggested?.executionEndDate || '';
  const returnDate = mission?.returnDate?.slice(0, 10)
    || mission?.project.demobilizationDate?.slice(0, 10)
    || project?.demobilizationDate?.slice(0, 10)
    || '';
  return {
    planId,
    projectId: mission?.projectId || project?.id || '',
    scheduleStatus: mission?.scheduleStatus === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
    headquartersResponsibleUserId: mission?.headquartersResponsibleUserId || '',
    mobilizationDate,
    executionStartDate: mission?.executionStartDate?.slice(0, 10) || suggested?.executionStartDate || '',
    executionEndDate,
    returnDate,
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
    <Modal open={open} onClose={onClose} ariaLabelledBy="mission-form-title" panelClassName="modal-card efetivo-detail-modal efetivo-modal">
      <form className="efetivo-modal-layout" noValidate onSubmit={handleSubmit(submit)}>
        <header className="efetivo-modal-header"><div><h3 id="mission-form-title">{mission ? 'Editar programação' : 'Completar programação da missão'}</h3><p>A missão permanece em Stand by até receber líder, datas, equipe e confirmação.</p></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose}>×</button></header>
        <div className="efetivo-modal-body efetivo-form-grid">
          <input type="hidden" {...register('projectId')} />
          <div className="field-group efetivo-form-wide efetivo-mission-identity"><span className="efetivo-eyebrow">Projeto/missão</span><strong>{identity ? `${identity.code} · ${identity.name}` : 'Projeto não identificado'}</strong><span className="field-hint">{identity ? `${identity.clientName || 'Sem cliente'} · ${identity.location || 'Sem local'}` : 'Selecione a missão pela lista de projetos.'}</span>{errors.projectId ? <span className="field-error">{errors.projectId.message}</span> : null}</div>
          <p className="efetivo-form-wide efetivo-form-section-title">Liderança</p>
          <Controller name="headquartersResponsibleUserId" control={control} render={({ field }) => <SearchCombobox id="mission-leader-user" label="Vincular líder" required value={field.value} loading={coordinatorsLoading} disabled={saving} error={errors.headquartersResponsibleUserId?.message} emptyText="Nenhuma conta com colaborador e cargo vinculados." options={leaderAccounts.map(item => ({ value: item.id, label: item.collaborator?.name || item.name, description: `${item.collaborator?.role || ''} · conta ${item.name}` }))} onChange={field.onChange} />} />
          <p className="efetivo-form-wide efetivo-form-section-title">Programação</p>
          <div className="field-group"><label htmlFor="mission-status">Situação da programação *</label><select id="mission-status" disabled={saving} {...register('scheduleStatus')}><option value="CONFIRMED">Confirmada</option><option value="CANCELLED">Cancelada</option></select></div>
          {([['mobilizationDate', 'Previsão de mobilização'], ['executionStartDate', 'Início da execução'], ['executionEndDate', 'Fim da execução']] as const).map(([name, label]) => <div className={`field-group ${errors[name] ? 'field-invalid' : ''}`} key={name}><label htmlFor={`mission-${name}`}>{label} *</label><input id={`mission-${name}`} type="date" disabled={saving} aria-invalid={Boolean(errors[name])} {...register(name)} />{errors[name] ? <span className="field-error">{errors[name]?.message}</span> : null}</div>)}
          <div className={`field-group ${errors.returnDate ? 'field-invalid' : ''}`}><label htmlFor="mission-returnDate">Desmobilização</label><input id="mission-returnDate" type="date" disabled={saving} aria-invalid={Boolean(errors.returnDate)} {...register('returnDate')} /><span className="field-hint">Opcional. Informe somente a data em que a desmobilização de fato ocorreu.</span>{errors.returnDate ? <span className="field-error">{errors.returnDate.message}</span> : null}</div>
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
        </div>
        <footer className="efetivo-modal-footer"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar programação'}</Button></footer>
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
