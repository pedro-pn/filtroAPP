import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import axios from 'axios';

import {
  createMissionGroup,
  dissolveMissionGroup,
  getProjectCards,
  renameMissionGroup,
  setProjectTrackingState,
  updateMissionGroupLaborPolicy,
  type MissionGroupCard,
  type MissionGroupLaborAllocationMode,
  type ProjectCardItem
} from '../../api/acompanhamentoComercial';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ProjectDetailDashboard } from './ProjectDetailDashboard';
import { ProjectGroupRenameNovelty } from './ProjectGroupRenameNovelty';
import { ProjectLaborPolicyNovelty } from './ProjectLaborPolicyNovelty';
import { ProjectTrackingNovelties } from './ProjectTrackingNovelties';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';
import {
  cardMatchesView,
  parseCardsView,
  type CardsView
} from './projectCardViews';
import type { AuthUser } from '../../types/auth';
import {
  hasSeenAcompanhamentoFinalizedMission,
  markAcompanhamentoFinalizedMissionSeen
} from '../../auth/moduleNavigation';

import { Alert, EmptyState, Skeleton } from '../ui/ds';
import { isGroupCard, cardKey } from './projectCardFormatting';
import { ProjectOverviewCard } from './ProjectOverviewCard';
import { ProjectCardsToolbar } from './ProjectCardsToolbar';
import './ProjectCardsBoard.ds.css';

function mutationErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ error?: string }>(error)) {
    const message = error.response?.data?.error;
    if (message) return message;
  }
  return fallback;
}

type SelectedDetail = { kind: 'PROJECT'; id: string } | { kind: 'GROUP'; id: string };

function selectedDetailFromParams(params: URLSearchParams): SelectedDetail | null {
  const groupId = params.get('group')?.trim();
  if (groupId) return { kind: 'GROUP', id: groupId };
  const projectId = params.get('project')?.trim();
  return projectId ? { kind: 'PROJECT', id: projectId } : null;
}

