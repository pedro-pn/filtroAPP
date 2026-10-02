import { BrandLoading } from '../components/brand/BrandLoading';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { getOperationalStatus, type OperationalFileStatus, type OperationalStatus } from '../api/operations';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/ds';
import { AppShell } from '../layout/AppShell';
import { NAVIGATION_CHROME_ICONS } from '../layout/navigationIcons';
import type { NavigationModel } from '../layout/navigationModel';
import { PageHeader } from '../layout/PageHeader';
import './OperationsPage.ds.css';

const previewStatus: OperationalStatus = {
  ok: false,
  generatedAt: '2026-10-01T14:35:00.000Z',
  problems: [{ message: 'Backup diário atrasado. Confira a última execução.' }],
  jobs: {
    recurring: [
      { name: 'Backup diário', latestRun: { id: 'demo-1', name: 'Backup diário', status: 'FAILED', startedAt: '2026-09-30T02:00:00.000Z', finishedAt: '2026-09-30T02:02:00.000Z', durationMs: 120000, metadata: null, result: null, error: 'Falha de exemplo' } },
      { name: 'Sincronização Omie', latestRun: { id: 'demo-2', name: 'Sincronização Omie', status: 'SUCCESS', startedAt: '2026-10-01T12:00:00.000Z', finishedAt: '2026-10-01T12:04:00.000Z', durationMs: 240000, metadata: null, result: null, error: null } }
    ],
    dataRetention: { latestRun: null },
    reportApprovalPostProcessing: { counts: {}, latestFailed: null },
    activeLocks: []
  },
  backup: { configured: true, status: 'FAILED', finishedAt: '2026-09-30T02:02:00.000Z', ageMs: 131580000, maxAgeMs: 86400000, message: 'Aguardando próxima execução.' },
  restore: { configured: true, status: 'SUCCESS', finishedAt: '2026-09-29T10:30:00.000Z', ageMs: 187500000, maxAgeMs: 604800000 },
  omie: { configured: true, enabled: true, status: 'SUCCESS', latestRun: { id: 'demo-omie', integration: 'OMIE', scope: 'Projetos', status: 'SUCCESS', recordsRead: 124, recordsWritten: 8, error: null, summary: null, triggeredBy: 'Agendamento', startedAt: '2026-10-01T12:00:00.000Z', finishedAt: '2026-10-01T12:04:00.000Z' }, scopes: [] },
  commercialImport: { configured: true, status: 'SUCCESS', latestImport: { id: 'demo-import', fileName: 'propostas-outubro.xlsx', source: 'UPLOAD', status: 'SUCCESS', rowsRead: 38, created: 2, updated: 4, skipped: 32, pendingProjectsCreated: 0, error: null, summary: null, importedByUserId: null, createdAt: '2026-10-01T09:15:00.000Z' } },
  errorTracking: { enabled: true, provider: 'Monitoramento ativo' },
  alerting: { enabled: true, webhookConfigured: true, intervalMs: 300000 }
};

function dateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function duration(value?: number | null) {
  if (!Number.isFinite(value)) return '—';
  const totalMinutes = Math.round(Number(value) / 60000);
  if (totalMinutes <= 0) return '< 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
}

function statusClass(status: string) {
  if (['SUCCESS', 'COMPLETED', 'SKIPPED', 'ATIVO'].includes(status)) return 'is-ok';
  if (['NOT_CONFIGURED', 'RUNNING', 'SEM_EXECUCAO', 'SEM_RECEBIMENTO'].includes(status)) return 'is-muted';
  return 'is-bad';
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    SUCCESS: 'Concluído', COMPLETED: 'Concluído', SKIPPED: 'Ignorado', FAILED: 'Falhou',
    RUNNING: 'Em andamento', NOT_CONFIGURED: 'Não configurado', SEM_EXECUCAO: 'Sem execução',
    SEM_RECEBIMENTO: 'Sem recebimento', ATIVO: 'Ativo'
  };
  return labels[status] || status;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`ops-pill ${statusClass(status)}`}>{statusLabel(status)}</span>;
}

