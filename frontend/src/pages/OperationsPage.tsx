import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { getOperationalStatus, type OperationalFileStatus, type OperationalStatus } from '../api/operations';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../layout/Shell';
import { TopBar } from '../layout/TopBar';

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
  if (['NOT_CONFIGURED', 'RUNNING', 'SEM_EXECUCAO'].includes(status)) return 'is-muted';
  return 'is-bad';
}

function StatusPill({ status }: { status: string }) {
  return <span className={`ops-pill ${statusClass(status)}`}>{status}</span>;
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

export function OperationsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['operations', 'status'],
    queryFn: getOperationalStatus,
    refetchInterval: 60_000
  });

  return (
    <Shell>
      <TopBar
        title="Operação"
        subtitle={user?.name}
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => refetch()} disabled={isFetching}>
              Atualizar
            </button>
            <button className="topbar-chip" type="button" onClick={() => navigate('/modulos')}>
              Módulos
            </button>
            <button className="topbar-chip" type="button" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>
              Sair
            </button>
          </>
        }
      />
      <main className="ops-page">
        {isLoading && <div className="ops-panel">Carregando...</div>}
        {error && <div className="ops-panel ops-error">Não foi possível carregar o status operacional.</div>}
        {data && (
          <>
            <section className={`ops-summary ${data.ok ? 'is-ok' : 'is-bad'}`}>
              <div>
                <span>Status geral</span>
                <strong>{data.ok ? 'Operação OK' : 'Atenção operacional'}</strong>
              </div>
              <span>{dateTime(data.generatedAt)}</span>
            </section>

            {!!data.problems.length && (
              <section className="ops-panel ops-panel--wide">
                <div className="ops-panel-head">
                  <h2>Problemas</h2>
                  <span className="ops-count">{data.problems.length}</span>
                </div>
                <ul className="ops-problems">
                  {data.problems.map((problem, index) => (
                    <li key={`${problem.message}-${index}`}>{problem.message}</li>
                  ))}
                </ul>
              </section>
            )}

            <div className="ops-grid">
              <FileStatusCard title="Backup" item={data.backup} />
              <FileStatusCard title="Restore" item={data.restore} />
              <section className="ops-panel">
                <div className="ops-panel-head">
                  <h2>Alertas</h2>
                  <StatusPill status={data.alerting.enabled ? 'ATIVO' : 'NOT_CONFIGURED'} />
                </div>
                <div className="ops-metric-grid">
                  <div>
                    <span>Webhook</span>
                    <strong>{data.alerting.webhookConfigured ? 'Configurado' : 'Ausente'}</strong>
                  </div>
                  <div>
                    <span>Intervalo</span>
                    <strong>{duration(data.alerting.intervalMs)}</strong>
                  </div>
                </div>
              </section>
              <section className="ops-panel">
                <div className="ops-panel-head">
                  <h2>Erros</h2>
                  <StatusPill status={data.errorTracking.enabled ? 'ATIVO' : 'NOT_CONFIGURED'} />
                </div>
                <p className="ops-note">{data.errorTracking.provider}</p>
              </section>
              <JobsPanel status={data} />
            </div>
          </>
        )}
      </main>
    </Shell>
  );
}
