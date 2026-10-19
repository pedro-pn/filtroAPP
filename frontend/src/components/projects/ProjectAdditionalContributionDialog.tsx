import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CommercialAppAdditionalProposals } from './CommercialAppAdditionalProposals';
import { getCommercialAppRevisions, getProjectRevisions, setProjectAdditionalRevision, type CommercialRevision } from '../../api/acompanhamentoComercial';
import { ADDITIONAL_PROPOSAL_METRICS, normalizeAdditionalMetricInclusion, type AdditionalMetricInclusion } from '../../../../shared/modules/additional-proposal-metrics.js';
import { Modal } from '../ui/Modal';
import { Alert, Button, Skeleton, Switch } from '../ui/ds';
import { useToast } from '../ui/ToastContext';
import './ProjectAdditionalContributionDialog.css';

function formatContribution(value: string | number | null | undefined, unit: 'dias' | 'BRL' | 'h') {
  if (value == null || value === '') return 'Não informado';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Não informado';
  return unit === 'BRL'
    ? amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : `${amount.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}

export function ProjectAdditionalContributionDialog({ projectId, proposalCode, source, canManage, onClose }: {
  projectId: string; proposalCode: string; source?: 'ACCESS_IMPORT' | 'COMERCIAL_APP'; canManage: boolean; onClose: () => void;
}) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['commercial-revisions', projectId], queryFn: () => getProjectRevisions(projectId)
  });
  const queryClient = useQueryClient();
  const app = useQuery({ queryKey: ['commercialapp-revisions', projectId], queryFn: () => getCommercialAppRevisions(projectId),
    enabled: source === 'COMERCIAL_APP' });
  if (source === 'COMERCIAL_APP') return <Modal open appearance="design-system" size="md"
    title={`Contribuição ComercialAPP ${proposalCode}`} onClose={onClose}>
    {app.isPending ? <Skeleton variant="text" lines={5} label="Carregando contribuição" />
      : app.isError ? <Alert tone="warning">Não foi possível carregar a contribuição.</Alert>
      : <CommercialAppAdditionalProposals projectId={projectId} items={(app.data?.items ?? []).filter(row => row.proposalCode === proposalCode)}
        canManage={canManage} showQuery={false} onSaved={() => {
          for (const key of [['commercialapp-revisions', projectId], ['commercial-dashboard'], ['project-cards'], ['project-detail'], ['planned-scope'], ['mission-group-detail']]) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        }} />}
  </Modal>;
  const group = data?.additionalProposals?.find(item => item.proposalCode === proposalCode);
  const revision = group?.revisions.find(item => item.codBd === group.currentCodBd);
  if (isPending || isError || !revision) return <Modal open appearance="design-system" size="md"
    title={`Contribuição da proposta adicional ${proposalCode}`} onClose={onClose}>
    {isPending ? <Skeleton variant="text" lines={5} label="Carregando contribuição" />
      : <Alert tone="warning" action={<Button size="sm" variant="secondary" onClick={() => void refetch()}>Tentar novamente</Button>}>
        {isError ? 'Não foi possível carregar a contribuição.' : 'Esta proposta adicional não está mais selecionada no projeto.'}
      </Alert>}
  </Modal>;
  return <ContributionEditor key={`${projectId}-${revision.codBd}`} projectId={projectId}
    proposalCode={proposalCode} revision={revision} selectionVersion={data?.additionalSelectionVersions?.[proposalCode] ?? 0} initialInclusion={group?.metricInclusion}
    percentage={data?.proposalPercentage ?? 100} canManage={canManage} onClose={onClose} />;
}

function ContributionEditor({ projectId, proposalCode, revision, selectionVersion, initialInclusion, percentage, canManage, onClose }: {
  projectId: string; proposalCode: string; revision: CommercialRevision; selectionVersion: number;
  initialInclusion?: AdditionalMetricInclusion; percentage: number; canManage: boolean; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [inclusion, setInclusion] = useState(() => normalizeAdditionalMetricInclusion(initialInclusion));
  const save = useMutation({
    mutationFn: () => setProjectAdditionalRevision(projectId, revision.codBd, inclusion, { expectedSelectionVersion: selectionVersion }),
    onSuccess: async () => {
      await Promise.all([
        ['commercial-revisions', projectId], ['commercial-dashboard'], ['project-cards'],
        ['project-detail'], ['planned-scope', projectId], ['mission-group-detail'], ['mission-groups']
      ].map(queryKey => queryClient.invalidateQueries({ queryKey })));
      showToast('Contribuição da proposta adicional salva.');
      onClose();
    }
  });
  return <Modal open appearance="design-system" size="md"
    title={`Contribuição da proposta adicional ${proposalCode}`}
    onClose={() => { if (!save.isPending) onClose(); }}
    footer={<>
      <Button variant="secondary" disabled={save.isPending} onClick={onClose}>{canManage ? 'Cancelar' : 'Fechar'}</Button>
      {canManage ? <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Salvando…' : 'Salvar contribuição'}
      </Button> : null}
    </>}>
    <div className="additional-contribution">
      <p>Rev {revision.nRev}. {canManage ? 'Marque os campos que esta proposta deve acrescentar às métricas do projeto.' : 'Confira os campos considerados nas métricas do projeto.'}</p>
      <p className="additional-contribution__hint">
        Os dias de trabalho são previstos na proposta. O orçamento inclui seu detalhamento por categoria.
        {percentage !== 100 ? ` O percentual de ${percentage.toLocaleString('pt-BR')}% do projeto também será aplicado aos valores considerados.` : ''}
      </p>
      {canManage ? <div className="additional-contribution__shortcuts">
        <Button variant="ghost" size="sm" disabled={save.isPending}
          onClick={() => setInclusion(normalizeAdditionalMetricInclusion())}>Considerar todos</Button>
        <Button variant="ghost" size="sm" disabled={save.isPending}
          onClick={() => setInclusion(Object.fromEntries(ADDITIONAL_PROPOSAL_METRICS.map(({ key }) => [key, false])) as AdditionalMetricInclusion)}>Desconsiderar todos</Button>
      </div> : null}
      <div className="additional-contribution__fields">
        {ADDITIONAL_PROPOSAL_METRICS.map(({ key, label, unit }) => {
          const value = key === 'hours' ? revision.plannedHours?.total : revision[key];
          const considered = value == null ? null : inclusion[key] ? Number(value) * percentage / 100 : 0;
          const descriptionId = `additional-${projectId}-${revision.codBd}-${key}`;
          return <Switch key={key} label={label} aria-label={label} aria-describedby={descriptionId}
            description={<span id={descriptionId}>{`Valor da revisão: ${formatContribution(value, unit)} · ${inclusion[key] ? `Considerado: ${formatContribution(considered, unit)}` : 'Desconsiderado'}`}</span>}
            checked={inclusion[key]} disabled={!canManage || save.isPending}
            onChange={event => setInclusion(current => ({ ...current, [key]: event.target.checked }))} />;
        })}
      </div>
      {save.isError ? <p role="alert">Não foi possível salvar. Tente novamente.</p> : null}
    </div>
  </Modal>;
}
