import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../../api/client';
import { assignProposalScope, fetchProposalScopes, type ProposalScopeService } from '../../api/proposalScopes';
import { Alert, Badge, Button, EmptyState, Field, Input, ProgressBar, Select, Spinner } from '../ui/ds';
import { useToast } from '../ui/ToastContext';
import { fmtDate, SERVICE_LABELS, SYSTEM_LABELS, UNIT_LABELS } from './projectDetailModel';
import './ProjectProposalScopes.css';

const serviceLabel = (type: string) => SERVICE_LABELS[type] || ({ limpeza: 'Limpeza química', pressao: 'Teste de pressão',
  flushing: 'Flushing', filtragem: 'Filtragem' } as Record<string, string>)[type] || type;
const serviceIdentity = (service: ProposalScopeService) => service.reportId + ':' + service.serviceKey;
const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function ProjectProposalScopes({ projectId, canManage = false, onEditingChange }: {
  projectId: string;
  canManage?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [selected, setSelected] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ProposalScopeService | null>(null);
  const [target, setTarget] = useState('');
  const id = useId();
  const proposalRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ['proposal-scopes', projectId], queryFn: () => fetchProposalScopes(projectId) });
  const save = useMutation({
    mutationFn: ({ service, contributionKey }: { service: ProposalScopeService; contributionKey: string | null }) =>
      assignProposalScope(projectId, service, contributionKey),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['proposal-scopes', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['databook'] }),
        queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project-progress', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] })
      ]);
      setEditing(null);
      onEditingChange?.(false);
      headingRef.current?.focus({ preventScroll: true });
      toast('Vínculo do ' + variables.service.reportType + ' ' + variables.service.number + ' salvo.');
    }
  });
  useEffect(() => { if (editing) proposalRef.current?.focus({ preventScroll: true }); }, [editing]);

  function cancelEdit() {
    setEditing(null);
    onEditingChange?.(false);
    save.reset();
    triggerRef.current?.focus({ preventScroll: true });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !canManage || save.isPending) return;
    save.mutate({ service: editing, contributionKey: target || null });
  }

  async function refreshService() {
    const result = await query.refetch();
    if (!result.data || result.isError) return;
    const fresh = result.data.services.find(service => editing && serviceIdentity(service) === serviceIdentity(editing));
    if (fresh) { setEditing(fresh); save.reset(); }
    else { cancelEdit(); toast('O serviço foi alterado. Selecione-o novamente na lista.', 'info'); }
  }

  if (query.isLoading) return <Spinner label="Carregando escopos por proposta" />;
  if (query.isError && !query.data) return <Alert tone="danger" title="Não foi possível carregar os escopos."
    action={{ label: 'Tentar novamente', onClick: () => void query.refetch() }} />;
  if (!query.data) return null;
  const { scopes, services, pending } = query.data;
  const scope = scopes.find(item => item.key === selected);
  const term = searchable(search.trim());
  const shown = services.filter(item => editing && serviceIdentity(item) === serviceIdentity(editing) || (
    (!selected || !item.contributionKey || item.contributionKey === selected)
    && (!pendingOnly || !item.contributionKey)
    && (!term || searchable([item.reportType, item.number, serviceLabel(item.serviceType), item.system, fmtDate(item.date)].join(' ')).includes(term))
  ));
  const conflict = save.error instanceof ApiClientError && save.error.status === 409;

  return <section className="proposal-scopes" aria-label="Escopos por proposta">
    <header className="proposal-scopes__heading">
      <div><h3>Escopo e execução por proposta</h3><p>Confira a proposta de origem dos serviços que entram no Data Book.</p></div>
      {!canManage ? <Badge tone="neutral">Somente consulta</Badge> : null}
    </header>
    <Field label="Proposta" optionalText=""><Select aria-label="Proposta do escopo" value={selected}
      disabled={Boolean(editing)} onChange={event => setSelected(event.target.value)}>
      <option value="">Todas as propostas</option>
      {scopes.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
    </Select></Field>
    {scope ? <section className="proposal-scopes__progress" aria-label="Avanço da proposta selecionada">
      <div className="proposal-scopes__progress-head"><strong>{scope.label}</strong>
        {scope.parentProposalCode ? <span>Principal: {scope.parentProposalCode}</span> : null}</div>
      <ProgressBar label="Avanço da proposta" value={scope.progress.progressPct}
        valueLabel={scope.progress.progressPct == null ? 'Sem meta' : scope.progress.progressPct + '%'} />
      {scope.progress.services.length ? <ul className="proposal-scopes__quantities">
        {scope.progress.services.flatMap(service => service.systems.map((system, index) => <li key={service.serviceType + '-' + index}>
          <span>{serviceLabel(service.serviceType)} · {[system.equipment, system.systemName || SYSTEM_LABELS[system.systemType] || system.systemType].filter(Boolean).join(' · ')}</span>
          <strong>{system.realizedQty ?? 0} / {system.plannedQty ?? '—'} {UNIT_LABELS[system.unit || ''] || system.unit || ''}</strong>
        </li>))}
      </ul> : <p>Esta proposta ainda não tem escopo previsto vinculado.</p>}
    </section> : null}
    <div className="proposal-scopes__services-head">
      <div><h3 ref={headingRef} tabIndex={-1}>Vínculos dos serviços</h3>
        <p>{pending ? pending + (pending === 1 ? ' serviço sem proposta definida' : ' serviços sem proposta definida') : 'Todos os serviços têm proposta definida.'}</p></div>
      <Badge tone={pending ? 'warning' : 'success'}>{pending ? pending + ' pendente' + (pending === 1 ? '' : 's') : 'Em dia'}</Badge>
    </div>
    <div className="proposal-scopes__toolbar">
      <Field label="Buscar serviço ou RDO" optionalText=""><Input type="search" aria-label="Buscar serviço ou RDO" placeholder="Ex.: vaso, TAG ou número do RDO"
        value={search} disabled={Boolean(editing)} onChange={event => setSearch(event.target.value)} /></Field>
      <div className="proposal-scopes__filters" role="group" aria-label="Filtrar vínculos">
        <Button size="sm" variant={!pendingOnly ? 'primary' : 'secondary'} aria-pressed={!pendingOnly}
          disabled={Boolean(editing)} onClick={() => setPendingOnly(false)}>Todos ({services.length})</Button>
        <Button size="sm" variant={pendingOnly ? 'primary' : 'secondary'} aria-pressed={pendingOnly}
          disabled={Boolean(editing)} onClick={() => setPendingOnly(true)}>Pendentes ({pending})</Button>
      </div>
    </div>
    <p className="proposal-scopes__context">Relatórios técnicos derivados acompanham o serviço do RDO de origem.</p>
    {!shown.length ? <EmptyState variant={search ? 'search' : 'default'} title={pendingOnly && !pending ? 'Nenhum vínculo pendente' : 'Nenhum serviço encontrado'}
      description="Ajuste a busca ou os filtros para consultar os serviços deste projeto." /> : null}
    <ul className="proposal-scopes__services" aria-label="Serviços e propostas de origem">
      {shown.map(item => {
        const identity = serviceIdentity(item);
        const isEditing = editing && serviceIdentity(editing) === identity;
        const proposal = scopes.find(option => option.key === item.contributionKey);
        return <li className={'proposal-scopes__service' + (isEditing ? ' proposal-scopes__service--editing' : '')} key={identity}>
          <div className="proposal-scopes__service-head">
            <div className="proposal-scopes__report"><strong>{item.reportType} {item.number}</strong><span>{fmtDate(item.date)}</span>
              {item.count > 1 ? <span>{item.count} registros iguais</span> : null}</div>
            <Badge tone={!item.contributionKey ? 'warning' : 'neutral'}>{!item.contributionKey ? 'Sem proposta' : item.method === 'MANUAL' ? 'Vínculo manual' : 'Vínculo automático'}</Badge>
          </div>
          <div className="proposal-scopes__service-body">
            <div className="proposal-scopes__service-description"><h4>{serviceLabel(item.serviceType)}</h4>
              <p>{item.system || 'Sistema não informado'}</p><span>{proposal?.label || 'Escolha a proposta de origem deste serviço.'}</span></div>
            {canManage ? <Button size="sm" variant={isEditing || item.contributionKey ? 'secondary' : 'primary'} disabled={Boolean(editing) && !isEditing || save.isPending}
              aria-expanded={Boolean(isEditing)} aria-controls={id + '-' + identity} onClick={event => {
                if (isEditing) { cancelEdit(); return; }
                triggerRef.current = event.currentTarget;
                save.reset(); setEditing(item); setTarget(item.contributionKey || selected); onEditingChange?.(true);
              }}>{isEditing ? 'Cancelar edição' : item.contributionKey ? 'Alterar vínculo' : 'Vincular proposta'}</Button> : null}
          </div>
          {isEditing ? <form id={id + '-' + identity} className="proposal-scopes__editor" aria-label="Vincular serviço à proposta" onSubmit={submit}
            onKeyDown={event => { if (event.key === 'Escape' && !save.isPending) { event.preventDefault(); event.stopPropagation(); cancelEdit(); } }}>
            <div><h4>Proposta de origem · {item.reportType} {item.number}</h4>
              <p>O vínculo organiza o Data Book e preserva o relatório aprovado.</p></div>
            <Field label="Proposta de origem" optionalText=""><Select ref={proposalRef} value={target} disabled={save.isPending} onChange={event => setTarget(event.target.value)}>
              <option value="">Sem proposta definida</option>{scopes.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </Select></Field>
            {save.isError ? <Alert tone="danger" title="Não foi possível salvar o vínculo."
              action={conflict ? { label: 'Atualizar serviço', onClick: () => void refreshService() } : undefined}>
              {save.error instanceof Error ? save.error.message : 'Tente novamente.'}
            </Alert> : null}
            <div className="proposal-scopes__editor-actions">
              <Button variant="secondary" disabled={save.isPending} onClick={cancelEdit}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={save.isPending} loadingLabel="Salvando vínculo">Salvar vínculo</Button>
            </div>
          </form> : null}
        </li>;
      })}
    </ul>
  </section>;
}
