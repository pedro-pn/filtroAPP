import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getProjectRevisions, setBudgetApprovalDate, setProjectRevision } from '../../api/acompanhamentoComercial';
import { useToast } from '../ui/Toast';

function formatBRL(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

// Escolha da revisão da proposta (comercial) + data de aprovação do contrato e prazo de mobilização.
// Aparece para projetos cujo contrato bate com propostas importadas.
export function ProjectRevisionPicker({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const queryKey = ['commercial-revisions', projectId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getProjectRevisions(projectId)
  });

  const [selected, setSelected] = useState<number | null>(null);
  const [approvalEdit, setApprovalEdit] = useState<string | null>(null);

  const revisionMutation = useMutation({
    mutationFn: (codBd: number) => setProjectRevision(projectId, codBd),
    onSuccess: () => {
      showToast('Revisão do orçamento atualizada.');
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['commercial-pendencias'] });
    },
    onError: () => showToast('Não foi possível atualizar a revisão.')
  });

  const approvalMutation = useMutation({
    mutationFn: (approvedAt: string | null) => setBudgetApprovalDate(projectId, approvedAt),
    onSuccess: () => {
      showToast('Data de aprovação atualizada.');
      setApprovalEdit(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: () => showToast('Não foi possível atualizar a data de aprovação.')
  });

  if (isLoading) {
    return (
      <div className="det-row">
        <span className="det-label">Revisões</span>
        <span className="det-val">Carregando…</span>
      </div>
    );
  }

  const revisions = data?.revisions ?? [];
  const current = data?.currentCodBd ?? null;
  if (revisions.length === 0) return null;

  const chosen = selected ?? current ?? revisions[0]?.codBd ?? null;

  const approvalValue = approvalEdit ?? toDateInput(data?.approvedAt);
  const leadDays = data?.mobilizationLeadDays ?? null;
  const mobilizationDeadline = approvalValue && leadDays != null ? addDays(approvalValue, leadDays) : '';

  return (
    <>
      <div className="det-row">
        <span className="det-label">Revisão que vale</span>
        <span className="det-val" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            id={`rev-${projectId}`}
            value={chosen ?? ''}
            onChange={event => setSelected(Number(event.target.value))}
          >
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

      {current != null ? (
        <>
          <div className="det-row">
            <span className="det-label">Aprovação do contrato</span>
            <span className="det-val" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="date"
                value={approvalValue}
                onChange={event => setApprovalEdit(event.target.value)}
              />
              <button
                type="button"
                className="mini-btn"
                disabled={approvalMutation.isPending || approvalValue === toDateInput(data?.approvedAt)}
                onClick={() => approvalMutation.mutate(approvalValue ? new Date(`${approvalValue}T00:00:00`).toISOString() : null)}
              >
                {approvalMutation.isPending ? 'Salvando…' : 'Salvar'}
              </button>
            </span>
          </div>
          <div className="det-row">
            <span className="det-label">Prazo de mobilização</span>
            <span className="det-val">
              {leadDays != null
                ? `${leadDays} dia(s) após a aprovação${mobilizationDeadline ? ` · iniciar até ${formatDatePt(mobilizationDeadline)}` : ''}`
                : '—'}
            </span>
          </div>
        </>
      ) : null}
    </>
  );
}
