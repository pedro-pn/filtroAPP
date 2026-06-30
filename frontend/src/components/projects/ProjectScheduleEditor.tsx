import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getProjectRevisions, setProjectSchedule, type CommercialRevision } from '../../api/acompanhamentoComercial';
import { useToast } from '../ui/Toast';
import { ProjectPlannedScopeEditor } from './ProjectPlannedScopeEditor';
import { RealizedCategoryBreakdown } from './RealizedCategoryBreakdown';

function toNum(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function brl(value?: string | number | null) {
  const n = toNum(value);
  return n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function pct(value?: string | number | null) {
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

// Cronograma do projeto, gerido no módulo Acompanhamento (datas de aprovação e início real),
// junto do resumo do previsto. A escolha da revisão fica no card do projeto (aba Projetos).
export function ProjectScheduleEditor({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const queryKey = ['commercial-revisions', projectId];

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => getProjectRevisions(projectId) });
  const [approvalEdit, setApprovalEdit] = useState<string | null>(null);
  const [startEdit, setStartEdit] = useState<string | null>(null);

  const scheduleMutation = useMutation({
    mutationFn: (payload: { approvedAt?: string | null; startDate?: string | null }) => setProjectSchedule(projectId, payload),
    onSuccess: () => {
      showToast('Cronograma atualizado.');
      setApprovalEdit(null);
      setStartEdit(null);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] });
    },
    onError: () => showToast('Não foi possível atualizar o cronograma.')
  });

  if (isLoading) return <div className="placeholder-copy">Carregando…</div>;

  const current = data?.currentCodBd ?? null;
  const revisions = data?.revisions ?? [];
  const currentRevision: CommercialRevision | undefined = revisions.find(r => r.codBd === current) ?? undefined;

  if (current == null || !currentRevision) {
    return <div className="placeholder-copy">Aguardando seleção do contrato fechado pela gestão.</div>;
  }

  const approvalValue = approvalEdit ?? toDateInput(data?.approvedAt);
  const startValue = startEdit ?? toDateInput(data?.startDate);
  const leadDays = data?.mobilizationLeadDays ?? null;
  const deadline = approvalValue && leadDays != null ? addDays(approvalValue, leadDays) : '';
  const late = Boolean(startValue && deadline && startValue > deadline);
  const plannedDays = currentRevision.plannedDays ?? null;
  const consumed = startValue && plannedDays ? daysBetween(startValue, new Date()) : null;
  const consumedPct = consumed != null && plannedDays ? Math.round((consumed / plannedDays) * 100) : null;
  const dirty = approvalValue !== toDateInput(data?.approvedAt) || startValue !== toDateInput(data?.startDate);

  return (
    <div className="det-section">
      <div className="det-row"><span className="det-label">Previsto (comercial)</span>
        <span className="det-val">Venda {brl(currentRevision.salePrice)} · Custo {brl(currentRevision.plannedCost)} · Margem {pct(currentRevision.expectedMargin)}</span>
      </div>
      <div className="det-row"><span className="det-label">Dias / equipe</span>
        <span className="det-val">{currentRevision.plannedDays ?? '—'} corridos · {currentRevision.workedDays ?? '—'} trab. · {currentRevision.numOperators ?? '—'} op / {currentRevision.numSupervisors ?? '—'} enc · {currentRevision.numPerDay ?? '—'} d / {currentRevision.numPerNight ?? '—'} n</span>
      </div>

      <div className="admin-inline-grid" style={{ marginTop: 8 }}>
        <div className="field-group">
          <label htmlFor={`acp-aprov-${projectId}`}>Aprovação do contrato</label>
          <input id={`acp-aprov-${projectId}`} type="date" value={approvalValue} onChange={e => setApprovalEdit(e.target.value)} />
        </div>
        <div className="field-group">
          <label htmlFor={`acp-inicio-${projectId}`}>Início real</label>
          <input id={`acp-inicio-${projectId}`} type="date" value={startValue} onChange={e => setStartEdit(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="mini-btn"
          disabled={scheduleMutation.isPending || !dirty}
          onClick={() => scheduleMutation.mutate({ approvedAt: isoOrNull(approvalValue), startDate: isoOrNull(startValue) })}
        >
          {scheduleMutation.isPending ? 'Salvando…' : 'Salvar cronograma'}
        </button>
      </div>

      <div className="det-row" style={{ marginTop: 8 }}><span className="det-label">Mobilização / prazo</span>
        <span className="det-val">
          {leadDays != null ? `${leadDays} dia(s) p/ iniciar${deadline ? ` · até ${formatDatePt(deadline)}` : ''}` : 'Sem prazo de mobilização'}
          {late ? <strong style={{ color: '#b00020' }}> · ⚠ mobilização atrasada</strong> : null}
          {consumedPct != null ? ` · prazo consumido ${consumedPct}%` : ''}
        </span>
      </div>

      <div className="acp-scope-divider" />
      <ProjectPlannedScopeEditor projectId={projectId} />

      <div className="sec" style={{ marginTop: 16 }}>Realizado por categoria (Omie)</div>
      <RealizedCategoryBreakdown projectId={projectId} limit={10} />
    </div>
  );
}
