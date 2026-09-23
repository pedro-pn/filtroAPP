import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getRdoSimulationCollaborators,
  setRdoSimulationExcluded,
  type RdoSimulationCollaborator
} from '../../api/acompanhamentoPonto';
import { createSearchMatcher } from '../../utils/search';
import { Button } from '../ui/Button';
import { useToast } from '../ui/ToastContext';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';

const queryKey = ['ponto-rdo-simulation-collaborators'];

export function RdoSimulationExclusionsPanel() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const { data: collaborators = [], isPending, isError, refetch } = useQuery({
    queryKey,
    queryFn: getRdoSimulationCollaborators,
    ...acompanhamentoRefreshQueryOptions
  });
  const mutation = useMutation({
    mutationFn: setRdoSimulationExcluded,
    onSuccess: async updated => {
      queryClient.setQueryData<RdoSimulationCollaborator[]>(queryKey, current =>
        current?.map(collaborator => collaborator.id === updated.id ? { ...collaborator, ...updated } : collaborator)
      );
      showToast(updated.rdoCostSimulationExcluded
        ? 'Colaborador excluído da simulação por RDO.'
        : 'Colaborador incluído na simulação por RDO.', 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ['project-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] })
      ]);
    },
    onError: (error: Error) => {
      showToast(error.message || 'Não foi possível salvar a preferência de simulação.', 'error');
    }
  });
  const matches = createSearchMatcher(search);
  const visible = collaborators.filter(collaborator =>
    matches([collaborator.name, collaborator.code, collaborator.jobRole?.name])
    && (filter === 'all' || collaborator.rdoCostSimulationExcluded === (filter === 'excluded'))
  );
  const excludedCount = collaborators.filter(collaborator => collaborator.rdoCostSimulationExcluded).length;

  return (
    <section className="det-section ponto-employee-section" aria-labelledby="rdo-simulation-title">
      <div id="rdo-simulation-title" className="sec ponto-subtitle">Simulação por RDO</div>
      <p className="placeholder-copy ponto-section-copy">
        Escolha quem deve ficar sem custo simulado quando houver horas em RDOs sem apropriação pelo ponto.
        A escolha vale para todos os acompanhamentos, inclusive períodos anteriores.
        As horas dos RDOs e os custos calculados pelo ponto são preservados. Você pode reincluir o colaborador a qualquer momento.
      </p>
      <div className="ponto-filter-row">
        <div className="field-group ponto-filter-grow">
          <label htmlFor="rdo-simulation-search">Buscar colaborador</label>
          <input
            id="rdo-simulation-search"
            type="search"
            placeholder="Nome, código ou cargo"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
        <div className="field-group">
          <label htmlFor="rdo-simulation-filter">Simulação</label>
          <select id="rdo-simulation-filter" value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">Todos</option>
            <option value="excluded">Excluídos do cálculo</option>
            <option value="included">Incluídos no cálculo</option>
          </select>
        </div>
      </div>
      {isPending ? <p className="placeholder-copy" role="status">Carregando colaboradores…</p> : null}
      {isError ? (
        <div role="alert">
          <p className="field-error">Não foi possível carregar as preferências de simulação.</p>
          <Button variant="secondary" onClick={() => void refetch()}>Tentar novamente</Button>
        </div>
      ) : null}
      {!isPending && !isError ? (
        <>
          <p className="placeholder-copy" role="status">
            {excludedCount} de {collaborators.length} colaborador(es) excluído(s) da simulação.
          </p>
          <div className="ponto-local-scroll ponto-employee-directory" role="region" aria-label="Preferências de simulação por colaborador" tabIndex={0}>
            {visible.map(collaborator => (
              <div key={collaborator.id} className="ponto-employee-row">
                <div className="ponto-link-copy">
                  <strong>{collaborator.name}</strong>
                  <span>
                    {collaborator.code}{collaborator.jobRole?.name ? ` · ${collaborator.jobRole.name}` : ''}
                    {collaborator.isActive ? '' : ' · Inativo'}
                  </span>
                  <span>{collaborator.rdoCostSimulationExcluded ? 'Excluído do cálculo simulado' : 'Incluído no cálculo simulado'}</span>
                </div>
                <Button
                  variant="secondary"
                  disabled={mutation.isPending}
                  aria-label={`${collaborator.rdoCostSimulationExcluded ? 'Reincluir' : 'Excluir'} ${collaborator.name} ${collaborator.rdoCostSimulationExcluded ? 'no' : 'do'} cálculo simulado`}
                  onClick={() => mutation.mutate({ collaboratorId: collaborator.id, excluded: !collaborator.rdoCostSimulationExcluded })}
                >
                  {mutation.isPending && mutation.variables?.collaboratorId === collaborator.id
                    ? 'Salvando…'
                    : collaborator.rdoCostSimulationExcluded ? 'Reincluir no cálculo' : 'Excluir do cálculo'}
                </Button>
              </div>
            ))}
            {!visible.length ? <p className="placeholder-copy">Nenhum colaborador encontrado.</p> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
