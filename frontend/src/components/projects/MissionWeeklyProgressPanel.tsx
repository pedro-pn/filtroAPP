import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { buildWeeklyProgressComparison, corporateToday, weekStartKey, type WeeklyProgressComparison } from '../../../../shared/modules/mission-weekly-progress.js';
import { listWeeklyProgressTargets, saveWeeklyProgressTarget, weeklyTargetPath, type WeeklyTargetOwner } from '../../api/weeklyProgressTargets';
import { ApiClientError } from '../../api/client';
import type { ProgressHistoryPoint } from '../../api/acompanhamentoComercial';
import { Button } from '../ui/Button';
import { formatDateOnly } from '../../utils/dateOnly';
import './mission-weekly-progress.css';

const STATUS_LABEL: Record<WeeklyProgressComparison['status'], string> = {
  ON_TARGET: 'Dentro da meta', ABOVE: 'Acima da meta', BELOW: 'Abaixo da meta',
  NO_TARGET: 'Sem meta definida', NO_DATA: 'Sem dados de avanço', PLANNED: 'Semana futura'
};
const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
function pointsLabel(value: number | null, signed = false) {
  return value == null ? '—' : `${signed && value > 0 ? '+' : ''}${numberFormat.format(value)} p.p.`;
}
type Draft = { weekStartDate: string; planned: string; expectedRevision: number };

