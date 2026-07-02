import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getProjectRevisions, setProjectRevision } from '../../api/acompanhamentoComercial';
import { useToast } from '../ui/ToastContext';

function formatBRL(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// No card do projeto fica APENAS a escolha da revisão da proposta. As datas de aprovação/início e
// o restante do acompanhamento são geridos no módulo Acompanhamento.
export function ProjectRevisionPicker({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const queryKey = ['commercial-revisions', projectId];

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => getProjectRevisions(projectId) });
  const [selected, setSelected] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: (codBd: number) => setProjectRevision(projectId, codBd),
    onSuccess: () => {
      showToast('Revisão do orçamento atualizada.');
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['commercial-pendencias'] });
      queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] });
    },
    onError: () => showToast('Não foi possível atualizar a revisão.')
  });

  if (isLoading) {
    return (
      <div className="det-row">
        <span className="det-label">Proposta</span>
        <span className="det-val">Carregando…</span>
      </div>
    );
  }

  const revisions = data?.revisions ?? [];
  const current = data?.currentCodBd ?? null;
  if (revisions.length === 0) return null;

  const chosen = selected ?? current ?? revisions[0]?.codBd ?? null;

  return (
    <div className="det-row">
      <span className="det-label">Revisão que vale</span>
      <span className="det-val det-inline-actions">
        <select value={chosen ?? ''} onChange={event => setSelected(Number(event.target.value))}>
          {revisions.map(revision => (
            <option key={revision.codBd} value={revision.codBd}>
              {`Rev ${revision.nRev} · ${formatBRL(revision.salePrice)}${revision.codBd === current ? ' (atual)' : ''}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="mini-btn"
          disabled={mutation.isPending || chosen === null || chosen === current}
          onClick={() => chosen !== null && mutation.mutate(chosen)}
        >
          {mutation.isPending ? 'Aplicando…' : 'Aplicar'}
        </button>
      </span>
    </div>
  );
}
