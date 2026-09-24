import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getProjectRevisions,
  removeProjectAdditionalRevision,
  setProjectAdditionalRevision,
  setProjectRevision
} from '../../api/acompanhamentoComercial';
import { Button, Select } from '../ui/ds';
import { useToast } from '../ui/ToastContext';

function formatBRL(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// No card do projeto fica APENAS a escolha da revisão da proposta. As datas de aprovação/início e
// o restante do acompanhamento são geridos no módulo Acompanhamento.
export function ProjectRevisionPicker({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const queryKey = ['commercial-revisions', projectId];

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => getProjectRevisions(projectId) });
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedAdditionals, setSelectedAdditionals] = useState<Record<string, number | null>>({});

  function refreshAcompanhamentoQueries() {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['commercial-pendencias'] });
    queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['project-cards'] });
    queryClient.invalidateQueries({ queryKey: ['project-detail'] });
    queryClient.invalidateQueries({ queryKey: ['planned-scope'] });
    queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] });
  }

  const mutation = useMutation({
    mutationFn: (codBd: number) => setProjectRevision(projectId, codBd),
    onSuccess: () => {
      showToast('Revisão do orçamento atualizada.');
      refreshAcompanhamentoQueries();
    },
    onError: () => showToast('Não foi possível atualizar a revisão.')
  });

  const additionalMutation = useMutation({
    mutationFn: (codBd: number) => setProjectAdditionalRevision(projectId, codBd),
    onSuccess: () => {
      showToast('Proposta adicional atualizada.');
      refreshAcompanhamentoQueries();
    },
    onError: () => showToast('Não foi possível atualizar a proposta adicional.')
  });

  const removeAdditionalMutation = useMutation({
    mutationFn: (codProp: number) => removeProjectAdditionalRevision(projectId, codProp),
    onSuccess: () => {
      showToast('Proposta adicional removida.');
      refreshAcompanhamentoQueries();
    },
    onError: () => showToast('Não foi possível remover a proposta adicional.')
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
  const additionalGroups = data?.additionalProposals ?? [];
  const current = data?.currentCodBd ?? null;
  if (revisions.length === 0 && additionalGroups.length === 0) return null;

  const chosen = selected ?? current ?? revisions[0]?.codBd ?? null;

  return (
    <div className="project-revision-picker">
      {revisions.length > 0 ? (
        <div className="det-row project-revision-picker__row">
          <span className="det-label">Revisão que vale</span>
          <span className="det-val det-inline-actions project-revision-picker__actions">
            <Select
              aria-label="Revisão que vale"
              className="project-revision-picker__select"
              containerClassName="project-revision-picker__shell"
              value={chosen ?? ''}
              onChange={event => setSelected(Number(event.target.value))}
            >
              {revisions.map(revision => (
                <option key={revision.codBd} value={revision.codBd}>
                  {`Rev ${revision.nRev} · ${formatBRL(revision.salePrice)}${revision.codBd === current ? ' (atual)' : ''}`}
                </option>
              ))}
            </Select>
            <Button
              className="project-revision-picker__button"
              variant="primary"
              size="sm"
              type="button"
              disabled={mutation.isPending || chosen === null || chosen === current}
              onClick={() => chosen !== null && mutation.mutate(chosen)}
            >
              {mutation.isPending ? 'Aplicando…' : 'Aplicar'}
            </Button>
          </span>
        </div>
      ) : null}

      {additionalGroups.map(group => {
        const proposalCode = Number(group.proposalCode);
        const additionalChosen = selectedAdditionals[group.proposalCode] ?? group.currentCodBd ?? group.revisions[0]?.codBd ?? null;
        return (
          <div className="det-row acp-additional-proposal-row project-revision-picker__row" key={group.proposalCode}>
            <span className="det-label">Proposta adicional {group.proposalCode}</span>
            <span className="det-val det-inline-actions project-revision-picker__actions">
              <Select
                aria-label={`Revisão da proposta adicional ${group.proposalCode}`}
                className="project-revision-picker__select"
                containerClassName="project-revision-picker__shell"
                value={additionalChosen ?? ''}
                onChange={event => setSelectedAdditionals(prev => ({
                  ...prev,
                  [group.proposalCode]: Number(event.target.value)
                }))}
              >
                {group.revisions.map(revision => (
                  <option key={revision.codBd} value={revision.codBd}>
                    {`Rev ${revision.nRev} · ${formatBRL(revision.salePrice)}${revision.codBd === group.currentCodBd ? ' (atual)' : ''}`}
                  </option>
                ))}
              </Select>
              <Button
                className="project-revision-picker__button"
                variant="primary"
                size="sm"
                type="button"
                disabled={additionalMutation.isPending || additionalChosen === null || additionalChosen === group.currentCodBd}
                onClick={() => additionalChosen !== null && additionalMutation.mutate(additionalChosen)}
              >
                {additionalMutation.isPending ? 'Aplicando…' : group.currentCodBd ? 'Aplicar' : 'Adicionar'}
              </Button>
              {group.currentCodBd ? (
                <Button
                  className="project-revision-picker__button"
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={removeAdditionalMutation.isPending || !Number.isInteger(proposalCode)}
                  onClick={() => Number.isInteger(proposalCode) && removeAdditionalMutation.mutate(proposalCode)}
                >
                  {removeAdditionalMutation.isPending ? 'Removendo…' : 'Remover'}
                </Button>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
