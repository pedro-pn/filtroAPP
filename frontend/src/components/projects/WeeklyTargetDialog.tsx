import { useState, type FormEvent } from 'react';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';

import { corporateToday, effectiveWeeklyProgressTarget, weekStartKey, weeklyTargetCountingPeriod, WEEKLY_TARGET_SERVICES, WEEKLY_TARGET_WORKDAYS, type WeeklyProgressTarget } from '../../../../shared/modules/mission-weekly-progress.js';
import { ApiClientError } from '../../api/client';
import { saveWeeklyProgressTarget, type WeeklyTargetOwner } from '../../api/weeklyProgressTargets';
import { formatDateOnly } from '../../utils/dateOnly';
import { AppIcon } from '../icons/AppIcon';
import { Modal } from '../ui/Modal';
import { Alert, Button, Input, Select, Switch } from '../ui/ds';
import { changeGoalKind, isServiceKind, newGoalDraft, periodWeekFor, SERVICE_KINDS, targetToDraft, weeklyTargetDraftToInput, type GoalDraft, type GoalKind, type TargetDraft } from './weeklyTargetDraft';
import { weeklyGoalSentence, workdaysLabel } from './weeklyTargetPresentation';
import './weekly-target-dialog.css';

const KIND_LABEL: Record<GoalKind, string> = { ANY_SERVICE: 'Qualquer serviço', ...WEEKLY_TARGET_SERVICES, FILTRAGEM: 'Filtragem de óleo', PROGRESS: 'Avanço do projeto', ATTENDANCE: 'Equipe mínima no dia' };
const MAX_GOALS = 6;
const SAVE_KEY = ['save-weekly-target'];
const addDays = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const short = (date: string) => formatDateOnly(date).slice(0, 5);

function sentenceFor(goal: GoalDraft, workdays: number[]) {
  const value = Number(goal.value.replace(',', '.'));
  const numeric = Number.isFinite(value) ? value : null;
  if (goal.kind === 'PROGRESS' || goal.kind === 'ATTENDANCE') return weeklyGoalSentence({ kind: goal.kind, value: numeric, workdays });
  return weeklyGoalSentence({ kind: 'SERVICE', serviceType: goal.kind === 'ANY_SERVICE' ? undefined : goal.kind,
    metric: goal.kind === 'FILTRAGEM' ? 'L' : goal.unit, basis: goal.basis, value: numeric });
}

