import { useNavigate } from 'react-router-dom';


import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { rdoPath } from '../../auth/rolePath';
import { useDraftMutations, useDrafts } from '../../hooks/useDrafts';
import { useReports } from '../../hooks/useReports';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useRdoStore } from '../../store/rdoStore';
import type { ReportDraft } from '../../types/domain';
import { collectOngoingServices } from '../../utils/ongoingServices';

const TEXT = {
  archived: 'Arquivados',
  archivedSubtitle: 'Projetos arquivados',
  continue: 'Continuar',
  createRdo: 'Registrar serviços do dia',
  drafts: 'Relatórios em andamento',
  inProgress: 'Em andamento',
  historyByProject: 'Histórico',
  myReports: 'Meus relatórios',
  newReport: 'Novo relatório',
  noDate: 'Sem data definida',
  remove: 'Remover',
  resume: 'Retomar preenchimento',
};

function getGreeting(name: string) {
  const hour = new Date().getHours();
  const firstName = (name || '').split(' ')[0];
  const saudacao = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return `${saudacao}, ${firstName} \u{1F44B}`;
}

function getTodayLabel() {
  const label = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const draftsQuery = useDrafts();
  const reportsQuery = useReports({ mine: true, summary: true });
  const draftMutations = useDraftMutations();
  const { hydrate, reset } = useRdoStore();
  const ongoingServices = collectOngoingServices(reportsQuery.data || []);

  function handleNewReport() {
    reset();
    navigate(rdoPath('/relatorio/novo'));
  }

  function handleResumeDraft(draft: ReportDraft) {
    const payload = draft.payload || {};

    hydrate({
      draftId: draft.id,
      serviceOnly: asBoolean(payload.serviceOnly),
      projectId: asString(payload.projectId, draft.projectId || '') || null,
      reportDate: asString(payload.reportDate, draft.reportDate || ''),
      arrivalTime: asString(payload.arrivalTime),
      departureTime: asString(payload.departureTime),
      lunchBreak: asString(payload.lunchBreak, '01:00:00'),
      collaboratorIds: asStringArray(payload.collaboratorIds),
      nightCollaboratorIds: asStringArray(payload.nightCollaboratorIds),
      standby: asBoolean(payload.standby),
      standbyDuration: asString(payload.standbyDuration),
      standbyMotivo: asString(payload.standbyMotivo),
      noturno: asBoolean(payload.noturno),
      noturnoStart: asString(payload.noturnoStart),
      noturnoEnd: asString(payload.noturnoEnd),
      noturnoInterval: asString(payload.noturnoInterval, '01:00:00'),
      overtimeReason: asString(payload.overtimeReason),
      dailyDescription: asString(payload.dailyDescription),
      generalUploads: Array.isArray(payload.generalUploads) ? payload.generalUploads : [],
      services: asServices(payload.services)
    });

    navigate(rdoPath('/relatorio/novo'));
  }

  return (
    <Shell>
      <TopBar
        title="Home"
        subtitle={user?.name}
        showLogo
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location.pathname) })}>
              Conta
            </button>
            <button
              className="topbar-chip"
              type="button"
              onClick={async () => { await logout(); navigate('/', { replace: true }); }}
            >
              Sair
            </button>
          </>
        }
      />
      <main className="page-scroll">
        <div className="home-greeting">
          <div className="home-greeting-title">{getGreeting(user?.name || '')}</div>
          <div className="home-greeting-date">{getTodayLabel()}</div>
        </div>

        <section className="home-actions-grid">
          <button className="home-action-card home-action-primary" type="button" onClick={handleNewReport}>
            <span className="home-action-icon">📋</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="home-action-title">{TEXT.newReport}</span>
              <span className="home-action-subtitle">{TEXT.createRdo}</span>
            </div>
          </button>
          <button className="home-action-card" type="button" onClick={() => navigate(rdoPath('/meus-relatorios'))}>
            <div className="home-action-icon">📁</div>
            <div className="home-action-title">{TEXT.myReports}</div>
            <div className="home-action-subtitle">{TEXT.historyByProject}</div>
          </button>
          <button className="home-action-card" type="button" onClick={() => navigate(rdoPath('/andamento'))} disabled={!ongoingServices.length}>
            <div className="home-action-icon">⏳</div>
            <div className="home-action-title">{TEXT.inProgress}</div>
            <div className="home-action-subtitle">{ongoingServices.length} serviço(s) ativos</div>
          </button>
        </section>

        <section className="page-card compact-link-card">
          <button className="secondary-button" type="button" onClick={() => navigate(rdoPath('/meus-relatorios/arquivados'))}>
            {TEXT.archived} — {TEXT.archivedSubtitle}
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
