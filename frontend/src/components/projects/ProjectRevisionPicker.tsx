import { BrandLoading } from '../brand/BrandLoading';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getCommercialAppRevisions,
  getProjectRevisions,
  removeProjectAdditionalRevision,
  selectCommercialAppRevision,
  setProjectAdditionalRevision,
  setProjectRevision
} from '../../api/acompanhamentoComercial';
import { CommercialAppAdditionalProposals } from './CommercialAppAdditionalProposals';
import { Button, Select, Input } from '../ui/ds';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { RemoveIconButton } from '../ui/RemoveIconButton';
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
  const { data: appData, isLoading: appLoading } = useQuery({
    queryKey: ['commercialapp-revisions', projectId],
    queryFn: () => getCommercialAppRevisions(projectId),
    refetchInterval: query => query.state.data?.queries?.some(job => ['PENDING', 'APPLYING'].includes(job.status)) ? 2000
      : query.state.data?.queries?.some(job => job.status === 'ERROR') ? 10000 : false
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedApp, setSelectedApp] = useState('');
  const [removeAccess, setRemoveAccess] = useState<number | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [oldAccess, setOldAccess] = useState<{ codBd: number; version: number } | null>(null);
  const [oldAccessReason, setOldAccessReason] = useState('');
  const [pendingAppRevision, setPendingAppRevision] = useState<{ externalId: string; label: string } | null>(null);
  const [selectedAdditionals, setSelectedAdditionals] = useState<Record<string, number | null>>({});

  function refreshAcompanhamentoQueries() {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['commercialapp-revisions', projectId] });
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
    mutationFn: ({ codBd, version, reason }: { codBd: number; version: number; reason?: string }) =>
      setProjectAdditionalRevision(projectId, codBd, undefined, { expectedSelectionVersion: version,
        allowOlderRevision: Boolean(reason), reason }),
    onSuccess: () => {
      setOldAccess(null); setOldAccessReason('');
      showToast('Proposta adicional atualizada.');
      refreshAcompanhamentoQueries();
    },
    onError: () => showToast('Não foi possível atualizar a proposta adicional.')
  });

  const removeAdditionalMutation = useMutation({
    mutationFn: (codProp: number) => removeProjectAdditionalRevision(projectId, codProp, data?.additionalSelectionVersions?.[codProp] ?? 1, removeReason),
    onSuccess: () => {
      setRemoveAccess(null); setRemoveReason('');
      showToast('Proposta adicional removida.');
      refreshAcompanhamentoQueries();
    },
    onError: () => showToast('Não foi possível remover a proposta adicional.')
  });

  const appMutation = useMutation({
    mutationFn: ({ externalId, replaceLegacy }: { externalId: string; replaceLegacy: boolean }) =>
      selectCommercialAppRevision(projectId, externalId, replaceLegacy),
    onSuccess: result => {
      const outcome = result.scopeImport?.status;
      showToast(outcome === 'PARTIAL' || outcome === 'NEEDS_REVIEW'
        ? 'Revisão selecionada. Confira as pendências do escopo no cronograma.'
        : outcome === 'MANUAL_PRESERVED'
          ? 'Revisão selecionada. O escopo editado manualmente foi preservado.'
          : 'Revisão do ComercialAPP aplicada ao orçamento e ao escopo previsto.');
      refreshAcompanhamentoQueries();
    },
    onError: () => showToast('Não foi possível selecionar a revisão do ComercialAPP.')
  });

  if (isLoading || appLoading) {
    return (
      <div className="det-row">
        <span className="det-label">Proposta</span>
        <span className="det-val"><BrandLoading label="Carregando" inline size="sm" /></span>
      </div>
    );
  }

  const revisions = data?.revisions ?? [];
  const appRevisions = (appData?.items ?? []).filter(row => row.proposalKind !== 'ADDITIONAL');
  const appAdditionals = (appData?.items ?? []).filter(row => row.proposalKind === 'ADDITIONAL');
  const additionalGroups = data?.additionalProposals ?? [];
  const current = data?.currentCodBd ?? null;


  const chosen = selected ?? current ?? revisions[0]?.codBd ?? null;
  const currentApp = appRevisions.find(item => item.selectionStatus === 'SELECTED');
  const chosenApp = selectedApp || currentApp?.externalId || appRevisions[0]?.externalId || '';

  return (
    <div className="project-revision-picker">
      {appRevisions.length > 0 ? <div className="det-row project-revision-picker__row">
        <span className="det-label">Principal · ComercialAPP</span>
        <span className="det-val det-inline-actions project-revision-picker__actions">
          <Select
            aria-label="Revisão do ComercialAPP"
            className="project-revision-picker__select"
            containerClassName="project-revision-picker__shell"
            value={chosenApp}
            onChange={event => setSelectedApp(event.target.value)}
          >
            {appRevisions.map(item => <option key={item.externalId} value={item.externalId}>
              {`${item.proposalCode} Rev ${item.revisionNumber} · ${formatBRL(item.salePrice)}${item.selectionStatus === 'SELECTED' ? ' (atual)' : ' (aguardando)'}`}
            </option>)}
          </Select>
          <Button type="button" className="project-revision-picker__button" variant="primary" size="sm"
            disabled={appMutation.isPending || !chosenApp}
            onClick={() => {
              if (!chosenApp) return;
              const replaceLegacy = Boolean(appData?.budgetSource &&
                appData.budgetSource !== 'COMERCIAL_APP');
              if (replaceLegacy) {
                const revision = appRevisions.find(item => item.externalId === chosenApp);
                setPendingAppRevision({
                  externalId: chosenApp,
                  label: revision ? `${revision.proposalCode} · Rev ${revision.revisionNumber}` : chosenApp
                });
                return;
              }
              appMutation.mutate({ externalId: chosenApp, replaceLegacy });
            }}>
            {appMutation.isPending ? 'Aplicando…'
              : chosenApp === currentApp?.externalId ? 'Sincronizar escopo' : 'Aplicar'}
          </Button>
        </span>
      </div> : null}
      {revisions.length > 0 ? (
        <div className="det-row project-revision-picker__row">
          <span className="det-label">Principal · Access</span>
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
            <span className="det-label">Adicional {group.proposalCode} · Mãe {group.parentProposalCode} · Access</span>
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
                onClick={() => {
                  if (additionalChosen === null) return;
                  const version = data?.additionalSelectionVersions?.[group.proposalCode] ?? 0;
                  const previous = group.revisions.find(row => row.codBd === group.currentCodBd);
                  const next = group.revisions.find(row => row.codBd === additionalChosen);
                  if (previous && next && previous.nRev > next.nRev) {
                    setOldAccess({ codBd: additionalChosen, version }); setOldAccessReason('');
                  } else additionalMutation.mutate({ codBd: additionalChosen, version });
                }}
              >
                {additionalMutation.isPending ? 'Aplicando…' : group.currentCodBd ? 'Aplicar' : 'Adicionar'}
              </Button>
              {group.currentCodBd ? (
                <RemoveIconButton
                  className="project-revision-picker__button"
                  label="Remover revisão adicional"
                  disabled={removeAdditionalMutation.isPending || !Number.isInteger(proposalCode)}
                  loading={removeAdditionalMutation.isPending}
                  onClick={() => { if (Number.isInteger(proposalCode)) { setRemoveAccess(proposalCode); setRemoveReason(''); } }}
                />
              ) : null}
            </span>
          </div>
        );
      })}
      <CommercialAppAdditionalProposals projectId={projectId} items={appAdditionals} queries={appData?.queries} onSaved={refreshAcompanhamentoQueries} />
      <ConfirmDialog open={oldAccess !== null} appearance="design-system" title="Selecionar revisão Access anterior?"
        confirmLabel="Selecionar revisão anterior" danger={false} confirmDisabled={additionalMutation.isPending || !oldAccessReason.trim()}
        onConfirm={() => oldAccess && additionalMutation.mutate({ ...oldAccess, reason: oldAccessReason })} onCancel={() => setOldAccess(null)}>
        <label htmlFor="old-access-reason">Motivo obrigatório</label>
        <Input id="old-access-reason" value={oldAccessReason} maxLength={1000} onChange={event => setOldAccessReason(event.target.value)} />
      </ConfirmDialog>
      <ConfirmDialog open={removeAccess !== null} appearance="design-system" title="Remover contribuição adicional?"
        description="O histórico da contribuição será preservado." confirmLabel="Confirmar remoção"
        confirmDisabled={removeAdditionalMutation.isPending || !removeReason.trim()}
        onConfirm={() => removeAccess !== null && removeAdditionalMutation.mutate(removeAccess)} onCancel={() => setRemoveAccess(null)}>
        <label htmlFor="remove-additional-reason">Motivo da remoção</label>
        <Input id="remove-additional-reason" value={removeReason} maxLength={1000} onChange={event => setRemoveReason(event.target.value)} />
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(pendingAppRevision)}
        appearance="design-system"
        title="Substituir revisão do orçamento?"
        description="O orçamento atual vem do Access. Selecione esta revisão do ComercialAPP para o projeto."
        highlight={pendingAppRevision?.label}
        confirmLabel="Selecionar revisão"
        danger={false}
        confirmDisabled={appMutation.isPending}
        onConfirm={() => {
          if (!pendingAppRevision) return;
          appMutation.mutate({ externalId: pendingAppRevision.externalId, replaceLegacy: true });
          setPendingAppRevision(null);
        }}
        onCancel={() => setPendingAppRevision(null)}
      />
    </div>
  );
}
