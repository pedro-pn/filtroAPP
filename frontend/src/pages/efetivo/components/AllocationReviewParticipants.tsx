import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listReviewParticipants, REVIEW_PARTICIPANTS_QUERY_KEY, updateReviewParticipation, type ReviewParticipant } from '../../../api/efetivoReviewParticipation';
import { Card, DataTable, EmptyState, SearchInput, Skeleton, Switch, type DataTableColumn } from '../../../components/ui/ds';
import { useToast } from '../../../components/ui/ToastContext';
import { useUsefulQueryContent } from '../../../observability/useUsefulContent';

function ParticipationToggle({ person, canManage }: { person: ReviewParticipant; canManage: boolean }) {
  const client = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => updateReviewParticipation(person.id, enabled, person.version),
    onSuccess: async updated => {
      client.setQueryData<ReviewParticipant[]>([REVIEW_PARTICIPANTS_QUERY_KEY], people => people?.map(item => item.id === updated.id ? updated : item));
      await Promise.all(['allocation-review-week', 'allocation-review-month', 'allocation-review-pending', 'efetivo-planning-activity']
        .map(key => client.invalidateQueries({ queryKey: [key] })));
    },
    onError: async (error: Error) => {
      toast(error.message || 'Não foi possível alterar a participação.', 'error');
      await client.invalidateQueries({ queryKey: [REVIEW_PARTICIPANTS_QUERY_KEY] });
    }
  });
  return <Switch label="Participa da conferência" aria-label={`Incluir ${person.name} na conferência`}
    checked={person.allocationReviewEnabled} disabled={!canManage || mutation.isPending}
    onChange={event => mutation.mutate(event.target.checked)} />;
}

export function AllocationReviewParticipants({ canManage }: { canManage: boolean }) {
  const query = useQuery({ queryKey: [REVIEW_PARTICIPANTS_QUERY_KEY], queryFn: listReviewParticipants });
  useUsefulQueryContent('efetivo:administracao', 'AllocationReviewParticipants', [query]);
  const [search, setSearch] = useState('');
  const people = useMemo(() => {
    const normalized = search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
    return (query.data || []).filter(person => `${person.name} ${person.code} ${person.jobRole}`
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').includes(normalized));
  }, [query.data, search]);
  const status = (person: ReviewParticipant) => person.rhStatus === 'PRE_ADMISSION' ? 'Pré-admissão' : person.isActive ? 'Ativo' : 'Inativo';
  const columns: DataTableColumn<ReviewParticipant>[] = [
    { key: 'name', header: 'Colaborador', rowHeader: true, render: person => <span className="efetivo-review-participant-name"><strong>{person.name}</strong><small>{person.code}</small></span> },
    { key: 'jobRole', header: 'Função', render: person => person.jobRole },
    { key: 'status', header: 'Vínculo', sortable: false, render: status },
    { key: 'participation', header: 'Conferência', sortable: false, render: person => <ParticipationToggle person={person} canManage={canManage} /> }
  ];
  return <Card className="efetivo-administration-section">
    <div className="efetivo-section-heading"><div><h2>Colaboradores na conferência</h2>
      <p>Somente colaboradores classificados como operacionais. Ative ou desative a participação; a alteração é salva automaticamente.</p>
      <p>A conferência respeita as datas do vínculo. Novos cadastros começam com a participação desativada.</p>
    </div></div>
    <SearchInput value={search} onChange={setSearch} aria-label="Buscar colaborador na administração da conferência" placeholder="Nome, código ou função" />
    {query.isLoading ? <Skeleton variant="card" /> : query.isError ? <EmptyState variant="error" title="Não foi possível carregar os colaboradores." action={{ label: 'Tentar novamente', onClick: () => void query.refetch() }} /> :
      <DataTable rows={people} columns={columns} getRowId={person => person.id}
        caption="Participação dos colaboradores operacionais" ariaLabel="Participação dos colaboradores operacionais"
        emptyState={<EmptyState title="Nenhum colaborador operacional encontrado." />}
        mobile={{ renderItem: person => ({ title: person.name, subtitle: `${person.code} · ${person.jobRole}`, metadata: [{ label: 'Vínculo', value: status(person) }], actions: <ParticipationToggle person={person} canManage={canManage} /> }) }} />}
  </Card>;
}
