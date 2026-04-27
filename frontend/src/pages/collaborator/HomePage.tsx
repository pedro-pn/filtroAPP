import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { useDraftMutations, useDrafts } from '../../hooks/useDrafts';
import { useProjects } from '../../hooks/useProjects';
import { useReports } from '../../hooks/useReports';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useRdoStore } from '../../store/rdoStore';
import type { ReportDraft } from '../../types/domain';

const TEXT = {
  archived: 'Arquivados',
  archivedSubtitle: 'Projetos arquivados',
  continue: 'Continuar',
  createRdo: 'Criar RDO',
  drafts: 'Relat\u00f3rios em andamento',
  historyByProject: 'Hist\u00f3rico por projeto',
  myReports: 'Meus relat\u00f3rios',
  newReport: 'Novo relat\u00f3rio',
  noDate: 'Sem data definida',
  remove: 'Remover',
  resume: 'Retomar preenchimento',
  summary: 'Resumo'
};

interface RdoServiceDraft {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asServices(value: unknown): RdoServiceDraft[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => ({
      id: asString(item.id, `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      type: asString(item.type, 'LIMPEZA'),
      data: item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data as Record<string, unknown> : {}
    }));
}

function draftDateLabel(draft: ReportDraft) {
  const payloadDate = asString(draft.payload.reportDate);
  return draft.reportDate || payloadDate || TEXT.noDate;
}

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const projectsQuery = useProjects(true);
  const reportsQuery = useReports({ mine: true });
  const draftsQuery = useDrafts();
  const draftMutations = useDraftMutations();
  const { hydrate, reset } = useRdoStore();

  const reportStats = useMemo(() => {
    const reports = reportsQuery.data || [];
    return {
      pending: reports.filter(report => report.status === 'PENDING' || report.status === 'RETURNED').length,
      approved: reports.filter(report => report.status === 'APPROVED' || report.status === 'SIGNED').length
    };
  }, [reportsQuery.data]);

  function handleNewReport() {
    reset();
    navigate('/relatorios/novo');
  }

  function handleResumeDraft(draft: ReportDraft) {
    const payload = draft.payload || {};

    hydrate({
      draftId: draft.id,
      projectId: asString(payload.projectId, draft.projectId || '') || null,
      reportDate: asString(payload.reportDate, draft.reportDate || ''),
      arrivalTime: asString(payload.arrivalTime),
      departureTime: asString(payload.departureTime),
      lunchBreak: asString(payload.lunchBreak, '1 hora'),
      collaboratorIds: asStringArray(payload.collaboratorIds),
      nightCollaboratorIds: asStringArray(payload.nightCollaboratorIds),
      standby: asBoolean(payload.standby),
      noturno: asBoolean(payload.noturno),
      overtimeReason: asString(payload.overtimeReason),
      dailyDescription: asString(payload.dailyDescription),
      generalUploads: Array.isArray(payload.generalUploads) ? payload.generalUploads : [],
      services: asServices(payload.services)
    });

    navigate('/relatorios/novo');
  }

  return (
    <Shell>
      <TopBar title="Home" subtitle={user?.name} />
      <main className="page-scroll">
        <section className="page-card">
          <div className="section-title">{TEXT.summary}</div>
          <div className="stats-grid">
            <div className="stat-card-react">
              <div className="stat-number-react">{projectsQuery.data?.length ?? 0}</div>
              <div className="stat-label-react">Projetos ativos</div>
            </div>
            <div className="stat-card-react">
              <div className="stat-number-react">{reportStats.pending}</div>
              <div className="stat-label-react">Pendentes/devolvidos</div>
            </div>
            <div className="stat-card-react">
              <div className="stat-number-react">{reportStats.approved}</div>
              <div className="stat-label-react">Aprovados/assinados</div>
            </div>
          </div>
        </section>

        <section className="home-actions-grid">
          <button className="home-action-card home-action-primary" type="button" onClick={handleNewReport}>
            <span className="home-action-title">{TEXT.newReport}</span>
            <span className="home-action-subtitle">{TEXT.createRdo}</span>
          </button>
          <button className="home-action-card" type="button" onClick={() => navigate('/meus-relatorios')}>
            <span className="home-action-title">{TEXT.myReports}</span>
            <span className="home-action-subtitle">{TEXT.historyByProject}</span>
          </button>
          <button className="home-action-card" type="button" onClick={() => navigate('/meus-relatorios/arquivados')}>
            <span className="home-action-title">{TEXT.archived}</span>
            <span className="home-action-subtitle">{TEXT.archivedSubtitle}</span>
          </button>
        </section>

        {draftsQuery.data?.length ? (
          <section className="page-card">
            <div className="section-title">{TEXT.drafts}</div>
            <div className="admin-stack">
              {draftsQuery.data.map(draft => (
                <article className="admin-card-react" key={draft.id}>
                  <div className="admin-card-head">
                    <div>
                      <div className="admin-card-title">{draft.title || 'RDO em andamento'}</div>
                      <div className="admin-card-meta">
                        <span>{draft.project?.code || draft.projectId || 'Projeto'}</span>
                        <span>{draftDateLabel(draft)}</span>
                      </div>
                    </div>
                    <div className="admin-card-actions">
                      <button className="secondary-button" type="button" onClick={() => handleResumeDraft(draft)}>
                        {TEXT.continue}
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => draftMutations.removeDraft.mutate(draft.id)}
                      >
                        {TEXT.remove}
                      </button>
                    </div>
                  </div>
                  <p className="placeholder-copy">{TEXT.resume}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </Shell>
  );
}
