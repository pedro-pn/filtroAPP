import { useMemo } from 'react';
import { useNavigate } from 'react-router';


import { useAuth } from '../../auth/AuthContext';
import { rdoPath } from '../../auth/rolePath';
import { AppIcon } from '../../components/icons/AppIcon';
import { Button, Card, StatusPill } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import { useDraftMutations, useDrafts } from '../../hooks/useDrafts';
import { useReports } from '../../hooks/useReports';
import { PageHeader } from '../../layout/PageHeader';
import { useRdoStore } from '../../store/rdoStore';
import type { ReportDraft } from '../../types/domain';
import { collectOngoingServices } from '../../utils/ongoingServices';
import { RdoAppShell } from '../RdoAppShell';
import { SITE_RDO_DRAFT_FORM_PATH } from '../../utils/reportDraft';

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
  resume: 'Retomar preenchimento'
};

function getGreeting(name: string) {
  const hour = new Date().getHours();
  const firstName = (name || '').split(' ')[0];
  const saudacao = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return `${saudacao}, ${firstName}`;
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

function asDdsThemes(value: unknown): { id: string; name: string; custom?: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => ({
      id: asString(item.id),
      name: asString(item.name),
      ...(item.custom === true ? { custom: true } : {})
    }))
    .filter(item => item.id && item.name);
}

function asServices(value: unknown): RdoServiceDraft[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => ({
      id: asString(item.id, `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      type: asString(item.type, 'LIMPEZA'),
      data: item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? (item.data as Record<string, unknown>) : {}
    }));
}

function draftDateLabel(draft: ReportDraft) {
  const payloadDate = asString(draft.payload.reportDate);
  return draft.reportDate || payloadDate || TEXT.noDate;
}

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const draftsQuery = useDrafts();
  const reportsQuery = useReports({ mine: true, summary: true });
  const draftMutations = useDraftMutations();
  const { hydrate, reset } = useRdoStore();
  const ongoingServices = collectOngoingServices(reportsQuery.data || []);
  const navigationSections = useMemo(() => [
    { id: 'home', label: 'Início', href: rdoPath('/home'), active: true },
    { id: 'pending', label: 'Pendentes', href: `${rdoPath('/meus-relatorios')}?tab=pending`, active: false },
    { id: 'approved', label: 'Aprovados', href: `${rdoPath('/meus-relatorios')}?tab=approved`, active: false },
    { id: 'ongoing', label: 'Em andamento', href: rdoPath('/andamento'), active: false },
    { id: 'archived', label: 'Arquivados', href: rdoPath('/meus-relatorios/arquivados'), active: false }
  ], []);
  const emissionPermissions = user?.reportEmissionPermissions || [];
  const canEmitSite = emissionPermissions.includes('SITE_RDO');

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
      ddsDay: asBoolean(payload.ddsDay),
      ddsDayStart: asString(payload.ddsDayStart),
      ddsDayEnd: asString(payload.ddsDayEnd),
      ddsDayThemes: asDdsThemes(payload.ddsDayThemes),
      ddsNight: asBoolean(payload.ddsNight),
      ddsNightStart: asString(payload.ddsNightStart),
      ddsNightEnd: asString(payload.ddsNightEnd),
      ddsNightThemes: asDdsThemes(payload.ddsNightThemes),
      overtimeReason: asString(payload.overtimeReason),
      dailyDescription: asString(payload.dailyDescription),
      generalUploads: Array.isArray(payload.generalUploads) ? payload.generalUploads : [],
      services: asServices(payload.services)
    });

    navigate(rdoPath(SITE_RDO_DRAFT_FORM_PATH));
  }

  return (
    <RdoAppShell
      title="RDO"
      sectionLabel="Início"
      subNavigation={navigationSections}
    >
      <main className="fv-ds rdo-role-page rdo-collaborator-home">
        <PageHeader
          title={getGreeting(user?.name || '')}
          description={getTodayLabel()}
          actions={canEmitSite ? (
            <Button
              variant="primary"
              iconLeft={<AppIcon icon={DS_ICONS.plus} size="sm" />}
              onClick={handleNewReport}
            >
              {TEXT.newReport}
            </Button>
          ) : undefined}
      />
        {canEmitSite ? <section className="rdo-role-action-grid" aria-label="Ações rápidas">
          <Card data-operational-new-report className="rdo-role-action-card" variant="accent" accentTone="brand" padding="md" onClick={handleNewReport}>
            <span className="rdo-role-action-card__icon"><AppIcon icon={DS_ICONS.fileText} size="lg" /></span>
            <div className="rdo-role-action-card__copy">
              <span className="home-action-title">{TEXT.newReport}</span>
              <span className="home-action-subtitle">{TEXT.createRdo}</span>
            </div>
          </Card>
          <Card className="rdo-role-action-card" variant="interactive" padding="md" onClick={() => navigate(rdoPath('/meus-relatorios'))}>
            <span className="rdo-role-action-card__icon"><AppIcon icon={DS_ICONS.folder} size="lg" /></span>
            <div className="rdo-role-action-card__copy">
              <span className="home-action-title">{TEXT.myReports}</span>
              <span className="home-action-subtitle">{TEXT.historyByProject}</span>
            </div>
          </Card>
          <Card
            className={`rdo-role-action-card${ongoingServices.length ? '' : ' is-disabled'}`}
            variant="interactive"
            padding="md"
            aria-disabled={!ongoingServices.length}
            onClick={ongoingServices.length ? () => navigate(rdoPath('/andamento')) : undefined}
          >
            <span className="rdo-role-action-card__icon"><AppIcon icon={DS_ICONS.servicePressure} size="lg" /></span>
            <div className="rdo-role-action-card__copy">
              <span className="home-action-title">{TEXT.inProgress}</span>
              <span className="home-action-subtitle">{ongoingServices.length} serviço(s) ativos</span>
            </div>
          </Card>
        </section> : null}

        {canEmitSite ? <Card className="rdo-role-archive-link" padding="sm">
          <Button variant="ghost" size="sm" iconLeft={<AppIcon icon={DS_ICONS.archive} size="sm" />} onClick={() => navigate(rdoPath('/meus-relatorios/arquivados'))}>
            {TEXT.archived} — {TEXT.archivedSubtitle}
          </Button>
        </Card>

        : null}
        {canEmitSite && draftsQuery.data?.length ? (
          <Card className="rdo-role-drafts" title={TEXT.drafts} padding="md">
            <div className="rdo-role-draft-list">
              {draftsQuery.data.map(draft => (
                <Card className="rdo-role-draft-card" key={draft.id} padding="sm">
                  <div className="rdo-role-draft-card__head">
                    <div className="rdo-role-draft-card__copy">
                      <div className="admin-card-title">{draft.title || 'RDO em andamento'} <StatusPill status="pending" label="Rascunho" tone="warning" /></div>
                      <div className="rdo-role-draft-card__meta">
                        <span>{draft.project?.code || draft.projectId || 'Projeto'}</span>
                        <span>{draftDateLabel(draft)}</span>
                      </div>
                    </div>
                    <div className="rdo-role-draft-card__actions">
                      <Button variant="primary" size="sm" onClick={() => handleResumeDraft(draft)}>
                        {TEXT.continue}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => draftMutations.removeDraft.mutate(draft.id)}
                      >
                        {TEXT.remove}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </Card>
        ) : null}
      </main>
    </RdoAppShell>
  );
}