function DetailRows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className="ops-detail-list">
      {rows.map(row => (
        <div className="ops-detail-row" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FileStatusCard({ title, item }: { title: string; item: OperationalFileStatus }) {
  return (
    <section className="ops-panel">
      <div className="ops-panel-head">
        <h2>{title}</h2>
        <StatusPill status={item.status} />
      </div>
      <div className="ops-metric-grid">
        <div>
          <span>Última execução</span>
          <strong>{dateTime(item.finishedAt || item.startedAt)}</strong>
        </div>
        <div>
          <span>Idade</span>
          <strong>{duration(item.ageMs)}</strong>
        </div>
        <div>
          <span>Limite</span>
          <strong>{duration(item.maxAgeMs)}</strong>
        </div>
      </div>
      {(item.runDir || item.backupSource || item.message) && (
        <p className="ops-note">{item.runDir || item.backupSource || item.message}</p>
      )}
    </section>
  );
}

function OmieStatusCard({ item }: { item: OperationalStatus['omie'] }) {
  const run = item.latestRun;
  return (
    <section className="ops-panel">
      <div className="ops-panel-head">
        <h2>Omie</h2>
        <StatusPill status={item.status} />
      </div>
      <DetailRows rows={[
        { label: 'Última sincronização', value: dateTime(run?.finishedAt || run?.startedAt) },
        { label: 'Escopo', value: run?.scope || '—' },
        { label: 'Lidos / gravados', value: run ? `${run.recordsRead} / ${run.recordsWritten}` : '—' }
      ]} />
      {(run?.error || run?.triggeredBy || !item.configured) && (
        <p className="ops-note">{run?.error || (item.configured ? `Origem: ${run?.triggeredBy || '—'}` : 'Credenciais Omie não configuradas.')}</p>
      )}
    </section>
  );
}

function CommercialImportCard({ item }: { item: OperationalStatus['commercialImport'] }) {
  const lastImport = item.latestImport;
  const duplicate = lastImport?.summary?.skippedDuplicate === true;
  return (
    <section className="ops-panel">
      <div className="ops-panel-head">
        <h2>Banco comercial</h2>
        <StatusPill status={item.status} />
      </div>
      <DetailRows rows={[
        { label: 'Último recebimento', value: dateTime(lastImport?.createdAt) },
        { label: 'Arquivo', value: lastImport?.fileName || '—' },
        { label: 'Lidas / alteradas', value: lastImport ? `${lastImport.rowsRead} / ${lastImport.created + lastImport.updated}` : '—' }
      ]} />
      {(lastImport?.error || duplicate || !item.configured) && (
        <p className="ops-note">
          {lastImport?.error || (duplicate ? 'Arquivo recebido novamente sem reprocessar propostas.' : 'Token de recebimento não configurado.')}
        </p>
      )}
    </section>
  );
}

function JobsPanel({ status }: { status: OperationalStatus }) {
  return (
    <section className="ops-panel ops-panel--wide">
      <div className="ops-panel-head">
        <h2>Jobs recorrentes</h2>
        <span className="ops-count">{status.jobs.activeLocks.length} locks ativos</span>
      </div>
      <div className="ops-table" role="table">
        {status.jobs.recurring.map(job => (
          <div className="ops-row" role="row" key={job.name}>
            <span>{job.name}</span>
            <span>{job.latestRun ? <StatusPill status={job.latestRun.status} /> : <StatusPill status="SEM_EXECUCAO" />}</span>
            <span>{dateTime(job.latestRun?.finishedAt || job.latestRun?.startedAt)}</span>
            <span>{duration(job.latestRun?.durationMs)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function OperationsPage({ preview = false }: { preview?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['operations', 'status'],
    queryFn: getOperationalStatus,
    refetchInterval: preview ? false : 60_000,
    enabled: !preview
  });
  const navigation = useMemo<NavigationModel>(() => ({ groups: [{ id: 'principal', label: 'Principal', items: [
    { id: 'hub', label: 'Visão geral', href: '/modulos', group: 'principal', icon: NAVIGATION_CHROME_ICONS.home, active: false },
    { id: 'operations', label: 'Operações', href: preview ? '/visualizar/operacoes' : '/operacoes', group: 'principal', icon: NAVIGATION_CHROME_ICONS.operations, active: true }
  ] }] }), [preview]);
  const status = preview ? previewStatus : data;

  return (
    <AppShell navigation={navigation} title="Operações" breadcrumb={[{ label: 'Filtrovali', href: '/modulos' }, { label: 'Operações' }]} contentWidth="fluid" profile={preview ? { name: 'Administrador de demonstração', description: 'Visualização local' } : user ? { name: user.name, description: user.email || user.username } : undefined} onLogout={preview ? undefined : async () => { await logout(); navigate('/login', { replace: true }); }}>
      <main className="fv-ds ops-page ops-page-v2" data-fv-ds>
        <PageHeader title="Saúde da operação" description="Acompanhe integrações, rotinas e arquivos essenciais do sistema." actions={<Button variant="secondary" size="sm" type="button" onClick={() => { if (!preview) void refetch(); }} disabled={isFetching || preview}>Atualizar</Button>} />
        {preview ? <div className="ops-preview-note">Demonstração visual · dados fictícios · <a href="/visualizar">ver todos os links</a></div> : null}
        {!preview && isLoading && <div className="ops-panel"><BrandLoading label="Carregando" /></div>}
        {!preview && error && <div className="ops-panel ops-error">Não foi possível carregar o status operacional.</div>}
        {status && (
          <>
            <section className={`ops-summary ${status.ok ? 'is-ok' : 'is-bad'}`}>
              <div>
                <span>Status geral</span>
                <strong>{status.ok ? 'Operação OK' : 'Atenção operacional'}</strong>
              </div>
              <span>{dateTime(status.generatedAt)}</span>
            </section>

            {!!status.problems.length && (
              <section className="ops-panel ops-panel--wide">
                <div className="ops-panel-head">
                  <h2>Problemas</h2>
                  <span className="ops-count">{status.problems.length}</span>
                </div>
                <ul className="ops-problems">
                  {status.problems.map((problem, index) => (
                    <li key={`${problem.message}-${index}`}>{problem.message}</li>
                  ))}
                </ul>
              </section>
            )}

            <div className="ops-grid">
              <FileStatusCard title="Backup" item={status.backup} />
              <FileStatusCard title="Restore" item={status.restore} />
              <OmieStatusCard item={status.omie} />
              <CommercialImportCard item={status.commercialImport} />
              <section className="ops-panel">
                <div className="ops-panel-head">
                  <h2>Alertas</h2>
                  <StatusPill status={status.alerting.enabled ? 'ATIVO' : 'NOT_CONFIGURED'} />
                </div>
                <div className="ops-metric-grid">
                  <div>
                    <span>Webhook</span>
                    <strong>{status.alerting.webhookConfigured ? 'Configurado' : 'Ausente'}</strong>
                  </div>
                  <div>
                    <span>Intervalo</span>
                    <strong>{duration(status.alerting.intervalMs)}</strong>
                  </div>
                </div>
              </section>
              <section className="ops-panel">
                <div className="ops-panel-head">
                  <h2>Erros</h2>
                  <StatusPill status={status.errorTracking.enabled ? 'ATIVO' : 'NOT_CONFIGURED'} />
                </div>
                <p className="ops-note">{status.errorTracking.provider}</p>
              </section>
              <JobsPanel status={status} />
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}
