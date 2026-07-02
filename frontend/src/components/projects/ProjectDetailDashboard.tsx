import { useQuery } from '@tanstack/react-query';

import {
  getPlannedScope,
  getProjectDetail,
  type DayStatus,
  type PlannedScope
} from '../../api/acompanhamentoComercial';

const SERVICE_LABELS: Record<string, string> = {
  LIMPEZA_QUIMICA: 'Limpeza química',
  TESTE_PRESSAO: 'Teste de pressão',
  FLUSHING: 'Flushing',
  FILTRAGEM: 'Filtragem'
};
const SYSTEM_LABELS: Record<string, string> = { TUBULACAO: 'Tubulações', OLEO: 'Óleo' };
const UNIT_LABELS: Record<string, string> = { M: 'm', KG: 'kg', T: 't', UN: 'un', L: 'L' };
const DAY_META: Record<DayStatus, { cls: string; label: string }> = {
  TRABALHADO: { cls: 'green', label: 'Trabalhado' },
  STANDBY: { cls: 'yellow', label: 'Trabalhado com standby' },
  PARADO: { cls: 'red', label: 'Parado (jornada cheia)' }
};

const brl = (n?: number | null) =>
  n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (n?: number | null) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
function fmtHM(minutes?: number | null) {
  if (!minutes || minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function Bar({ value, tone }: { value: number | null; tone?: 'cost' }) {
  const clamped = Math.min(Math.max(value ?? 0, 0), 100);
  return (
    <div className={`acp-prog-bar big ${tone === 'cost' && (value ?? 0) > 100 ? 'over' : ''}`}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}

function MetricBar({ label, value, caption, tone }: { label: string; value: number | null; caption: string; tone?: 'cost' }) {
  return (
    <div className="acp-det-metric">
      <div className="acp-det-metric-top">
        <span>{label}</span>
        <span className="acp-det-metric-val">{caption}</span>
      </div>
      <Bar value={value} tone={tone} />
    </div>
  );
}

function PlannedScopeView({ scope }: { scope?: PlannedScope }) {
  if (!scope || scope.services.length === 0) {
    return <div className="placeholder-copy">Nenhum escopo cadastrado.</div>;
  }
  return (
    <div className="acp-det-scope">
      {scope.services.map((svc, i) => (
        <div className="acp-det-scope-svc" key={i}>
          <div className="acp-det-scope-head">
            <span>{SERVICE_LABELS[svc.serviceType] ?? svc.serviceType}</span>
            <span className="acp-det-scope-weight">peso {Number(svc.weight ?? 1).toLocaleString('pt-BR')}</span>
          </div>
          <ul>
            {svc.systems.map((sys, j) => (
              <li key={j}>
                {SYSTEM_LABELS[sys.systemType] ?? sys.systemType}: {sys.quantity ?? '—'} {sys.unit ? UNIT_LABELS[sys.unit] ?? '' : ''}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Dashboard detalhado de um projeto (aberto ao clicar num card da aba Projetos).
export function ProjectDetailDashboard({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['project-detail', projectId], queryFn: () => getProjectDetail(projectId) });
  const { data: scope } = useQuery({ queryKey: ['planned-scope', projectId], queryFn: () => getPlannedScope(projectId) });

  if (isLoading || !data) {
    return (
      <div className="acp-det">
        <button type="button" className="mini-btn alt" onClick={onBack}>← Voltar</button>
        <div className="page-card placeholder-copy" style={{ marginTop: 12 }}>Carregando projeto…</div>
      </div>
    );
  }

  const h = data.header;
  const headerBits = [
    `Missão ${h.code}`,
    h.clientName,
    h.proposalCode ? `Proposta ${h.proposalCode}` : null,
    `Última atualização ${fmtDate(h.lastRdoDate)}`,
    h.segment
  ].filter(Boolean);

  return (
    <div className="acp-det">
      <div className="acp-det-bar">
        <button type="button" className="mini-btn alt" onClick={onBack}>← Voltar</button>
      </div>

      <div className="page-card acp-det-header">
        <h2>{headerBits.join('  ·  ')}</h2>
      </div>

      <div className="acp-det-cols">
        {/* Coluna 1 */}
        <div className="acp-det-col">
          <div className="page-card acp-det-block">
            <MetricBar
              label="Dias corridos"
              value={data.diasCorridos.pct}
              caption={`${data.diasCorridos.elapsed ?? '—'}/${data.diasCorridos.planned ?? '—'}${data.diasCorridos.pct != null ? ` · ${data.diasCorridos.pct}%` : ''}`}
            />
            <MetricBar
              label="Dias trabalhados"
              value={data.diasTrabalhados.pct}
              caption={`${data.diasTrabalhados.worked}/${data.diasTrabalhados.planned ?? '—'}${data.diasTrabalhados.pct != null ? ` · ${data.diasTrabalhados.pct}%` : ''}`}
            />
          </div>

          <div className="page-card acp-det-block">
            <MetricBar
              label="Consumo de gastos"
              value={data.consumo.pct}
              tone="cost"
              caption={`${brl(data.consumo.gasto)} / ${brl(data.consumo.previsto)}${data.consumo.pct != null ? ` · ${data.consumo.pct}%` : ''}`}
            />
            <div className="acp-det-sub">Maiores gastos (sem salários)</div>
            {data.maioresGastos.length === 0 ? (
              <div className="placeholder-copy">Sem gastos registrados no Omie.</div>
            ) : (
              <ul className="acp-det-rank">
                {data.maioresGastos.map((g, i) => (
                  <li key={i}><span className="acp-det-rank-cat">{g.categoria}</span><span className="acp-det-rank-val">{brl(g.total)}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Coluna 2 */}
        <div className="acp-det-col">
          <div className="page-card acp-det-block">
            <div className="acp-det-avanco">
              <div className="acp-det-metric-top"><span>Avanço do escopo</span><span className="acp-det-metric-val">{fmtPct(data.avancoPct)}</span></div>
              <Bar value={data.avancoPct} />
            </div>

            <div className="acp-det-two">
              <div><span className="acp-det-kpi-label">Standby</span><strong>{data.standby.count}</strong><span className="acp-det-kpi-sub">dia(s)</span></div>
              <div><span className="acp-det-kpi-label">Hora total parada</span><strong>{fmtHM(data.standby.minutes)}</strong></div>
            </div>

            <div className="acp-det-sub">Últimos dias</div>
            <div className="acp-det-dots">
              {data.ultimosDias.length === 0 ? (
                <span className="placeholder-copy">Sem RDOs.</span>
              ) : data.ultimosDias.map((d, i) => (
                <div
                  key={i}
                  className={`acp-det-dot ${DAY_META[d.status].cls}`}
                  title={`${fmtDate(d.date)} — ${DAY_META[d.status].label}. Trabalhado: ${fmtHM(d.workedMinutes)} · Standby: ${fmtHM(d.standbyMinutes)}`}
                />
              ))}
            </div>

            <div className="acp-det-two" style={{ marginTop: 10 }}>
              <div><span className="acp-det-kpi-label">Horas extras</span><strong>{fmtHM(data.overtimeMinutes)}</strong></div>
            </div>
          </div>
        </div>

        {/* Coluna 3 */}
        <div className="acp-det-col">
          <div className="page-card acp-det-block">
            <div className="acp-det-sub">Colaboradores na obra ({data.colaboradores.length})</div>
            {data.colaboradores.length === 0 ? (
              <div className="placeholder-copy">Nenhum colaborador nos RDOs.</div>
            ) : (
              <ul className="acp-det-collabs">
                {data.colaboradores.map((c, i) => (
                  <li key={i}><span>{c.name}</span><span className="acp-det-collab-role">{c.role}</span></li>
                ))}
              </ul>
            )}
          </div>

          <div className="page-card acp-det-block">
            <div className="acp-det-sub">Escopo cadastrado</div>
            <PlannedScopeView scope={scope} />
          </div>
        </div>
      </div>

      <div className="page-card acp-det-footer">
        <div><span>Mobilização</span><strong>{fmtDate(data.footer.mobilizationDate)}</strong></div>
        <div><span>Início</span><strong>{fmtDate(data.footer.startDate)}</strong></div>
        <div><span>Previsão de término</span><strong>{fmtDate(data.footer.expectedEndDate)}</strong></div>
        <div><span>Previsão pelo ritmo</span><strong>{fmtDate(data.footer.projectedEndByPace)}</strong></div>
      </div>
    </div>
  );
}