export function ProjectCardsBoard({
  canManage = false,
  canManageGroups = false,
  canManageManualCosts = false,
  canManageProjectNotes = false,
  progressHistoryNoveltyUser = null
}: {
  canManage?: boolean;
  canManageGroups?: boolean;
  canManageManualCosts?: boolean;
  canManageProjectNotes?: boolean;
  progressHistoryNoveltyUser?: Pick<AuthUser, 'id'> | null;
}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const view = parseCardsView(searchParams.get('cards'));
  const selected = selectedDetailFromParams(searchParams);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedForGroup, setSelectedForGroup] = useState<Set<string>>(() => new Set());
  const [groupError, setGroupError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<MissionGroupCard | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [groupRenameNoveltyActive, setGroupRenameNoveltyActive] = useState(true);
  const [laborPolicyNoveltyActive, setLaborPolicyNoveltyActive] = useState(true);
  const [dissolveTarget, setDissolveTarget] = useState<MissionGroupCard | null>(null);
  const [trackingTarget, setTrackingTarget] = useState<{ card: ProjectCardItem; action: 'archive' | 'restore' } | null>(null);
  const [seenFinalizations, setSeenFinalizations] = useState<Set<string>>(() => new Set());
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['project-cards'],
    queryFn: () => getProjectCards(),
    ...acompanhamentoRefreshQueryOptions
  });
  const createGroupMutation = useMutation({
    mutationFn: (projectIds: string[]) => createMissionGroup({ projectIds }),
    onSuccess: async () => {
      setSelectedForGroup(new Set());
      setSelectionMode(false);
      setGroupError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-cards'] }),
        queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['mission-groups'] })
      ]);
    },
    onError: (error: unknown) => {
      setGroupError(mutationErrorMessage(error, 'Não foi possível unificar as missões selecionadas.'));
    }
  });
  const dissolveGroupMutation = useMutation({
    mutationFn: (groupId: string) => dissolveMissionGroup(groupId),
    onSuccess: async () => {
      setDissolveTarget(null);
      setSelectedForGroup(new Set());
      setGroupError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-cards'] }),
        queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['mission-groups'] })
      ]);
    },
    onError: (error: unknown) => {
      setGroupError(mutationErrorMessage(error, 'Não foi possível desmesclar este agrupamento.'));
    }
  });
  const renameGroupMutation = useMutation({
    mutationFn: ({ groupId, name }: { groupId: string; name: string }) => renameMissionGroup(groupId, name),
    onSuccess: async () => {
      setRenameTarget(null);
      setRenameValue('');
      setRenameError(null);
      setGroupError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-cards'] }),
        queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['mission-groups'] })
      ]);
    },
    onError: (error: unknown) => {
      setRenameError(mutationErrorMessage(error, 'Não foi possível alterar o nome deste agrupamento.'));
    }
  });
  const laborPolicyMutation = useMutation({
    mutationFn: ({
      groupId,
      laborAllocationMode,
      primaryLaborProjectId
    }: {
      groupId: string;
      laborAllocationMode: MissionGroupLaborAllocationMode;
      primaryLaborProjectId: string | null;
    }) => updateMissionGroupLaborPolicy(groupId, { laborAllocationMode, primaryLaborProjectId }),
    onSuccess: async () => {
      setGroupError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-cards'] }),
        queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['mission-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['ponto-pontomais-pending'] }),
        queryClient.invalidateQueries({ queryKey: ['ponto-colaboradores'] })
      ]);
    },
    onError: (error: unknown) => {
      setGroupError(mutationErrorMessage(error, 'Não foi possível atualizar a apropriação de mão de obra.'));
    }
  });
  const trackingMutation = useMutation({
    mutationFn: async ({ card, payload }: { card: ProjectCardItem; payload: { archived: boolean } | { reviewed: boolean } }) => {
      const projectIds = isGroupCard(card) ? card.members.map(member => member.projectId) : [card.projectId];
      await Promise.all(projectIds.map(projectId => setProjectTrackingState(projectId, payload)));
    },
    onSuccess: async () => {
      setTrackingTarget(null);
      setGroupError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-cards'] }),
        queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] })
      ]);
    },
    onError: (error: unknown) => {
      setGroupError(mutationErrorMessage(error, 'Não foi possível atualizar o projeto no acompanhamento.'));
    }
  });
  const openRenameGroup = (card: MissionGroupCard) => {
    setRenameTarget(card);
    setRenameValue(card.name || '');
    setRenameError(null);
  };
  const closeRenameGroup = () => {
    if (renameGroupMutation.isPending) return;
    setRenameTarget(null);
    setRenameValue('');
    setRenameError(null);
  };
  const submitRenameGroup = () => {
    if (!renameTarget || renameGroupMutation.isPending) return;
    const name = renameValue.trim();
    if (!name) {
      setRenameError('Informe um nome para o card.');
      return;
    }
    if (name.length > 120) {
      setRenameError('Nome muito longo.');
      return;
    }
    renameGroupMutation.mutate({ groupId: renameTarget.groupId, name });
  };
  const setView = useCallback((nextView: CardsView) => {
    setSearchParams(currentParams => {
      const nextParams = new URLSearchParams(currentParams);
      if (nextView === 'andamento') nextParams.delete('cards');
      else nextParams.set('cards', nextView);
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);
  const setSelected = useCallback((nextSelected: SelectedDetail | null) => {
    setSearchParams(currentParams => {
      const nextParams = new URLSearchParams(currentParams);
      nextParams.delete('project');
      nextParams.delete('group');
      if (nextSelected?.kind === 'GROUP') {
        nextParams.set('section', 'projetos');
        nextParams.set('group', nextSelected.id);
      } else if (nextSelected?.kind === 'PROJECT') {
        nextParams.set('section', 'projetos');
        nextParams.set('project', nextSelected.id);
      }
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  // Separa pelo status operacional e tira dos arquivados as missões já conferidas.
  const counts = useMemo(() => {
    const list = data ?? [];
    return {
      andamento: list.filter(c => cardMatchesView(c, 'andamento')).length,
      futuros: list.filter(c => cardMatchesView(c, 'futuros')).length,
      arquivados: list.filter(c => cardMatchesView(c, 'arquivados')).length,
      conferidas: list.filter(c => cardMatchesView(c, 'conferidas')).length
    };
  }, [data]);

  const cards = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? [])
      .filter(c => cardMatchesView(c, view))
      .filter(c => {
        if (!term) return true;
        const members = isGroupCard(c) ? c.members.map(member => `${member.code} ${member.name} ${member.clientName} ${member.clientCnpj ?? ''}`).join(' ') : '';
        return `${c.code} ${c.name} ${c.clientName} ${c.clientCnpj ?? ''} ${members}`.toLowerCase().includes(term);
      });
  }, [data, search, view]);
  const isRecentlyFinalized = useCallback((card: ProjectCardItem) => {
    if (!card.reportArchivedAt || seenFinalizations.has(cardKey(card))) return false;
    return !hasSeenAcompanhamentoFinalizedMission(progressHistoryNoveltyUser, cardKey(card), card.reportArchivedAt);
  }, [progressHistoryNoveltyUser, seenFinalizations]);
  const hasFinalizedNotice = cards.some(isRecentlyFinalized);
  const hasReviewAction = canManageGroups && cards.some(card => card.archived);

  const selectedCount = selectedForGroup.size;
  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedForGroup(new Set());
    setGroupError(null);
  };
  const toggleSelected = (projectId: string) => {
    if (createGroupMutation.isPending) return;
    setGroupError(null);
    setSelectedForGroup(current => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };
  const createSelectedGroup = () => {
    if (createGroupMutation.isPending) return;
    const projectIds = Array.from(selectedForGroup);
    if (projectIds.length < 2) {
      setGroupError('Selecione pelo menos duas missões para unificar.');
      return;
    }
    createGroupMutation.mutate(projectIds);
  };

  // Todos os hooks acima; só então a troca para o dashboard do projeto (Rules of Hooks).
  if (selected) {
    return selected.kind === 'GROUP'
      ? <ProjectDetailDashboard groupId={selected.id} canManage={canManage} canManageManualCosts={canManageManualCosts} canManageProjectNotes={canManageProjectNotes} progressHistoryNoveltyUser={progressHistoryNoveltyUser} onBack={() => setSelected(null)} />
      : <ProjectDetailDashboard projectId={selected.id} canManage={canManage} canManageManualCosts={canManageManualCosts} canManageProjectNotes={canManageProjectNotes} progressHistoryNoveltyUser={progressHistoryNoveltyUser} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="fv-ds acp-projects" data-acp-cards>
      <header className="acp-projects__heading"><h1>Projetos</h1>
        <p className="acp-projects__description">Execução, custos e equipes por missão. Consulte os detalhes e organize os grupos.</p>
      </header>
      <ProjectCardsToolbar view={view} counts={counts} search={search} onSearch={setSearch} onView={setView}
        canManageGroups={canManageGroups} selectionMode={selectionMode} selectedCount={selectedCount}
        loading={data === undefined} busy={createGroupMutation.isPending}
        onStartSelection={() => { setSelectionMode(true); setSelectedForGroup(new Set()); setGroupError(null); }}
        onConfirm={createSelectedGroup} onCancel={cancelSelection} />
      {groupError && !trackingTarget && !dissolveTarget ? <Alert tone="danger">{groupError}</Alert> : null}
      {isError ? <Alert tone="danger" title={data ? 'Não foi possível atualizar os projetos' : 'Não foi possível carregar os projetos'}
        action={{ label: 'Tentar novamente', onClick: () => { void refetch(); } }}>
        {data ? 'Exibindo a última consulta disponível. Os dados podem estar desatualizados.' : 'Tente novamente para consultar os projetos.'}
      </Alert> : null}
      <div aria-busy={isFetching}>
        {isLoading ? <div className="acp-projects__grid" role="status" aria-label="Carregando projetos">
          {[0, 1, 2].map(id => <Skeleton key={id} variant="card" height="24rem" decorative />)}
        </div> : data ? cards.length === 0 ? <EmptyState variant={search.trim() ? 'search' : 'default'}
          title={search.trim() ? 'Nenhum projeto encontrado para a busca nesta situação.'
            : data.length === 0 ? 'Nenhum projeto com proposta comercial importada.'
              : view === 'conferidas' ? 'Nenhuma missão conferida.' : view === 'arquivados' ? 'Nenhum projeto arquivado aguardando conferência.' : view === 'futuros' ? 'Nenhum projeto futuro.' : 'Nenhum projeto em andamento.'}
          description={data.length === 0 ? 'Importe o banco do comercial e cadastre a missão com o número da proposta.' : 'Altere a situação ou a busca para consultar outros projetos.'}
          action={search.trim() ? { label: 'Limpar busca', onClick: () => setSearch('') } : undefined} />
          : <div className="acp-projects__grid">
          {cards.map(card => (
            <ProjectOverviewCard
              key={cardKey(card)}
              card={card}
              selected={!isGroupCard(card) && selectedForGroup.has(card.projectId)}
              canSelect={canManageGroups && selectionMode}
              canManageGroups={canManageGroups}
              canManage={canManageGroups}
              trackingSaving={trackingMutation.isPending}
              recentlyFinalized={isRecentlyFinalized(card)}
              renaming={isGroupCard(card) && renameTarget?.groupId === card.groupId}
              renameValue={renameValue}
              renameError={isGroupCard(card) && renameTarget?.groupId === card.groupId ? renameError : null}
              renameSaving={isGroupCard(card) && renameTarget?.groupId === card.groupId && renameGroupMutation.isPending}
              onOpen={() => {
                if (isRecentlyFinalized(card)) {
                  markAcompanhamentoFinalizedMissionSeen(progressHistoryNoveltyUser, cardKey(card), card.reportArchivedAt);
                  setSeenFinalizations(current => new Set(current).add(cardKey(card)));
                }
                setSelected(isGroupCard(card)
                  ? { kind: 'GROUP', id: card.groupId }
                  : { kind: 'PROJECT', id: card.projectId });
              }}
              onToggleSelect={!isGroupCard(card) ? () => toggleSelected(card.projectId) : undefined}
              onStartRename={isGroupCard(card) ? () => openRenameGroup(card) : undefined}
              onRenameValueChange={value => {
                setRenameValue(value);
                setRenameError(null);
              }}
              onSubmitRename={submitRenameGroup}
              onCancelRename={closeRenameGroup}
              onDissolve={isGroupCard(card) ? () => { setGroupError(null); setDissolveTarget(card); } : undefined}
              laborPolicySaving={laborPolicyMutation.isPending}
              onLaborPolicyChange={isGroupCard(card) ? (laborAllocationMode, primaryLaborProjectId) => {
                laborPolicyMutation.mutate({ groupId: card.groupId, laborAllocationMode, primaryLaborProjectId });
              } : undefined}
              onArchive={() => { setGroupError(null); setTrackingTarget({ card, action: card.archivedInAcompanhamento ? 'restore' : 'archive' }); }}
              onReview={() => trackingMutation.mutate({ card, payload: { reviewed: !card.reviewed } })}
            />
          ))}
        </div> : null}
      </div>
      <ConfirmDialog
        appearance="design-system"
        errorMessage={groupError}
        open={trackingTarget !== null}
        confirmDisabled={trackingMutation.isPending}
        title={trackingTarget?.action === 'restore' ? 'Restaurar no acompanhamento' : 'Arquivar no acompanhamento'}
        description={trackingTarget?.action === 'restore'
          ? 'O projeto voltará à situação correspondente no Acompanhamento. O status em Relatórios não será alterado.'
          : 'O projeto irá para a aba Arquivados somente no Acompanhamento. Relatórios permanecerá inalterado.'}
        highlight={trackingTarget?.card.name}
        confirmLabel={trackingMutation.isPending ? 'Salvando…' : trackingTarget?.action === 'restore' ? 'Restaurar' : 'Arquivar'}
        cancelLabel="Cancelar"
        danger={false}
        onConfirm={() => {
          if (trackingTarget && !trackingMutation.isPending) {
            trackingMutation.mutate({ card: trackingTarget.card, payload: { archived: trackingTarget.action === 'archive' } });
          }
        }}
        onCancel={() => {
          if (!trackingMutation.isPending) setTrackingTarget(null);
        }}
      />
      <ConfirmDialog
        appearance="design-system"
        errorMessage={groupError}
        open={dissolveTarget !== null}
        confirmDisabled={dissolveGroupMutation.isPending}
        title="Desmesclar missões"
        description="As missões voltarão a aparecer como cards individuais no Acompanhamento. Relatórios e dados originais não serão alterados."
        highlight={dissolveTarget?.name}
        confirmLabel={dissolveGroupMutation.isPending ? 'Desmesclando…' : 'Desmesclar'}
        cancelLabel="Cancelar"
        danger={false}
        onConfirm={() => {
          if (dissolveTarget && !dissolveGroupMutation.isPending) dissolveGroupMutation.mutate(dissolveTarget.groupId);
        }}
        onCancel={() => {
          if (!dissolveGroupMutation.isPending) setDissolveTarget(null);
        }}
      />
      <ProjectGroupRenameNovelty
        user={progressHistoryNoveltyUser}
        enabled={groupRenameNoveltyActive && canManageGroups && !selectionMode && renameTarget === null}
        onSeen={() => setGroupRenameNoveltyActive(false)}
      />
      <ProjectLaborPolicyNovelty
        user={progressHistoryNoveltyUser}
        enabled={laborPolicyNoveltyActive && canManageGroups && !selectionMode && renameTarget === null}
        onSeen={() => setLaborPolicyNoveltyActive(false)}
      />
      <ProjectTrackingNovelties
        user={progressHistoryNoveltyUser}
        canManage={canManageGroups}
        hasFinalizedNotice={hasFinalizedNotice}
        hasReviewAction={hasReviewAction}
      />

    </div>
  );
}
