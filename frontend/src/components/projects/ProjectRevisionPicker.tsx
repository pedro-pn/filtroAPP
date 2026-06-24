import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getProjectRevisions,
  setProjectRevision,
  setProjectSchedule,
  type CommercialRevision
} from '../../api/acompanhamentoComercial';
import { useToast } from '../ui/Toast';

function toNum(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatBRL(value?: string | number | null) {
  const n = toNum(value);
  return n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPct(value?: string | number | null) {
  const n = toNum(value);
  return n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function toDateInput(iso?: string | null) {
  return iso ? iso.slice(0, 10) : '';
}

function formatDatePt(value: string) {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function addDays(dateInput: string, days: number) {
  const d = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromInput: string, to: Date) {
  const from = new Date(`${fromInput}T00:00:00`);
  if (Number.isNaN(from.getTime())) return null;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function isoOrNull(dateInput: string) {
  return dateInput ? new Date(`${dateInput}T00:00:00`).toISOString() : null;
}

// Escolha da revisão da proposta (comercial) + resumo do previsto + cronograma (aprovação,
// prazo de mobilização e início real). Aparece para projetos com proposta importada.
export function ProjectRevisionPicker({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const queryKey = ['commercial-revisions', projectId];

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => getProjectRevisions(projectId) });

  const [selected, setSelected] = useState<number | null>(null);
  const [approvalEdit, setApprovalEdit] = useState<string | null>(null);
  const [startEdit, setStartEdit] = useState<string | null>(null);

  const revisionMutation = useMutation({
    mutationFn: (codBd: number) => setProjectRevision(projectId, codBd),
    onSuccess: () => {
      showToast('Revisão do orçamento atualizada.');
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['commercial-pendencias'] });
    },
    onError: () => showToast('Não foi possível atualizar a revisão.')
  });

  const scheduleMutation = useMutation({
    mutationFn: (payload: { approvedAt?: string | null; startDate?: string | null }) => setProjectSchedule(projectId, payload),
    onSuccess: () => {
      showToast('Cronograma atualizado.');
      setApprovalEdit(null);
      setStartEdit(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: () => showToast('Não foi possível atualizar o cronograma.')
  });

  if (isLoading) {
    return (
      <div className="det-row">
        <span className="det-label">Comercial</span>
        <span className="det-val">Carregando…</span>
      </div>
    );
  }

  const revisions = data?.revisions ?? [];
  const current = data?.currentCodBd ?? null;
  if (revisions.length === 0) return null;

  const chosen = selected ?? current ?? revisions[0]?.codBd ?? null;
  const currentRevision: CommercialRevision | undefined = revisions.find(r => r.codBd === current) ?? undefined;

  const approvalValue = approvalEdit ?? toDateInput(data?.approvedAt);
  const startValue = startEdit ?? toDateInput(data?.startDate);
  const leadDays = data?.mobilizationLeadDays ?? null;
  const mobilizationDeadline = approvalValue && leadDays != null ? addDays(approvalValue, leadDays) : '';
  const mobilizationLate = Boolean(startValue && mobilizationDeadline && startValue > mobilizationDeadline);

  const plannedDays = currentRevision?.plannedDays ?? null;
  const consumed = startValue && plannedDays ? daysBetween(startValue, new Date()) : null;
  const consumedPct = consumed != null && plannedDays ? Math.round((consumed / plannedDays) * 100) : null;

  const scheduleDirty = approvalValue !== toDateInput(data?.approvedAt) || startValue !== toDateInput(data?.startDate);

  return (
    <>
      <div className="det-row">
        <span className="det-label">Revisão que vale</span>
        <span className="det-val" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select id={`rev-${projectId}`} value={chosen ?? ''} onChange={event => setSelected(Number(event.target.value))}>
            {revisions.map(revision => (
              <option key={revision.codBd} value={revision.codBd}>
                {`Rev ${revision.nRev} · ${formatBRL(revision.salePrice)}${revision.codBd === current ? ' (atual)' : ''}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="mini-btn"
            disabled={revisionMutation.isPending || chosen === null || chosen === current}
            onClick={() => chosen !== null && revisionMutation.mutate(chosen)}
          >
            {revisionMutation.isPending ? 'Aplicando…' : 'Aplicar'}
          </button>
        </span>
      </div>

      {currentRevision ? (
        <>
          <div className="det-row">
            <span className="det-label">Previsto (comercial)</span>
            <span className="det-val">
              Venda {formatBRL(currentRevision.salePrice)} · Custo {formatBRL(currentRevision.plannedCost)} · Margem {formatPct(currentRevision.expectedMargin)} · Lucro {formatBRL(currentRevision.expectedProfit)}
            </span>
          </div>
          <div className="det-row">
            <span className="det-label">Dias / equipe previstos</span>
            <span className="det-val">
              {currentRevision.plannedDays ?? '—'} corridos · {currentRevision.workedDays ?? '—'} trabalhados ·
              {' '}{currentRevision.numOperators ?? '—'} oper. / {currentRevision.numSupervisors ?? '—'} encarr. ·
              {' '}{currentRevision.numPerDay ?? '—'} diurno / {currentRevision.numPerNight ?? '—'} noturno
            </span>
          </div>
        </>
      ) : (
        <div className="det-row">
          <span className="det-label">Orçamento</span>
          <span className="det-val">Escolha a revisão que vale para ver o previsto e o cronograma.</span>
        </div>
      )}

      {current != null ? (
        <>
          <div className="det-row">
            <span className="det-label">Aprovação / Início</span>
            <span className="det-val" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12 }}>Aprovação <input type="date" value={approvalValue} onChange={e => setApprovalEdit(e.target.value)} /></label>
              <label style={{ fontSize: 12 }}>Início real <input type="date" value={startValue} onChange={e => setStartEdit(e.target.value)} /></label>
              <button
                type="button"
                className="mini-btn"
                disabled={scheduleMutation.isPending || !scheduleDirty}
                onClick={() => scheduleMutation.mutate({ approvedAt: isoOrNull(approvalValue), startDate: isoOrNull(startValue) })}
              >
                {scheduleMutation.isPending ? 'Salvando…' : 'Salvar'}
              </button>
            </span>
          </div>
          <div className="det-row">
            <span className="det-label">Mobilização / prazo</span>
            <span className="det-val">
              {leadDays != null ? `${leadDays} dia(s) p/ iniciar${mobilizationDeadline ? ` · até ${formatDatePt(mobilizationDeadline)}` : ''}` : 'Sem prazo de mobilização'}
              {mobilizationLate ? <strong style={{ color: '#b00020' }}> · ⚠ mobilização atrasada</strong> : null}
              {consumedPct != null ? ` · prazo consumido ${consumedPct}%` : ''}
            </span>
          </div>
        </>
      ) : null}
    </>
  );
}
