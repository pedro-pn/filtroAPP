import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  DatabaseBackup,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import {
  getOperationalStatus,
  type OperationalFileStatus,
  type OperationalStatus
} from '../api/operations';
import { useAuth } from '../auth/AuthContext';
import { accountPageStateFromPath } from '../auth/moduleNavigation';
import { BrandLoading } from '../components/brand/BrandLoading';
import { AppIcon } from '../components/icons/AppIcon';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  StatusPill
} from '../components/ui/ds';
import { AppShell } from '../layout/AppShell';
import { NAVIGATION_CHROME_ICONS } from '../layout/navigationIcons';
import type { NavigationModel } from '../layout/navigationModel';
import { createNavigationModel } from '../layout/navigationModel';
import { PageHeader } from '../layout/PageHeader';
import { hubModulesForUser } from './hubModules';
import {
  operationalDateTime as dateTime,
  operationalDuration as duration,
  operationalJobLabel,
  operationalStatusLabel,
  operationalStatusTone
} from './operationalStatusPresentation';
import './OperationsPage.ds.css';

const previewStatus: OperationalStatus = {
  ok: false,
  generatedAt: '2026-10-01T14:35:00.000Z',
  problems: [{ message: 'Backup diário atrasado. Confira a última execução.' }],
  jobs: {
    recurring: [
      {
        name: 'pontomais-sync',
        latestRun: {
          id: 'demo-1',
          name: 'pontomais-sync',
          status: 'SUCCESS',
          startedAt: '2026-10-01T13:00:00.000Z',
          finishedAt: '2026-10-01T13:02:00.000Z',
          durationMs: 120000,
          metadata: null,
          result: null,
          error: null
        }
      },
      {
        name: 'signature-reminders',
        latestRun: {
          id: 'demo-2',
          name: 'signature-reminders',
          status: 'RUNNING',
          startedAt: '2026-10-01T14:30:00.000Z',
          finishedAt: null,
          durationMs: null,
          metadata: null,
          result: null,
          error: null
        }
      }
    ],
    dataRetention: { latestRun: null },
    reportApprovalPostProcessing: { counts: {}, latestFailed: null },
    activeLocks: []
  },
  backup: {
    configured: true,
    status: 'STALE',
    finishedAt: '2026-09-30T02:02:00.000Z',
    ageMs: 131580000,
    maxAgeMs: 86400000,
    message: 'Aguardando próxima execução.'
  },
  restore: {
    configured: true,
    status: 'SUCCESS',
    finishedAt: '2026-09-29T10:30:00.000Z',
    ageMs: 187500000,
    maxAgeMs: 604800000
  },
  omie: {
    configured: true,
    enabled: true,
    status: 'SUCCESS',
    latestRun: {
      id: 'demo-omie',
      integration: 'OMIE',
      scope: 'Projetos',
      status: 'SUCCESS',
      recordsRead: 124,
      recordsWritten: 8,
      error: null,
      summary: null,
      triggeredBy: 'Agendamento',
      startedAt: '2026-10-01T12:00:00.000Z',
      finishedAt: '2026-10-01T12:04:00.000Z'
    },
    scopes: []
  },
  commercialImport: {
    configured: true,
    status: 'SUCCESS',
    latestImport: {
      id: 'demo-import',
      fileName: 'propostas-outubro.xlsx',
      source: 'UPLOAD',
      status: 'SUCCESS',
      rowsRead: 38,
      created: 2,
      updated: 4,
      skipped: 32,
      pendingProjectsCreated: 0,
      error: null,
      summary: null,
      importedByUserId: null,
      createdAt: '2026-10-01T09:15:00.000Z'
    }
  },
  errorTracking: { enabled: true, provider: 'Monitoramento ativo' },
  alerting: { enabled: true, webhookConfigured: true, intervalMs: 300000 }
};

const previewNavigation: NavigationModel = {
  groups: [
    {
      id: 'principal',
      label: 'Principal',
      items: [
        {
          id: 'hub',
          label: 'Visão geral',
          href: '/visualizar',
          group: 'principal',
          icon: NAVIGATION_CHROME_ICONS.home,
          active: false
        },
        {
          id: 'operations',
          label: 'Sincronizações',
          href: '/visualizar/operacoes',
          group: 'principal',
          icon: NAVIGATION_CHROME_ICONS.operations,
          active: true
        }
      ]
    }
  ]
};