export function MissionWeeklyProgressPanel({ owner, progressHistory, canManage = false }: {
  owner: WeeklyTargetOwner;
  progressHistory?: ProgressHistoryPoint[];
  canManage?: boolean;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const targetsQuery = useQuery({
    queryKey: ['mission-weekly-targets', weeklyTargetPath(owner), progressHistory === undefined],
    queryFn: () => listWeeklyProgressTargets(owner, progressHistory === undefined),
    staleTime: 30_000
  });
  const targets = targetsQuery.data?.targets ?? [];
  const rows = buildWeeklyProgressComparison({ targets, progressHistory: progressHistory ?? targetsQuery.data?.progressHistory ?? [] });
  const currentWeek = weekStartKey(corporateToday())!;
  const current = rows.find(row => row.weekStartDate === currentWeek)!;
  const latestFor = (week: string) => targets.filter(target => target.weekStartDate === week).sort((a, b) => b.revision - a.revision)[0];
  const editWeek = (week: string) => {
    const target = latestFor(week);
    setDraft({ weekStartDate: week, planned: target ? String(target.plannedPctPoints) : '', expectedRevision: target?.revision ?? 0 });
    setError('');
  };
  const save = useMutation({
    mutationFn: (payload: { weekStartDate: string; plannedPctPoints: number; expectedRevision: number }) => saveWeeklyProgressTarget(owner, payload),
    onSuccess: async () => {
      setDraft(null);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] });
    },
    onError: async (cause: Error) => {
      setError(cause.message || 'Não foi possível salvar a meta.');
      if (cause instanceof ApiClientError && cause.status === 409) {
        await queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] });
        setDraft(null);
      }
    }
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || save.isPending) return;
    const plannedPctPoints = Number(draft.planned.replace(',', '.'));
    if (!draft.weekStartDate || !draft.planned.trim() || !Number.isFinite(plannedPctPoints) || plannedPctPoints < 0 || plannedPctPoints > 100
      || Math.abs(plannedPctPoints * 100 - Math.round(plannedPctPoints * 100)) > 1e-8) {
      setError('Informe a semana e uma meta de 0 a 100 pontos percentuais, com até duas casas decimais.');
      return;
    }
    save.mutate({ weekStartDate: draft.weekStartDate, plannedPctPoints, expectedRevision: draft.expectedRevision });
  }

  return <section className="mission-weekly-progress" aria-label="Metas semanais de avanço" onClick={event => event.stopPropagation()}>
    <header className="mission-weekly-progress-head">
      <strong>Meta semanal de avanço</strong>
      {canManage ? <Button variant="mini" disabled={targetsQuery.isPending || targetsQuery.isError || save.isPending} onClick={() => editWeek(currentWeek)}>Definir meta</Button> : null}
    </header>
    <p className="mission-weekly-progress-hint">Segunda a domingo · Avanço da missão inteira, em pontos percentuais (p.p.). De 30% para 40% = 10 p.p.</p>
    {targetsQuery.isPending ? <p role="status">Carregando metas semanais…</p> : targetsQuery.isError ? <div role="alert"><p>Não foi possível carregar as metas.</p><Button variant="mini" onClick={() => targetsQuery.refetch()}>Tentar novamente</Button></div> : <>
      <div className="mission-weekly-progress-current">
        <span>Semana de {formatDateOnly(currentWeek)} · Em andamento</span>
        <dl>
          <div><dt>Previsto</dt><dd>{pointsLabel(current.plannedPctPoints)}</dd></div>
          <div><dt>Realizado</dt><dd>{pointsLabel(current.actualPctPoints)}</dd></div>
          <div><dt>Diferença</dt><dd>{pointsLabel(current.differencePctPoints, true)}</dd></div>
        </dl>
        <span className={`mission-weekly-status status-${current.status.toLowerCase()}`}>{STATUS_LABEL[current.status]}</span>
      </div>
      {draft && canManage ? <form className="mission-weekly-progress-form" onSubmit={submit}>
        <div className="field-group"><label htmlFor={`${id}-week`}>Semana</label><input id={`${id}-week`} type="date" required value={draft.weekStartDate} disabled={save.isPending} onChange={event => {
          const week = weekStartKey(event.target.value);
          if (week) editWeek(week);
          else setDraft({ ...draft, weekStartDate: '' });
        }} /><span className="field-hint">Selecione um dia; a semana começa na segunda-feira.</span></div>
        <div className="field-group"><label htmlFor={`${id}-planned`}>Avanço previsto para a semana (p.p.)</label><input id={`${id}-planned`} type="number" min="0" max="100" step="0.01" required value={draft.planned} disabled={save.isPending} onChange={event => setDraft({ ...draft, planned: event.target.value })} /></div>
        <div className="mission-weekly-progress-actions"><Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar meta'}</Button><Button variant="secondary" disabled={save.isPending} onClick={() => { setDraft(null); setError(''); }}>Cancelar</Button></div>
      </form> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="mission-weekly-progress-table" role="region" aria-label="Comparativo semanal de avanço" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Semana</th><th scope="col">Avanço previsto</th><th scope="col">Avanço realizado</th><th scope="col">Diferença</th><th scope="col">Situação</th><th scope="col">Meta registrada</th>{canManage ? <th scope="col">Ação</th> : null}</tr></thead>
          <tbody>{(showAll ? rows : rows.slice(0, 12)).map(row => {
            const revisions = targets.filter(target => target.weekStartDate === row.weekStartDate).sort((a, b) => b.revision - a.revision);
            return <tr key={row.weekStartDate}>
              <th scope="row">{formatDateOnly(row.weekStartDate)}<small>até {formatDateOnly(row.weekEndDate)}{row.inProgress ? ' · Em andamento' : ''}</small></th>
              <td>{pointsLabel(row.plannedPctPoints)}</td><td>{pointsLabel(row.actualPctPoints)}</td><td>{pointsLabel(row.differencePctPoints, true)}</td>
              <td><span className={`mission-weekly-status status-${row.status.toLowerCase()}`}>{STATUS_LABEL[row.status]}</span></td>
              <td>{row.target ? <><span>{row.target.author.name}</span><small>{new Date(row.target.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small>{revisions.length > 1 ? <details><summary>{revisions.length} versões</summary><ul>{revisions.map(revision => <li key={revision.id}>{pointsLabel(revision.plannedPctPoints)} · {revision.author.name}<small>{new Date(revision.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small></li>)}</ul></details> : null}</> : '—'}</td>
              {canManage ? <td><Button variant="mini" disabled={save.isPending} aria-label={`${row.target ? 'Editar' : 'Definir'} meta da semana de ${formatDateOnly(row.weekStartDate)}`} onClick={() => editWeek(row.weekStartDate)}>{row.target ? 'Editar' : 'Definir'}</Button></td> : null}
            </tr>;
          })}</tbody>
        </table>
      </div>
      {rows.length > 12 ? <Button variant="mini" onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar últimas 12 semanas' : `Ver todas as ${rows.length} semanas`}</Button> : null}
      <p className="mission-weekly-progress-hint">Diferença = realizado − previsto. O realizado vem do histórico de avanço da missão. Semanas sem novas medições têm avanço zero; sem histórico, o realizado fica indefinido. A semana atual ainda está em andamento.</p>
    </>}
  </section>;
}