function GoalRow({ goal, index, workdays, disabled, onChange, onRemove }: {
  goal: GoalDraft; index: number; workdays: number[]; disabled: boolean; onChange: (goal: GoalDraft) => void; onRemove?: () => void;
}) {
  const n = index + 1;
  return <li className="wtd-goal">
    <div className="wtd-goal-head">
      <Select aria-label={`Meta ${n}: o que medir`} value={goal.kind} disabled={disabled} onChange={event => onChange(changeGoalKind(goal, event.target.value as GoalKind))}>
        <optgroup label="Serviço">{SERVICE_KINDS.map(kind => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}</optgroup>
        <optgroup label="Projeto">{(['PROGRESS', 'ATTENDANCE'] as const).map(kind => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}</optgroup>
      </Select>
      {onRemove ? <button type="button" className="wtd-remove" aria-label={`Remover meta ${n}`} disabled={disabled} onClick={onRemove}><AppIcon icon={X} size="sm" /></button> : null}
    </div>
    <div className="wtd-goal-rule">
      <Input aria-label={`Meta ${n}: quantidade`} type="number" inputMode="decimal" min={0} step={goal.kind === 'ATTENDANCE' ? 1 : 0.01} required
        value={goal.value} placeholder="0" disabled={disabled} onChange={event => onChange({ ...goal, value: event.target.value })} />
      {goal.kind === 'PROGRESS' ? <span className="wtd-unit">p.p.</span>
        : goal.kind === 'ATTENDANCE' ? <span className="wtd-unit">colaboradores</span>
          : goal.kind === 'FILTRAGEM' ? <span className="wtd-unit">L</span>
            : <Select aria-label={`Meta ${n}: unidade`} value={goal.unit} disabled={disabled} containerClassName="wtd-unit-select"
              onChange={event => onChange({ ...goal, unit: event.target.value as GoalDraft['unit'] })}>
              <option value="M">m</option><option value="UN">un</option>{goal.kind === 'ANY_SERVICE' ? <option value="L">L</option> : null}
            </Select>}
      {isServiceKind(goal.kind) ? <Select aria-label={`Meta ${n}: forma de contar`} value={goal.basis} disabled={disabled} containerClassName="wtd-basis"
        onChange={event => onChange({ ...goal, basis: event.target.value as GoalDraft['basis'] })}>
        <option value="PER_PRODUCTIVE_DAY">por colaborador por dia</option>
        <option value="WEEK_TOTAL">no total da semana</option>
      </Select> : <span className="wtd-basis-fixed">{goal.kind === 'PROGRESS' ? 'na semana' : 'por dia, no mínimo'}</span>}
    </div>
    <p className="wtd-sentence">{sentenceFor(goal, workdays)}</p>
  </li>;
}

function weekOptions(selected: string, draft: TargetDraft) {
  const today = corporateToday();
  const current = weekStartKey(today)!;
  const weeks = new Set([...Array.from({ length: 13 }, (_, index) => addDays(current, (index - 4) * 7)), selected].filter(Boolean));
  return [...weeks].sort().map(week => {
    const { periodStartDate, periodEndDate } = weeklyTargetCountingPeriod(week, draft);
    const state = periodStartDate <= today && today <= periodEndDate ? ' (atual)' : periodEndDate < today ? ' (fechada)' : '';
    return { value: week, label: `${short(periodStartDate)} a ${short(periodEndDate)}${state}` };
  });
}

function DialogBody({ owner, request, targets, workdays, onClose }: {
  owner: WeeklyTargetOwner; request: WeeklyTargetRequest; targets: WeeklyProgressTarget[]; workdays: number[]; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const latestRevision = (week: string) => Math.max(0, ...targets.filter(target => target.weekStartDate === week).map(target => target.revision));
  const previousTarget = (week: string) => effectiveWeeklyProgressTarget(targets, week)
    ?? [...targets].filter(target => !target.isDeleted && target.weekStartDate < week).sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate))[0] ?? null;
  // Editar mantém a semana da meta; uma meta nova começa no período que contém a data de referência.
  const [draft, setDraft] = useState<TargetDraft>(() => {
    const existing = effectiveWeeklyProgressTarget(targets, request.weekStartDate);
    const initial = targetToDraft(existing, request.weekStartDate, latestRevision(request.weekStartDate), previousTarget(request.weekStartDate));
    if (existing) return initial;
    const week = periodWeekFor(request.referenceDate, initial);
    return { ...initial, weekStartDate: week, expectedRevision: latestRevision(week) };
  });
  const editing = Boolean(effectiveWeeklyProgressTarget(targets, request.weekStartDate));
  const [error, setError] = useState('');
  const [periodOpen, setPeriodOpen] = useState(false);
  const save = useMutation({
    mutationKey: SAVE_KEY,
    mutationFn: () => saveWeeklyProgressTarget(owner, weeklyTargetDraftToInput(draft, workdays)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] });
      onClose();
    },
    onError: async (cause: Error) => {
      setError(cause.message || 'Não foi possível salvar a meta.');
      if (cause instanceof ApiClientError && cause.status === 409) await queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] });
    }
  });
  const busy = save.isPending;
  const update = (next: TargetDraft) => { setDraft(next); setError(''); };
  const perCollaborator = draft.goals.some(goal => isServiceKind(goal.kind) && goal.basis === 'PER_PRODUCTIVE_DAY');
  const period = weeklyTargetCountingPeriod(draft.weekStartDate, draft);
  const countingLabel = `${WEEKLY_TARGET_WORKDAYS[draft.countingStartDay].toLowerCase()} a ${WEEKLY_TARGET_WORKDAYS[draft.countingEndDay].toLowerCase()}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    try {
      weeklyTargetDraftToInput(draft, workdays);
      save.mutate();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Confira os valores da meta.'); }
  }

  return <form id="weekly-target-form" className="wtd-body" onSubmit={submit} noValidate>
    <section className="wtd-section">
      <label className="wtd-label" htmlFor="wtd-week">Vale a partir da semana</label>
      <Select id="wtd-week" value={draft.weekStartDate} disabled={busy} options={weekOptions(draft.weekStartDate, draft)}
        onChange={event => update({ ...draft, weekStartDate: event.target.value, expectedRevision: latestRevision(event.target.value) })} />
      <p className="wtd-hint">Contagem de {countingLabel} ({formatDateOnly(period.periodStartDate)} a {formatDateOnly(period.periodEndDate)}).{' '}
        <button type="button" className="wtd-link" aria-expanded={periodOpen} aria-controls="wtd-period" onClick={() => setPeriodOpen(!periodOpen)}>{periodOpen ? 'Ocultar dias' : 'Alterar dias'}</button></p>
      {periodOpen ? <div className="wtd-period" id="wtd-period">
        {(['countingStartDay', 'countingEndDay'] as const).map((key, index) => <Select key={key} aria-label={index ? 'Último dia da contagem' : 'Primeiro dia da contagem'}
          value={String(draft[key])} disabled={busy} options={[1, 2, 3, 4, 5, 6, 0].map(day => ({ value: String(day), label: WEEKLY_TARGET_WORKDAYS[day] }))}
          onChange={event => {
            const next = { ...draft, [key]: Number(event.target.value) };
            const week = editing ? draft.weekStartDate : periodWeekFor(request.referenceDate, next);
            update({ ...next, weekStartDate: week, expectedRevision: latestRevision(week) });
          }} />)}
      </div> : null}
    </section>

    {draft.replacesLegacyRules ? <Alert tone="info" title="Esta meta usava regras por combinação de serviços.">
      Ao salvar, elas serão substituídas pelas metas abaixo. As semanas anteriores continuam com a regra antiga.
    </Alert> : null}

    <section className="wtd-section">
      <span className="wtd-label" id="wtd-goals-label">O que a equipe deve fazer</span>
      <ol className="wtd-goals" aria-labelledby="wtd-goals-label">
        {draft.goals.flatMap((goal, index) => [
          ...(index ? [<li key={`join-${index}`} className={`wtd-join is-${draft.logic.toLowerCase()}`} aria-hidden="true"><span>{draft.logic === 'ALL' ? 'E' : 'OU'}</span></li>] : []),
          <GoalRow key={index} goal={goal} index={index} workdays={workdays} disabled={busy}
            onChange={next => update({ ...draft, goals: draft.goals.map((item, i) => i === index ? next : item) })}
            onRemove={draft.goals.length > 1 ? () => update({ ...draft, goals: draft.goals.filter((_, i) => i !== index) }) : undefined} />
        ])}
      </ol>
      <Button type="button" size="sm" variant="ghost" iconLeft={<AppIcon icon={Plus} size="sm" />} disabled={busy || draft.goals.length >= MAX_GOALS}
        onClick={() => {
          const used = new Set(draft.goals.map(goal => goal.kind));
          const kind = ([...SERVICE_KINDS, 'PROGRESS', 'ATTENDANCE'] as GoalKind[]).find(option => !used.has(option)) ?? 'PROGRESS';
          update({ ...draft, goals: [...draft.goals, newGoalDraft(kind, kind === 'FILTRAGEM' ? 'WEEK_TOTAL' : 'PER_PRODUCTIVE_DAY')] });
        }}>Adicionar outra meta</Button>
      {draft.goals.length > 1 ? <fieldset className="wtd-logic">
        <legend className="wtd-label">A semana conta como atingida quando</legend>
        <div className="wtd-logic-options">
          {([['ALL', 'Todas forem cumpridas', draft.goals.length === 2 ? 'Uma E a outra' : 'Uma E as outras'],
            ['ANY', 'Pelo menos uma for cumprida', draft.goals.length === 2 ? 'Uma OU a outra' : 'Qualquer uma delas']] as const).map(([value, title, hint]) =>
            <label key={value} className={draft.logic === value ? 'is-selected' : undefined}>
              <input type="radio" name="wtd-logic" value={value} checked={draft.logic === value} disabled={busy} onChange={() => update({ ...draft, logic: value })} />
              <strong>{title}</strong><small>{hint}</small>
            </label>)}
        </div>
      </fieldset> : null}
    </section>

    {perCollaborator ? <p className="wtd-hint">Por colaborador por dia: cada pessoa da equipe do RDO conta 1 em cada dia com RDO do serviço, sem considerar horários.</p> : null}
    {draft.goals.some(goal => goal.kind === 'ATTENDANCE') ? <p className="wtd-hint">A equipe mínima vale nos dias de trabalho do projeto: {workdaysLabel(workdays)}.</p> : null}

    <Switch checked={draft.repeatWeekly} disabled={busy} onChange={event => update({ ...draft, repeatWeekly: event.target.checked })} label="Repetir nas próximas semanas"
      description={draft.repeatWeekly ? 'Vale para todas as semanas seguintes até você mudar ou excluir.' : 'Vale só para a semana escolhida.'} />
    {error ? <Alert tone="danger">{error}</Alert> : null}
  </form>;
}

/** Semana clicada e a data usada para escolher o período de uma meta nova. */
export type WeeklyTargetRequest = { weekStartDate: string; referenceDate: string };

export function WeeklyTargetDialog({ owner, request, targets, workdays, onClose }: {
  owner: WeeklyTargetOwner; request: WeeklyTargetRequest | null; targets: WeeklyProgressTarget[]; workdays: number[]; onClose: () => void;
}) {
  const saving = useIsMutating({ mutationKey: SAVE_KEY }) > 0;
  return <Modal open={Boolean(request)} onClose={() => { if (!saving) onClose(); }} appearance="design-system" size="md" title="Meta semanal" panelClassName="wtd" backdropClassName="weekly-target-dialog-backdrop"
    footer={<div className="wtd-footer">
      <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
      <Button type="submit" form="weekly-target-form" variant="primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar meta'}</Button>
    </div>}>
    {request ? <DialogBody key={`${request.weekStartDate}:${request.referenceDate}`} owner={owner} request={request} targets={targets} workdays={workdays} onClose={onClose} /> : null}
  </Modal>;
}