function OperationalStatusPill({ status }: { status: string }) {
  return (
    <StatusPill
      status={status}
      label={operationalStatusLabel(status)}
      tone={operationalStatusTone(status)}
    />
  );
}

function PanelTitle({ title, icon }: { title: string; icon: LucideIcon }) {
  return (
    <div className="ops-page__panel-title">
      <AppIcon icon={icon} />
      <h3>{title}</h3>
    </div>
  );
}

function DetailRows({
  rows
}: {
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <dl className="ops-page__details">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FileStatusCard({
  title,
  item,
  icon
}: {
  title: string;
  item: OperationalFileStatus;
  icon: LucideIcon;
}) {
  return (
    <Card
      className="ops-page__panel"
      title={<PanelTitle title={title} icon={icon} />}
      actions={<OperationalStatusPill status={item.status} />}
    >
      <DetailRows
        rows={[
          {
            label: 'Última execução',
            value: dateTime(item.finishedAt || item.startedAt)
          },
          { label: 'Tempo desde a execução', value: duration(item.ageMs) },
          { label: 'Prazo máximo', value: duration(item.maxAgeMs) }
        ]}
      />
      {item.message ? <p className="ops-page__note">{item.message}</p> : null}
      {item.runDir || item.backupSource ? (
        <p className="ops-page__note">{item.runDir || item.backupSource}</p>
      ) : null}
    </Card>
  );
}

function OmieStatusCard({ item }: { item: OperationalStatus['omie'] }) {
  const run = item.latestRun;
  return (
    <Card
      className="ops-page__panel"
      title={<PanelTitle title="Omie" icon={RefreshCw} />}
      actions={<OperationalStatusPill status={item.status} />}
    >
      <DetailRows
        rows={[
          {
            label: 'Última sincronização',
            value: dateTime(run?.finishedAt || run?.startedAt)
          },
          { label: 'Escopo', value: run?.scope || '—' },
          {
            label: 'Registros lidos / gravados',
            value: run ? `${run.recordsRead} / ${run.recordsWritten}` : '—'
          },
          {
            label: 'Sincronização automática',
            value: item.enabled ? 'Ativada' : 'Desativada'
          }
        ]}
      />
      {run?.triggeredBy ? (
        <p className="ops-page__note">Origem: {run.triggeredBy}</p>
      ) : null}
      {!item.configured ? (
        <p className="ops-page__note">Credenciais Omie não configuradas.</p>
      ) : null}
      {run?.error ? (
        <Alert tone="danger" className="ops-page__feedback">
          {run.error}
        </Alert>
      ) : null}
      {item.scopes.length > 0 ? (
        <ul
          className="ops-page__scopes"
          aria-label="Sincronizações Omie por escopo"
        >
          {item.scopes.map(({ scope, latestRun }) => (
            <li key={scope}>
              <div>
                <strong>{scope}</strong>
                <span>
                  {dateTime(latestRun?.finishedAt || latestRun?.startedAt)}
                </span>
              </div>
              <OperationalStatusPill
                status={latestRun?.status || 'SEM_EXECUCAO'}
              />
              {latestRun?.error ? <p>{latestRun.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function CommercialImportCard({
  item
}: {
  item: OperationalStatus['commercialImport'];
}) {
  const lastImport = item.latestImport;
  const duplicate = lastImport?.summary?.skippedDuplicate === true;
  return (
    <Card
      className="ops-page__panel"
      title={<PanelTitle title="Banco comercial" icon={FileSpreadsheet} />}
      actions={<OperationalStatusPill status={item.status} />}
    >
      <DetailRows
        rows={[
          {
            label: 'Último recebimento',
            value: dateTime(lastImport?.createdAt)
          },
          { label: 'Arquivo', value: lastImport?.fileName || '—' },
          {
            label: 'Linhas lidas / alteradas',
            value: lastImport
              ? `${lastImport.rowsRead} / ${lastImport.created + lastImport.updated}`
              : '—'
          }
        ]}
      />
      {lastImport?.error ? (
        <Alert tone="danger" className="ops-page__feedback">
          {lastImport.error}
        </Alert>
      ) : null}
      {duplicate ? (
        <p className="ops-page__note">
          Arquivo recebido novamente sem reprocessar propostas.
        </p>
      ) : null}
      {!item.configured ? (
        <p className="ops-page__note">Token de recebimento não configurado.</p>
      ) : null}
    </Card>
  );
}

function JobsPanel({ status }: { status: OperationalStatus }) {
  return (
    <Card
      className="ops-page__panel"
      title={<PanelTitle title="Rotinas recorrentes" icon={Activity} />}
      actions={
        <Badge>
          {status.jobs.activeLocks.length}{' '}
          {status.jobs.activeLocks.length === 1
            ? 'bloqueio ativo'
            : 'bloqueios ativos'}
        </Badge>
      }
    >
      <DataTable
        ariaLabel="Status das rotinas recorrentes"
        rows={status.jobs.recurring}
        getRowId={(job) => job.name}
        columns={[
          {
            key: 'name',
            header: 'Rotina',
            accessor: (job) => operationalJobLabel(job.name),
            rowHeader: true
          },
          {
            key: 'status',
            header: 'Status',
            accessor: (job) =>
              operationalStatusLabel(job.latestRun?.status || 'SEM_EXECUCAO'),
            render: (job) => (
              <OperationalStatusPill
                status={job.latestRun?.status || 'SEM_EXECUCAO'}
              />
            )
          },
          {
            key: 'finishedAt',
            header: 'Última execução',
            render: (job) =>
              dateTime(job.latestRun?.finishedAt || job.latestRun?.startedAt),
            sortValue: (job) =>
              job.latestRun?.finishedAt || job.latestRun?.startedAt || null
          },
          {
            key: 'duration',
            header: 'Duração',
            render: (job) => duration(job.latestRun?.durationMs),
            sortValue: (job) => job.latestRun?.durationMs ?? null
          }
        ]}
        renderRowDetails={(job) =>
          job.latestRun?.error ? (
            <Alert tone="danger">{job.latestRun.error}</Alert>
          ) : null
        }
        mobile={{
          renderItem: (job) => ({
            title: operationalJobLabel(job.name),
            status: (
              <OperationalStatusPill
                status={job.latestRun?.status || 'SEM_EXECUCAO'}
              />
            ),
            metadata: [
              {
                label: 'Última execução',
                value: dateTime(
                  job.latestRun?.finishedAt || job.latestRun?.startedAt
                )
              },
              { label: 'Duração', value: duration(job.latestRun?.durationMs) }
            ]
          })
        }}
        emptyState="Nenhuma rotina recorrente disponível."
      />
    </Card>
  );
}

export function OperationsPage({ preview = false }: { preview?: boolean }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useMemo(
    () =>
      preview
        ? previewNavigation
        : createNavigationModel({
            modules: hubModulesForUser(user),
            pathname: location.pathname
          }),
    [preview, user, location.pathname]
  );
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['operations', 'status'],
    queryFn: getOperationalStatus,
    refetchInterval: preview ? false : 60_000,
    enabled: !preview
  });
  const status = preview ? previewStatus : data;
  const content = (
    <main className="fv-ds ops-page-v2" data-fv-ds>
      <PageHeader
        title="Sincronizações"
        description="Acompanhe backups, sincronizações e a saúde do sistema."
        actions={
          <Button
            variant="secondary"
            size="sm"
            type="button"
            iconLeft={<AppIcon icon={RefreshCw} size="sm" />}
            onClick={() => {
              void refetch();
            }}
            disabled={isFetching || preview}
          >
            {isFetching ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />
      {preview ? (
        <Alert tone="info">
          Demonstração visual com dados fictícios.{' '}
          <Link to="/visualizar">Ver todas as telas</Link>
        </Alert>
      ) : null}
      {!preview && isLoading ? (
        <Card>
          <BrandLoading label="Carregando status operacional" />
        </Card>
      ) : null}
      {!preview && error ? (
        <Alert
          tone="danger"
          title="Não foi possível carregar o status operacional."
          action={{
            label: 'Tentar novamente',
            onClick: () => {
              void refetch();
            }
          }}
        >
          {status
            ? 'Os dados abaixo são da última consulta bem-sucedida.'
            : 'Tente atualizar para consultar os backups e as sincronizações.'}
        </Alert>
      ) : null}
      {status ? (
        <>
          <Card
            className="ops-page__summary"
            variant="accent"
            accentTone={status.ok ? 'success' : 'warning'}
          >
            <div>
              <span>Status geral</span>
              <strong>
                {status.ok ? 'Operação OK' : 'Atenção operacional'}
              </strong>
            </div>
            <div className="ops-page__updated">
              <span>Última consulta: {dateTime(status.generatedAt)}</span>
              <span>
                {preview
                  ? 'Dados de demonstração'
                  : 'Atualização automática a cada minuto'}
              </span>
            </div>
          </Card>
          {status.problems.length > 0 ? (
            <Alert
              tone="warning"
              title={`Pontos de atenção (${status.problems.length})`}
            >
              <ul className="ops-page__problems">
                {status.problems.map((problem, index) => (
                  <li key={`${problem.message}-${index}`}>
                    {problem.job ? (
                      <strong>{operationalJobLabel(problem.job)}: </strong>
                    ) : null}
                    {problem.message}
                    {problem.scope ? ` (${problem.scope})` : null}
                    {problem.error ? (
                      <span className="ops-page__problem-error">
                        {problem.error}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <section
            className="ops-page__section"
            aria-labelledby="ops-backups-title"
          >
            <h2 id="ops-backups-title">Backups e restauração</h2>
            <div className="ops-page__grid">
              <FileStatusCard
                title="Backup"
                item={status.backup}
                icon={DatabaseBackup}
              />
              <FileStatusCard
                title="Teste de restauração"
                item={status.restore}
                icon={ShieldCheck}
              />
            </div>
          </section>
          <section
            className="ops-page__section"
            aria-labelledby="ops-integrations-title"
          >
            <h2 id="ops-integrations-title">Sincronizações e recebimentos</h2>
            <div className="ops-page__grid">
              <OmieStatusCard item={status.omie} />
              <CommercialImportCard item={status.commercialImport} />
            </div>
          </section>
          <section
            className="ops-page__section"
            aria-labelledby="ops-monitoring-title"
          >
            <h2 id="ops-monitoring-title">Rotinas e monitoramento</h2>
            <JobsPanel status={status} />
            <div className="ops-page__grid">
              <Card
                className="ops-page__panel"
                title={<PanelTitle title="Alertas" icon={Bell} />}
                actions={
                  <OperationalStatusPill
                    status={status.alerting.enabled ? 'ATIVO' : 'DISABLED'}
                  />
                }
              >
                <DetailRows
                  rows={[
                    {
                      label: 'Webhook',
                      value: status.alerting.webhookConfigured
                        ? 'Configurado'
                        : 'Ausente'
                    },
                    {
                      label: 'Intervalo de verificação',
                      value: duration(status.alerting.intervalMs)
                    }
                  ]}
                />
              </Card>
              <Card
                className="ops-page__panel"
                title={
                  <PanelTitle title="Monitoramento de erros" icon={Activity} />
                }
                actions={
                  <OperationalStatusPill
                    status={status.errorTracking.enabled ? 'ATIVO' : 'DISABLED'}
                  />
                }
              >
                <p className="ops-page__note">
                  {status.errorTracking.provider}
                </p>
              </Card>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );

  return (
    <AppShell
      navigation={navigation}
      title="Sincronizações"
      contentWidth="fluid"
      breadcrumb={[
        preview
          ? { label: 'Visualização', href: '/visualizar' }
          : { label: 'Filtrovali', href: '/modulos' },
        { label: 'Sincronizações' }
      ]}
      profile={
        preview
          ? {
              name: 'Administrador de demonstração',
              description: 'Visualização local'
            }
          : user
            ? {
                name: user.name,
                description: user.email || user.username,
                onOpen: () =>
                  navigate('/conta', {
                    state: accountPageStateFromPath(location)
                  })
              }
            : undefined
      }
      onLogout={
        preview
          ? undefined
          : async () => {
              await logout();
              navigate('/login', { replace: true });
            }
      }
    >
      {content}
    </AppShell>
  );
}
