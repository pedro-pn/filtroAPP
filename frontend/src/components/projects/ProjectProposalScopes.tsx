import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assignProposalScope, fetchProposalScopes, type ProposalScopeService } from '../../api/proposalScopes';
import { Alert, Button, Field, Input, ProgressBar, Select, Spinner } from '../ui/ds';
import { useToast } from '../ui/ToastContext';

export function ProjectProposalScopes({ projectId, canManage = false }: { projectId: string; canManage?: boolean }) {
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<ProposalScopeService | null>(null);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ['proposal-scopes', projectId], queryFn: () => fetchProposalScopes(projectId) });
  const save = useMutation({
    mutationFn: () => assignProposalScope(projectId, editing!, target || null, reason),
    onSuccess: async () => { setEditing(null); await queryClient.invalidateQueries({ queryKey: ['proposal-scopes', projectId] }); await queryClient.invalidateQueries({ queryKey: ['databook'] }); },
    onError: error => toast(error instanceof Error ? error.message : 'Falha ao vincular serviço.', 'error')
  });
  if (query.isLoading) return <Spinner label="Carregando escopos por proposta" />;
  if (query.isError) return <Alert tone="danger" title="Não foi possível carregar os escopos." action={{ label: 'Tentar novamente', onClick: () => void query.refetch() }} />;
  if (!query.data) return null;
  const { scopes, services, pending } = query.data;
  const scope = scopes.find(item => item.key === selected);
  const shown = services.filter(item => !selected || !item.contributionKey || item.contributionKey === selected);
  return <section aria-label="Escopos por proposta">
    <h3>Escopo e execução por proposta</h3>
    <Field label="Proposta"><Select aria-label="Proposta do escopo" value={selected} onChange={e => setSelected(e.target.value)}>
      <option value="">Todas as propostas</option>
      {scopes.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
    </Select></Field>
    {pending ? <Alert tone="warning" title={`${pending} serviço(s) sem proposta definida`}>Vincule os serviços para incluí-los no Data Book de uma proposta específica.</Alert> : null}
    {scope ? <>
      {scope.parentProposalCode ? <p>Proposta mãe: {scope.parentProposalCode}</p> : null}
      <ProgressBar label="Avanço da proposta" value={scope.progress.progressPct} valueLabel={scope.progress.progressPct == null ? 'Sem meta' : `${scope.progress.progressPct}%`} />
      <ul>{scope.progress.services.flatMap(service => service.systems.map((system, i) => <li key={`${service.serviceType}-${i}`}>
        {service.serviceType} · {system.equipment ? `${system.equipment} · ` : ''}{system.systemName || system.systemType}: {system.realizedQty ?? 0} / {system.plannedQty ?? '—'} {system.unit}
      </li>))}</ul>
    </> : null}
    <p>Serviços dos relatórios aprovados. O vínculo também define o recorte do Data Book. Relatórios técnicos derivados seguem o serviço do RDO de origem.</p>
    <details><summary>Revisar vínculos dos serviços ({shown.length})</summary>
      <ul>{shown.map(item => <li key={`${item.reportId}-${item.serviceKey}`}>
        <strong>{item.reportType} {item.number}</strong> · {item.serviceType} {item.system} {item.count > 1 ? `(${item.count} registros iguais)` : ''}
        <p>{scopes.find(s => s.key === item.contributionKey)?.label || 'Sem proposta definida'} · {item.method === 'MANUAL' ? 'Vínculo manual' : 'Vínculo automático'}</p>
        {canManage ? <Button type="button" size="sm" variant="secondary" disabled={save.isPending} onClick={() => { setEditing(item); setTarget(item.contributionKey || selected); setReason(''); }}>Vincular proposta</Button> : null}
      </li>)}</ul>
    </details>
    {editing ? <div role="group" aria-label="Vincular serviço à proposta">
      <p>{editing.reportType} {editing.number} · {editing.serviceType} {editing.system}</p>
      <Field label="Proposta de origem"><Select value={target} onChange={e => setTarget(e.target.value)}>
        <option value="">Sem proposta definida</option>{scopes.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </Select></Field>
      <Field label="Motivo"><Input value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></Field>
      <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => setEditing(null)}>Cancelar</Button>
      <Button type="button" disabled={!reason.trim() || save.isPending} loading={save.isPending} onClick={() => save.mutate()}>Salvar vínculo</Button>
    </div> : null}
  </section>;
}
