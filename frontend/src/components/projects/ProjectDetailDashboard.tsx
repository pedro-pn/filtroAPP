import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';

import {
  createProjectManagementNote,
  createManualProjectCost,
  deleteManualProjectCost,
  getMissionGroupDetail,
  getPlannedScope,
  getProjectPlanningContext,
  getProjectDetail,
  listProjectManagementNotes,
  type BudgetBreakdownSlice,
  type DayStatus,
  type ManualProjectCost,
  type ManualProjectCostPayload,
  type PlannedScope,
  type ProjectDetailCollaborator,
  type ProjectManagementNote,
  type ProgressHistoryPoint,
  type RequiredWeeklyProgress,
  type RequiredWeeklyProgressStatus
} from '../../api/acompanhamentoComercial';
import { listProjectQualityDeviations, type ProjectDeviation } from '../../api/qualidade';
import { HelpTip } from '../ui/HelpTip';
import { Modal } from '../ui/Modal';
import { PortalTip } from '../ui/PortalTip';
import { ProjectScheduleEditor, type ScheduleEditorHandle } from './ProjectScheduleEditor';
import { ProjectAdditionalProposalsNovelty } from './ProjectAdditionalProposalsNovelty';
import { ProjectCollaboratorHoursDialog } from './ProjectCollaboratorHoursDialog';
import { ProjectManualCostNovelty } from './ProjectManualCostNovelty';
import { ProjectQualityDeviationsNovelty } from './ProjectQualityDeviationsNovelty';
import { ProjectProgressHistoryNovelty } from './ProjectProgressHistoryNovelty';
import { ProjectReportsDialog } from './ProjectReportsDialog';
import { ProjectRomaneiosDialog } from './ProjectRomaneiosDialog';
import { ProjectStandbyHistoryDialog } from './ProjectStandbyHistoryDialog';
import { ProjectStandbyHistoryNovelty } from './ProjectStandbyHistoryNovelty';
import { ProjectWeeklyTargetNovelty } from './ProjectWeeklyTargetNovelty';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';
import type { AuthUser } from '../../types/auth';

const SERVICE_LABELS: Record<string, string> = {
  LIMPEZA_QUIMICA: 'Limpeza química',
  TESTE_PRESSAO: 'Teste de pressão',
  FLUSHING: 'Flushing',
  FILTRAGEM: 'Filtragem'
};
const SYSTEM_LABELS: Record<string, string> = { TUBULACAO: 'Tubulações', OLEO: 'Óleo' };
const UNIT_LABELS: Record<string, string> = { M: 'm', KG: 'kg', T: 't', UN: 'un', L: 'L' };
const QUALITY_IMPACT_LABELS: Record<string, string> = { ALTO: 'Alto', MEDIO: 'Médio', BAIXO: 'Baixo' };
const QUALITY_STATUS_LABELS: Record<string, string> = {
  ABERTO: 'Aberto',
  EM_TRIAGEM: 'Em triagem',
  EM_OBSERVACAO: 'Em observação',
  EM_ACAO: 'Em ação',
  FECHADO: 'Fechado',
  DIVULGADO: 'Divulgado'
};
const QUALITY_DISPOSITION_LABELS: Record<string, string> = {
  TRATAR: 'Tratar',
  MONITORAR: 'Monitorar',
  ARQUIVAR_DIVULGAR: 'Arquivar / Divulgar'
};
const DAY_META: Record<DayStatus, { cls: string; label: string }> = {
  TRABALHADO: { cls: 'green', label: 'Trabalhado' },
  STANDBY: { cls: 'yellow', label: 'Trabalhado com standby' },
  PARADO: { cls: 'red', label: 'Parado (jornada cheia)' }
};

interface ManualCostFormValues {
  description: string;
  amount: string;
  costDate: string;
  note: string;
}

const manualCostFormDefaultValues: ManualCostFormValues = {
  description: '',
  amount: '',
  costDate: '',
  note: ''
};

function parseBrlCurrencyInput(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return Number.NaN;
  return Number(digits) / 100;
}

function formatBrlCurrencyInput(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  const amount = (Number(digits) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `R$ ${amount}`;
}

function qualityImpactBadgeClass(impact: string) {
  if (impact === 'ALTO') return 'badge badge-rej';
  if (impact === 'MEDIO') return 'badge badge-pen';
  return 'badge badge-ok';
}

const manualCostFormSchema = z.object({
  description: z.string().trim().min(1, 'Informe a descrição.').max(120, 'Use até 120 caracteres.'),
  amount: z.string().trim().min(1, 'Informe o valor.').superRefine((value, ctx) => {
    const amount = parseBrlCurrencyInput(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um valor maior que zero.' });
      return;
    }
    if (amount > 999999999.99) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valor muito alto.' });
    }
  }),
  costDate: z.string().trim().refine(value => !value || !Number.isNaN(new Date(value).getTime()), 'Informe uma data válida.'),
  note: z.string().trim().max(500, 'Use até 500 caracteres.')
});

function zodErrorToFormErrors(error: z.ZodError) {
  return error.issues.reduce<Record<string, { type: string; message: string }>>((acc, issue) => {
    const key = String(issue.path[0] || 'form');
    if (!acc[key]) acc[key] = { type: 'manual', message: issue.message };
    return acc;
  }, {});
}

const manualCostFormResolver: Resolver<ManualCostFormValues> = async values => {
  const result = manualCostFormSchema.safeParse(values);
  if (result.success) return { values: result.data, errors: {} };
  return { values: {}, errors: zodErrorToFormErrors(result.error) };
};

function manualCostFormValuesToPayload(values: ManualCostFormValues): ManualProjectCostPayload {
  return {
    description: values.description.trim(),
    amount: parseBrlCurrencyInput(values.amount),
    costDate: values.costDate.trim() || null,
    note: values.note.trim() || null
  };
}

const brl = (n?: number | null) =>
  n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
const fmtPct = (n?: number | null) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const fmtHours = (n?: number | null) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`;
const toNum = (value?: string | number | null) => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
function fmtShortDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function fmtHM(minutes?: number | null) {
  if (!minutes || minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function clampPct(value?: number | null, max = 100) {
  return Math.min(Math.max(value ?? 0, 0), max);
}

function mutationErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ error?: string }>(error)) {
    const message = error.response?.data?.error;
    if (message) return message;
  }
  return error instanceof Error ? error.message : fallback;
}

function hasMoney(value?: string | number | null) {
  const n = toNum(value);
  return n !== null && Math.abs(n) > 0.005;
}

function proposalContributionLabel(proposal: BudgetBreakdownSlice, fallback: string) {
  const code = proposal.codProp ? `Proposta ${proposal.codProp}` : fallback;
  const revision = proposal.nRev !== null && proposal.nRev !== undefined ? ` · Rev ${proposal.nRev}` : '';
  return `${code}${revision}`;
}

function ProposalContributionDetails({
  original,
  additionals
}: {
  original?: BudgetBreakdownSlice | null;
  additionals?: BudgetBreakdownSlice[];
}) {
  const rows = [
    original ? { ...original, contributionKind: 'ORIGINAL' as const } : null,
    ...(additionals ?? []).map(item => ({ ...item, contributionKind: 'ADDITIONAL' as const }))
  ].filter((item): item is BudgetBreakdownSlice & { contributionKind: 'ORIGINAL' | 'ADDITIONAL' } => Boolean(item));

  if (rows.length <= 1 || !(additionals ?? []).some(item => (
    hasMoney(item.salePrice) || hasMoney(item.plannedTotalCost) || hasMoney(item.expectedProfit) || hasMoney(item.taxes)
  ))) {
    return null;
  }

  return (
    <details className="acp-proposal-details">
      <summary className="acp-det-collabs-summary" data-acp-proposal-contributions>
        Composição das propostas
        <span className="acp-proposal-count">{rows.length} propostas</span>
      </summary>
      <div className="acp-proposal-list">
        {rows.map((proposal, index) => (
          <div className="acp-proposal-item" key={`${proposal.contributionKind}-${proposal.codBd ?? proposal.codProp ?? index}`}>
            <div className="acp-proposal-item-head">
              <strong>{proposalContributionLabel(proposal, proposal.contributionKind === 'ORIGINAL' ? 'Proposta original' : 'Proposta adicional')}</strong>
              <span>{proposal.contributionKind === 'ORIGINAL' ? 'Original' : 'Adicional'}</span>
            </div>
            <div className="acp-proposal-grid">
              <div><span>Venda</span><strong>{brl(toNum(proposal.salePrice))}</strong></div>
              <div><span>Custo</span><strong>{brl(toNum(proposal.plannedTotalCost))}</strong></div>
              <div><span>Lucro</span><strong>{brl(toNum(proposal.expectedProfit))}</strong></div>
              <div><span>Impostos</span><strong>{brl(toNum(proposal.taxes))}</strong></div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function Bar({ value, tone }: { value: number | null; tone?: 'cost' }) {
  const clamped = clampPct(value);
  return (
    <div className={`acp-prog-bar big ${tone === 'cost' && (value ?? 0) > 100 ? 'over' : ''}`}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}

function HoursBar({ normalPct, overtimePct }: { normalPct: number | null; overtimePct: number | null }) {
  const normalWidth = clampPct(normalPct);
  const overtimeWidth = clampPct(overtimePct, 100 - normalWidth);
  return (
    <div className="acp-prog-bar big acp-hours-bar">
      {normalWidth > 0 ? <span className="normal" style={{ width: `${normalWidth}%` }} /> : null}
      {overtimeWidth > 0 ? <span className="overtime" style={{ width: `${overtimeWidth}%` }} /> : null}
    </div>
  );
}

function normalizeHistory(points?: ProgressHistoryPoint[]) {
  return (points ?? [])
    .map(point => {
      const time = new Date(point.date).getTime();
      const progressPct = Number(point.progressPct);
      return Number.isFinite(time) && Number.isFinite(progressPct)
        ? { ...point, time, progressPct: clampPct(progressPct) }
        : null;
    })
    .filter((point): point is ProgressHistoryPoint & { time: number } => point !== null)
    .sort((a, b) => a.time - b.time);
}

function ProgressHistoryChart({ points }: { points?: ProgressHistoryPoint[] }) {
  const history = normalizeHistory(points);
  const [activePoint, setActivePoint] = useState<(ProgressHistoryPoint & { time: number; x: number; y: number }) | null>(null);
  const [chartWidth, setChartWidth] = useState(280);
  const chartRef = useRef<SVGSVGElement>(null);
  const hasHistory = history.length > 0;

  useEffect(() => {
    if (!hasHistory) return;
    const chart = chartRef.current;
    if (!chart) return;

    const updateWidth = (measuredWidth: number) => {
      const nextWidth = Math.max(1, Math.round(measuredWidth));
      setChartWidth(currentWidth => currentWidth === nextWidth ? currentWidth : nextWidth);
    };
    updateWidth(chart.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(chart);
    return () => observer.disconnect();
  }, [hasHistory]);

  const latest = history[history.length - 1];
  if (history.length === 0) {
    return (
      <div className="acp-progress-chart empty" data-acp-progress-history-chart>
        <div className="acp-progress-chart-head">
          <span>Histórico semanal</span>
          <strong>Sem histórico</strong>
        </div>
      </div>
    );
  }

  const width = chartWidth;
  const height = 112;
  const pad = { top: 10, right: 10, bottom: 22, left: 30 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const minTime = history[0].time;
  const maxTime = history[history.length - 1].time;
  const xFor = (time: number, index: number) => (
    minTime === maxTime
      ? pad.left + (history.length === 1 ? plotWidth / 2 : (plotWidth * index) / (history.length - 1))
      : pad.left + ((time - minTime) / (maxTime - minTime)) * plotWidth
  );
  const yFor = (value: number) => pad.top + (1 - clampPct(value) / 100) * plotHeight;
  const plotted = history.map((point, index) => ({
    ...point,
    x: xFor(point.time, index),
    y: yFor(point.progressPct)
  }));
  const path = plotted.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const tipWidth = 138;
  const tipHeight = 42;
  const tooltip = activePoint ? (() => {
    const above = activePoint.y > tipHeight + 12;
    const x = Math.max(2, Math.min(width - tipWidth - 2, activePoint.x - tipWidth / 2));
    const y = above ? activePoint.y - tipHeight - 9 : activePoint.y + 9;
    return {
      x,
      y,
      above,
      arrowX: activePoint.x - x,
      day: fmtDate(activePoint.date),
      amount: fmtPct(activePoint.progressPct)
    };
  })() : null;
  const pointLabel = (point: ProgressHistoryPoint) => `Dia: ${fmtDate(point.date)} · Quantidade: ${fmtPct(point.progressPct)}`;

  return (
    <div className="acp-progress-chart" aria-label="Histórico semanal de avanço" data-acp-progress-history-chart>
      <div className="acp-progress-chart-head">
        <span>Histórico semanal</span>
        <strong>{fmtPct(latest?.progressPct)}</strong>
      </div>
      <svg ref={chartRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Avanço de ${fmtShortDate(history[0].date)} até ${fmtShortDate(latest?.date)}`}>
        {[0, 50, 100].map(value => (
          <g key={value}>
            <line
              className="acp-progress-chart-grid"
              x1={pad.left}
              y1={yFor(value)}
              x2={width - pad.right}
              y2={yFor(value)}
            />
            <text className="acp-progress-chart-y" x={pad.left - 6} y={yFor(value) + 3} textAnchor="end">
              {value}
            </text>
          </g>
        ))}
        <path className="acp-progress-chart-line" d={path} />
        {plotted.map(point => (
          <g
            className="acp-progress-chart-point"
            key={`${point.date}-${point.progressPct}`}
            tabIndex={0}
            aria-label={pointLabel(point)}
            onFocus={() => setActivePoint(point)}
            onBlur={() => setActivePoint(null)}
            onMouseEnter={() => setActivePoint(point)}
            onMouseLeave={() => setActivePoint(null)}
          >
            <circle className="acp-progress-chart-dot-hit" cx={point.x} cy={point.y} r="8" />
            <circle className="acp-progress-chart-dot" cx={point.x} cy={point.y} r="3.4" />
          </g>
        ))}
        <text className="acp-progress-chart-x" x={pad.left} y={height - 4} textAnchor="start">
          {fmtShortDate(history[0].date)}
        </text>
        <text className="acp-progress-chart-x" x={width - pad.right} y={height - 4} textAnchor="end">
          {fmtShortDate(latest?.date)}
        </text>
        {tooltip ? (
          <g className="acp-progress-chart-tip" transform={`translate(${tooltip.x} ${tooltip.y})`}>
            <rect width={tipWidth} height={tipHeight} rx="6" />
            <path
              className="acp-progress-chart-tip-arrow"
              d={tooltip.above
                ? `M ${tooltip.arrowX - 5} ${tipHeight - 1} L ${tooltip.arrowX} ${tipHeight + 5} L ${tooltip.arrowX + 5} ${tipHeight - 1} Z`
                : `M ${tooltip.arrowX - 5} 1 L ${tooltip.arrowX} -5 L ${tooltip.arrowX + 5} 1 Z`}
            />
            <text className="acp-progress-chart-tip-date" x="10" y="15">{tooltip.day}</text>
            <text className="acp-progress-chart-tip-label" x="10" y="32">Quantidade</text>
            <text className="acp-progress-chart-tip-value" x={tipWidth - 10} y="32" textAnchor="end">{tooltip.amount}</text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

const fmtQuantity = (value?: number | null, unit?: string | null) => (
  value == null
    ? '—'
    : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${unit ? ` ${UNIT_LABELS[unit] ?? unit}` : ''}`
);

function weeklyTargetText(
  status: RequiredWeeklyProgressStatus,
  remaining: number | null,
  required: number | null,
  suffix: string
) {
  if (status === 'COMPLETED') return 'Meta concluída';
  if (status === 'OVERDUE') return `Prazo vencido${remaining != null ? ` · faltam ${remaining.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}` : ''}`;
  if (status === 'DUE_TODAY') return `Concluir hoje${remaining != null ? ` · faltam ${remaining.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}` : ''}`;
  if (status === 'REQUIRED' && required != null) {
    return `${required.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}/semana`;
  }
  return 'Ritmo indisponível';
}

function RequiredWeeklyProgressCard({ target }: { target?: RequiredWeeklyProgress }) {
  if (!target) return null;
  const measurableServices = target.services.filter(service => service.systems.some(system => system.plannedQty != null));
  return (
    <div className="acp-weekly-target" data-acp-weekly-progress-target>
      <div className="acp-weekly-target-head">
        <div>
          <strong>Ritmo necessário</strong>
          <span>para entregar na data prevista</span>
        </div>
        <strong>{weeklyTargetText(target.status, target.remainingPctPoints, target.requiredPctPointsPerWeek, ' p.p.')}</strong>
      </div>
      {measurableServices.length > 0 ? (
        <div className="acp-weekly-target-services">
          {measurableServices.map(service => (
            <div className="acp-weekly-target-service" key={service.serviceType}>
              <div className="acp-weekly-target-service-head">
                <strong>{SERVICE_LABELS[service.serviceType] ?? service.serviceType}</strong>
                <span>{fmtPct(service.executionPct)}</span>
              </div>
              {service.systems.filter(system => system.plannedQty != null).map(system => {
                const unit = system.unit ? ` ${UNIT_LABELS[system.unit] ?? system.unit}` : '';
                return (
                  <div className="acp-weekly-target-system" key={`${system.systemType}:${system.unit ?? ''}`}>
                    <div>
                      <span>{SYSTEM_LABELS[system.systemType] ?? system.systemType}</span>
                      <small>{fmtQuantity(system.realizedQty, system.unit)} / {fmtQuantity(system.plannedQty, system.unit)}</small>
                    </div>
                    <strong>{weeklyTargetText(system.status, system.remainingQty, system.requiredQtyPerWeek, unit)}</strong>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MetricBar({ label, value, caption, tone, help }: { label: string; value: number | null; caption: string; tone?: 'cost'; help: string }) {
  return (
    <div className="acp-det-metric">
      <div className="acp-det-metric-top">
        <HelpTip help={help}>{label}</HelpTip>
        <span className="acp-det-metric-val">{caption}</span>
      </div>
      <Bar value={value} tone={tone} />
    </div>
  );
}

function WorkedHoursMetric({ data }: {
  data: {
    normalWorkedHours: number;
    overtimeWorkedHours: number;
    totalWorkedHours: number;
    plannedTotalHours: number | null;
    normalPct: number | null;
    overtimePct: number | null;
    totalPct: number | null;
    roleCounts?: Array<{ roleName: string; collaboratorCount: number; usedHours: number; pctOfPlannedTotal: number | null }>;
  };
}) {
  const roleCounts = data.roleCounts ?? [];
  return (
    <div className="acp-det-metric">
      <div className="acp-det-metric-top">
        <HelpTip help="Soma das horas-homem dos relatórios de execução, separando horas normais e horas extras. Cada turno é multiplicado pela quantidade de colaboradores daquele turno; as horas previstas já incluem todos os colaboradores.">Horas trabalhadas</HelpTip>
        <span className="acp-det-metric-val">
          {fmtHours(data.totalWorkedHours)} / {fmtHours(data.plannedTotalHours)}
          {data.totalPct != null ? ` · ${data.totalPct}%` : ''}
        </span>
      </div>
      <HoursBar normalPct={data.normalPct} overtimePct={data.overtimePct} />
      <div className="acp-hours-split">
        <span>
          <i className="acp-hours-dot normal" />Normais {fmtHours(data.normalWorkedHours)}
          {data.normalPct != null ? ` · ${data.normalPct}%` : ''}
        </span>
        <span>
          <i className="acp-hours-dot overtime" />HE {fmtHours(data.overtimeWorkedHours)}
          {data.overtimePct != null ? ` · ${data.overtimePct}%` : ''}
        </span>
      </div>
      {roleCounts.length > 0 ? (
        <div className="acp-hours-roles" aria-label="Colaboradores por cargo previsto">
          {roleCounts.map(item => (
            <span key={item.roleName}>
              {item.roleName}: {item.collaboratorCount} colab. · {fmtHours(item.usedHours)}
              {item.pctOfPlannedTotal != null ? ` · ${fmtPct(item.pctOfPlannedTotal)}` : ''}
            </span>
          ))}
        </div>
      ) : null}
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
            {svc.weight !== null && svc.weight !== undefined ? (
              <span className="acp-det-scope-weight">peso {Number(svc.weight ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
            ) : null}
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
export function ProjectDetailDashboard({
  projectId,
  groupId,
  canManage = false,
  canManageManualCosts = false,
  canManageProjectNotes = false,
  progressHistoryNoveltyUser = null,
  onBack
}: {
  projectId?: string;
  groupId?: string;
  canManage?: boolean;
  canManageManualCosts?: boolean;
  canManageProjectNotes?: boolean;
  progressHistoryNoveltyUser?: Pick<AuthUser, 'id'> | null;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [scheduleProject, setScheduleProject] = useState<{ projectId: string; code: string } | null>(null);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [progressHistoryNoveltyActive, setProgressHistoryNoveltyActive] = useState(true);
  const [weeklyTargetNoveltyActive, setWeeklyTargetNoveltyActive] = useState(true);
  const [manualCostNoveltyActive, setManualCostNoveltyActive] = useState(true);
  const [qualityDeviationsNoveltyActive, setQualityDeviationsNoveltyActive] = useState(true);
  const [additionalProposalsNoveltyActive, setAdditionalProposalsNoveltyActive] = useState(true);
  const [standbyHistoryNoveltyActive, setStandbyHistoryNoveltyActive] = useState(true);
  const [standbyHistoryOpen, setStandbyHistoryOpen] = useState(false);
  const [hoursDetail, setHoursDetail] = useState<{
    collaborator: ProjectDetailCollaborator;
    source: 'POINT' | 'REPORT';
  } | null>(null);
  const [expandedQualityDeviationIds, setExpandedQualityDeviationIds] = useState<Set<string>>(() => new Set());
  const [manualCostFormOpen, setManualCostFormOpen] = useState(false);
  const [manualCostError, setManualCostError] = useState<string | null>(null);
  const [deletingManualCostId, setDeletingManualCostId] = useState<string | null>(null);
  const [projectNoteContent, setProjectNoteContent] = useState('');
  const [projectNoteError, setProjectNoteError] = useState<string | null>(null);
  const { control, register, handleSubmit, reset, formState: { errors } } = useForm<ManualCostFormValues>({
    defaultValues: manualCostFormDefaultValues,
    resolver: manualCostFormResolver
  });
  const scheduleRef = useRef<ScheduleEditorHandle>(null);
  const isGroup = Boolean(groupId);
  const detailKey = isGroup ? ['mission-group-detail', groupId] : ['project-detail', projectId];
  const { data, isLoading } = useQuery({
    queryKey: detailKey,
    queryFn: () => isGroup ? getMissionGroupDetail(groupId!) : getProjectDetail(projectId!),
    ...acompanhamentoRefreshQueryOptions
  });
  const projectNotesKey = ['project-management-notes', projectId] as const;
  const {
    data: projectNotes = [],
    isLoading: projectNotesLoading,
    isError: projectNotesLoadError
  } = useQuery<ProjectManagementNote[]>({
    queryKey: projectNotesKey,
    queryFn: () => listProjectManagementNotes(projectId!),
    enabled: !isGroup && Boolean(projectId)
  });
  const { data: scope } = useQuery({
    queryKey: ['planned-scope', projectId],
    queryFn: () => getPlannedScope(projectId!),
    enabled: !isGroup && Boolean(projectId)
  });
  const planningReferenceDate = data?.header.lastRdoDate?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const { data: planningContext, isLoading: planningContextLoading } = useQuery({
    queryKey: ['acompanhamento-planning-context', projectId, planningReferenceDate],
    queryFn: () => getProjectPlanningContext(projectId!, planningReferenceDate),
    enabled: !isGroup && Boolean(projectId && data)
  });
  const { data: qualityDeviations = [], isLoading: qualityDeviationsLoading } = useQuery<ProjectDeviation[]>({
    queryKey: ['qualidade', 'project-deviations', projectId],
    queryFn: () => listProjectQualityDeviations(projectId!),
    enabled: !isGroup && Boolean(projectId)
  });
  function toggleQualityDeviation(id: string) {
    setExpandedQualityDeviationIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const refreshCostViews = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: detailKey }),
      queryClient.invalidateQueries({ queryKey: ['project-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['project-cards'] }),
      queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] })
    ]);
  };
  const createManualCostMutation = useMutation({
    mutationFn: (payload: ManualProjectCostPayload) => {
      if (!projectId) throw new Error('Abra uma missão individual para adicionar custo manual.');
      return createManualProjectCost(projectId, payload);
    },
    onSuccess: async () => {
      setManualCostError(null);
      reset(manualCostFormDefaultValues);
      setManualCostFormOpen(false);
      await refreshCostViews();
    },
    onError: (error: unknown) => {
      setManualCostError(mutationErrorMessage(error, 'Não foi possível adicionar o custo manual.'));
    }
  });
  const deleteManualCostMutation = useMutation({
    mutationFn: (cost: ManualProjectCost) => deleteManualProjectCost(cost.projectId, cost.id),
    onMutate: (cost) => {
      setManualCostError(null);
      setDeletingManualCostId(cost.id);
    },
    onSuccess: async () => {
      await refreshCostViews();
    },
    onError: (error: unknown) => {
      setManualCostError(mutationErrorMessage(error, 'Não foi possível remover o custo manual.'));
    },
    onSettled: () => setDeletingManualCostId(null)
  });
  const createProjectNoteMutation = useMutation({
    mutationFn: (content: string) => {
      if (!projectId) throw new Error('Abra uma missão individual para adicionar a nota.');
      return createProjectManagementNote(projectId, content);
    },
    onSuccess: (note) => {
      queryClient.setQueryData<ProjectManagementNote[]>(projectNotesKey, current => [note, ...(current ?? [])]);
      setProjectNoteContent('');
      setProjectNoteError(null);
    },
    onError: (error: unknown) => {
      setProjectNoteError(mutationErrorMessage(error, 'Não foi possível adicionar a nota.'));
    }
  });
  const submitManualCost = handleSubmit(values => {
    if (!canManageManualCosts || isGroup || createManualCostMutation.isPending) return;
    setManualCostError(null);
    createManualCostMutation.mutate(manualCostFormValuesToPayload(values));
  });

  function submitProjectNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = projectNoteContent.trim();
    if (!canManageProjectNotes || isGroup || !content || createProjectNoteMutation.isPending) return;
    setProjectNoteError(null);
    createProjectNoteMutation.mutate(content);
  }

  function closeSchedule() {
    setScheduleProject(null);
    setScheduleDirty(false);
  }

  function openManualCostForm() {
    setManualCostError(null);
    setManualCostFormOpen(true);
  }

  function closeManualCostForm() {
    setManualCostError(null);
    reset(manualCostFormDefaultValues);
    setManualCostFormOpen(false);
  }

  if (isLoading || !data) {
    return (
      <div className="acp-det">
        <button type="button" className="mini-btn alt" onClick={onBack}>← Voltar</button>
        <div className="page-card placeholder-copy" style={{ marginTop: 12 }}>
          {isGroup ? 'Carregando agrupamento…' : 'Carregando projeto…'}
        </div>
      </div>
    );
  }

  const h = data.header;
  const equipamentos = data.equipamentos ?? [];
  const effectiveScope = data.plannedScope ?? scope;
  const workedHours = data.workedHours ?? {
    normalWorkedHours: 0,
    overtimeWorkedHours: 0,
    totalWorkedHours: 0,
    plannedTotalHours: null,
    normalPct: null,
    overtimePct: null,
    totalPct: null,
    roleCounts: []
  };
  const progressSuffix = data.avancoMethod === 'MANUAL'
    ? ' (manual)'
    : data.avancoMethod === 'GROUP_SCOPE' || data.avancoMethod === 'GROUP_WEIGHTED' || data.avancoMethod === 'GROUP_AVERAGE'
      ? ' (consolidado)'
      : '';
  const manualCosts = data.manualCosts ?? [];
  const canAddManualCost = canManageManualCosts && !isGroup && Boolean(projectId);
  const hasAdditionalProposalContribution = (data.budgetBreakdown?.additionals ?? []).some(item => (
    hasMoney(item.salePrice) || hasMoney(item.plannedTotalCost) || hasMoney(item.expectedProfit) || hasMoney(item.taxes)
  ));
  const headerBits = [
    isGroup ? `Grupo ${h.code}` : `Missão ${h.code}`,
    h.clientName,
    h.proposalCode ? `Proposta ${h.proposalCode}` : null,
    `Última atualização ${fmtDate(h.lastRdoDate)}`,
    h.segment
  ].filter(Boolean);

  return (
    <div className="acp-det">
      <div className="acp-det-bar">
        <button type="button" className="mini-btn alt" onClick={onBack}>← Voltar</button>
        {canManage && !isGroup ? (
          <button type="button" className="mini-btn" onClick={() => setScheduleProject({ projectId: projectId!, code: h.code })}>
            Editar cronograma
          </button>
        ) : null}
      </div>

      <div className="page-card acp-det-header">
        <h2>{headerBits.join('  ·  ')}</h2>
        {data.group ? (
          <div className="acp-det-group-members" aria-label="Missões unificadas">
            {data.group.members.map(member => (
              <span key={member.projectId}>
                <strong>{member.code}</strong>
                {member.name || member.clientName ? <em>{member.name || member.clientName}</em> : null}
                {canManage ? (
                  <button
                    type="button"
                    className="mini-btn alt acp-det-group-schedule"
                    onClick={() => setScheduleProject({ projectId: member.projectId, code: member.code })}
                  >
                    Cronograma
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
        {data.alerts.length > 0 ? (
          <div className="acp-alerts">
            {data.alerts.map((a, i) => <span key={i} className={`acp-alert ${a.level}`}>⚠ {a.label}</span>)}
          </div>
        ) : null}
      </div>

      {!isGroup ? (
        <div className="page-card acp-det-planning" data-acp-planning-context>
          <div>
            <span className="acp-det-sub">Planejamento do Efetivo</span>
            {planningContextLoading ? <p className="placeholder-copy">Carregando missão oficial…</p>
              : planningContext ? (
                <>
                  <strong>{planningContext.collaborators.length} colaborador(es) planejado(s)</strong>
                  <p>
                    Execução de {fmtDate(planningContext.dates.executionStartDate)} a {fmtDate(planningContext.dates.executionEndDate)}
                    {' · '}plano rev. {planningContext.planRevision}
                  </p>
                </>
              ) : <p className="placeholder-copy">Sem missão oficial vigente na data de referência.</p>}
          </div>
          {planningContext ? (
            <div className="acp-det-planning-team">
              {planningContext.collaborators.map(collaborator => (
                <span key={collaborator.id}>{collaborator.name}<small>{collaborator.jobRole.name}</small></span>
              ))}
              {planningContext.needsReplanning ? <em>Replanejamento necessário{planningContext.replanningReason ? `: ${planningContext.replanningReason}` : ''}</em> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="acp-det-cols">
        {/* Coluna 1 */}
        <div className="acp-det-col">
          <div className="page-card acp-det-block">
            <MetricBar
              label="Dias corridos"
              help="Dias de calendário desde o início da obra até a data de referência: hoje para projetos em andamento; último RDO para projetos arquivados."
              value={data.diasCorridos.pct}
              caption={`${data.diasCorridos.elapsed ?? '—'}/${data.diasCorridos.planned ?? '—'}${data.diasCorridos.pct != null ? ` · ${data.diasCorridos.pct}%` : ''}`}
            />
            <MetricBar
              label="Dias trabalhados"
              help="Dias com RDO registrado, sobre os dias trabalhados previstos no comercial."
              value={data.diasTrabalhados.pct}
              caption={`${data.diasTrabalhados.worked}/${data.diasTrabalhados.planned ?? '—'}${data.diasTrabalhados.pct != null ? ` · ${data.diasTrabalhados.pct}%` : ''}`}
            />
            <WorkedHoursMetric data={workedHours} />
          </div>

          <div className="page-card acp-det-block">
            {(() => {
              const mo = data.maoDeObra;
              const moCusto = mo?.custo ?? null;
              const totalRealizado = data.consumo.gasto + (moCusto ?? 0);
              const previsto = data.consumo.previsto;
              const previstoOriginal = data.consumo.previstoOriginal ?? null;
              const previstoAdicional = data.consumo.previstoAdicional ?? null;
              const totalPct = previsto && previsto > 0 ? Math.round((totalRealizado / previsto) * 100) : null;
              const omieCost = data.consumo.omie ?? Math.max(0, data.consumo.gasto - (data.consumo.estoque ?? 0));
              const paidOmieCost = data.consumo.pago ?? 0;
              const pendingOmieCost = data.consumo.previstoPagar ?? 0;
              const stockCost = data.consumo.estoque ?? 0;
              const manualCost = data.consumo.manual ?? 0;
              const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 } as const;
              const hasOffshore = moCusto != null && mo.custoBase != null && Math.round(moCusto) !== Math.round(mo.custoBase);
              return (
                <>
                  <MetricBar
                    label="Consumo de gastos"
                    help="Total realizado (compras do Omie sem salários, consumo de químicos/filtros do estoque, custos manuais e mão de obra do ponto) sobre o custo previsto no comercial."
                    value={totalPct}
                    tone="cost"
                    caption={`${brl(totalRealizado)} / ${brl(previsto)}${totalPct != null ? ` · ${totalPct}%` : ''}`}
                  />
                  <div className="acp-cost-status">
                    <div>
                      <span>Pago no Omie</span>
                      <strong>{brl(paidOmieCost)}</strong>
                    </div>
                    <div>
                      <span>Previsto a pagar</span>
                      <strong>{brl(pendingOmieCost)}</strong>
                    </div>
                  </div>
                  <ProposalContributionDetails
                    original={data.budgetBreakdown?.original}
                    additionals={data.budgetBreakdown?.additionals}
                  />
                  <div style={{ margin: '8px 0' }}>
                    {previstoAdicional != null && Math.abs(previstoAdicional) > 0.005 ? (
                      <>
                        <div style={rowStyle}><span className="placeholder-copy">Previsto original</span><span>{brl(previstoOriginal)}</span></div>
                        <div style={rowStyle}><span className="placeholder-copy">Previsto adicional</span><span>{brl(previstoAdicional)}</span></div>
                      </>
                    ) : null}
                    <div style={rowStyle}><span className="placeholder-copy">Compras (Omie)</span><span>{brl(omieCost)}</span></div>
                    {stockCost > 0 ? (
                      <div style={rowStyle}><span className="placeholder-copy">Estoque (químicos/filtros)</span><span>{brl(stockCost)}</span></div>
                    ) : null}
                    {manualCost > 0 ? (
                      <div style={rowStyle}><span className="placeholder-copy">Custos manuais</span><span>{brl(manualCost)}</span></div>
                    ) : null}
                    {moCusto != null ? (
                      <div style={rowStyle}>
                        <HelpTip help="Valor gasto com mão de obra deste projeto, calculado a partir do ponto (custo rateado por colaborador), incluindo o adicional offshore quando houver.">Mão de obra{hasOffshore ? ' c/ offshore' : ''}</HelpTip>
                        <span>{brl(moCusto)}</span>
                      </div>
                    ) : null}
                    {moCusto != null && hasOffshore ? (
                      <div style={rowStyle}><span className="placeholder-copy">Mão de obra sem offshore</span><span>{brl(mo.custoBase)}</span></div>
                    ) : null}
                    <div style={{ ...rowStyle, marginTop: 4, borderTop: '1px solid #eee', paddingTop: 4 }}><strong>Total realizado</strong><strong>{brl(totalRealizado)}</strong></div>
                  </div>
                  {(manualCosts.length > 0 || canAddManualCost || (canManageManualCosts && isGroup)) ? (
                    <div className="acp-manual-costs" data-acp-manual-costs>
                      <div className="acp-manual-costs-head">
                        <div className="acp-det-sub">Custos manuais</div>
                        {canAddManualCost ? (
                          <button
                            type="button"
                            className="mini-btn alt acp-manual-cost-toggle"
                            aria-controls="acp-manual-cost-form"
                            aria-expanded={manualCostFormOpen}
                            data-acp-manual-cost-add
                            onClick={manualCostFormOpen ? closeManualCostForm : openManualCostForm}
                          >
                            {manualCostFormOpen ? 'Cancelar' : 'Adicionar custo'}
                          </button>
                        ) : null}
                      </div>
                      {manualCosts.length > 0 ? (
                        <ul className="acp-manual-cost-list">
                          {manualCosts.map(cost => (
                            <li key={cost.id}>
                              <div>
                                <strong>{cost.description}</strong>
                                <span>
                                  {isGroup && cost.projectCode ? `Missão ${cost.projectCode} · ` : ''}
                                  {fmtDate(cost.costDate ?? cost.createdAt)}
                                  {cost.createdBy?.name ? ` · ${cost.createdBy.name}` : ''}
                                </span>
                                {cost.note ? <em>{cost.note}</em> : null}
                              </div>
                              <div className="acp-manual-cost-actions">
                                <strong>{brl(cost.amount)}</strong>
                                {canManageManualCosts ? (
                                  <button
                                    type="button"
                                    className="mini-btn danger"
                                    disabled={deleteManualCostMutation.isPending && deletingManualCostId === cost.id}
                                    onClick={() => deleteManualCostMutation.mutate(cost)}
                                  >
                                    {deleteManualCostMutation.isPending && deletingManualCostId === cost.id ? 'Removendo…' : 'Excluir'}
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="placeholder-copy">Nenhum custo manual lançado.</div>
                      )}
                      {manualCostError ? <div className="form-error">{manualCostError}</div> : null}

                      {canAddManualCost && manualCostFormOpen ? (
                        <form id="acp-manual-cost-form" className="acp-manual-cost-form" onSubmit={submitManualCost}>
                          <div className="field-group">
                            <label htmlFor="acp-manual-cost-description">Descrição</label>
                            <input
                              id="acp-manual-cost-description"
                              {...register('description')}
                              maxLength={120}
                              aria-invalid={Boolean(errors.description)}
                              required
                            />
                            {errors.description ? <small className="field-error">{errors.description.message}</small> : null}
                          </div>
                          <div className="field-group">
                            <label htmlFor="acp-manual-cost-amount">Valor</label>
                            <Controller
                              name="amount"
                              control={control}
                              render={({ field }) => (
                                <input
                                  id="acp-manual-cost-amount"
                                  name={field.name}
                                  ref={field.ref}
                                  value={field.value}
                                  type="text"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  aria-invalid={Boolean(errors.amount)}
                                  required
                                  onBlur={field.onBlur}
                                  onChange={event => field.onChange(formatBrlCurrencyInput(event.target.value))}
                                />
                              )}
                            />
                            {errors.amount ? <small className="field-error">{errors.amount.message}</small> : null}
                          </div>
                          <div className="field-group">
                            <label htmlFor="acp-manual-cost-date">Data</label>
                            <input
                              id="acp-manual-cost-date"
                              {...register('costDate')}
                              type="date"
                              aria-invalid={Boolean(errors.costDate)}
                            />
                            {errors.costDate ? <small className="field-error">{errors.costDate.message}</small> : null}
                          </div>
                          <div className="field-group field-group-wide">
                            <label htmlFor="acp-manual-cost-note">Observação</label>
                            <input
                              id="acp-manual-cost-note"
                              {...register('note')}
                              maxLength={500}
                              aria-invalid={Boolean(errors.note)}
                            />
                            {errors.note ? <small className="field-error">{errors.note.message}</small> : null}
                          </div>
                          <div className="admin-form-actions field-group-wide">
                            <button type="submit" className="mini-btn" disabled={createManualCostMutation.isPending}>
                              {createManualCostMutation.isPending ? 'Salvando…' : 'Adicionar custo'}
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="acp-det-sub"><HelpTip help="As 5 maiores categorias de despesa do projeto, somando Omie sem salários, consumo líquido de químicos/filtros do estoque e custos manuais.">Maiores gastos (Omie + estoque + manual)</HelpTip></div>
                  {data.maioresGastos.length === 0 ? (
                    <div className="placeholder-copy">Sem gastos registrados.</div>
                  ) : (
                    <ul className="acp-det-rank">
                      {data.maioresGastos.map((g, i) => (
                        <li key={i}><span className="acp-det-rank-cat">{g.categoria}</span><span className="acp-det-rank-val">{brl(g.total)}</span></li>
                      ))}
                    </ul>
                  )}
                </>
              );
            })()}
          </div>

          {data.presumedProfitTaxes ? (() => {
            const taxes = data.presumedProfitTaxes;
            const expectedRevenue = toNum(data.faturamento.previsto);
            const expectedOriginalRevenue = toNum(data.faturamento.previstoOriginal);
            const expectedAdditionalRevenue = toNum(data.faturamento.previstoAdicional);
            const invoicedRevenue = toNum(data.faturamento.realizado);
            const hasOmieInvoice = taxes.basisSource === 'OMIE_INVOICED';
            const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 } as const;
            return (
              <div className="page-card acp-det-block">
                <details className="acp-det-tax-details">
                  <summary className="acp-det-collabs-summary">
                    Impostos do projeto
                    <span className="acp-det-tax-summary-value">{brl(taxes.totalTax)}</span>
                  </summary>
                  <div className="acp-det-tax-body">
                    <div style={rowStyle}>
                      <HelpTip help={hasOmieInvoice ? 'Projeto com faturamento sincronizado no Omie. O cálculo de IRPJ/CSLL usa o valor real faturado, não a venda prevista.' : 'Projeto ainda sem faturamento sincronizado no Omie. O cálculo usa a venda prevista do comercial.'}>Base dos impostos</HelpTip>
                      <span>{brl(taxes.basisAmount)}</span>
                    </div>
                    <div style={rowStyle}><span className="placeholder-copy">Venda prevista</span><span>{brl(expectedRevenue)}</span></div>
                    {expectedAdditionalRevenue != null && Math.abs(expectedAdditionalRevenue) > 0.005 ? (
                      <>
                        <div style={rowStyle}><span className="placeholder-copy">Venda original</span><span>{brl(expectedOriginalRevenue)}</span></div>
                        <div style={rowStyle}><span className="placeholder-copy">Venda adicional</span><span>{brl(expectedAdditionalRevenue)}</span></div>
                      </>
                    ) : null}
                    {hasOmieInvoice ? (
                      <>
                        <div style={rowStyle}><span className="placeholder-copy">Faturado Omie ({data.faturamento.notas} NF)</span><span>{brl(invoicedRevenue)}</span></div>
                      </>
                    ) : null}
                    <div style={rowStyle}>
                      <HelpTip help={hasOmieInvoice ? 'ISS vem da alíquota/código da NFSe do Omie quando disponível. PIS, COFINS e o INSS de 5,5% para serviços 14.01/7.02 são calculados sobre o faturamento real.' : 'Previsão da planilha para ISS, PIS, COFINS e INSS de 5,5% para serviços 14.01/7.02 enquanto não houver NF sincronizada no Omie.'}>Impostos na NF</HelpTip>
                      <span>{brl(taxes.invoiceTaxTotal)}</span>
                    </div>
                    <div style={rowStyle}><span className="placeholder-copy">{hasOmieInvoice ? 'ISS Omie' : 'ISS previsto'}</span><span>{brl(taxes.iss)}</span></div>
                    <div style={rowStyle}><span className="placeholder-copy">PIS</span><span>{brl(taxes.pis)}</span></div>
                    <div style={rowStyle}><span className="placeholder-copy">COFINS</span><span>{brl(taxes.cofins)}</span></div>
                    {taxes.inss > 0 ? (
                      <div style={rowStyle}><span className="placeholder-copy">INSS NF (5,5%)</span><span>{brl(taxes.inss)}</span></div>
                    ) : null}
                    <div style={{ ...rowStyle, marginTop: 4, borderTop: '1px solid #eee', paddingTop: 4 }}>
                      <HelpTip help={hasOmieInvoice ? 'Cálculo gerencial feito sobre o faturamento real do Omie. O cliente paga o valor faturado; este valor é o imposto estimado a pagar pela empresa.' : 'Previsão gerencial feita sobre a venda prevista. O cliente paga a venda prevista; este valor é o imposto estimado a pagar pela empresa.'}>IRPJ/CSLL fora da NF</HelpTip>
                      <strong>{brl(taxes.outOfInvoiceTaxTotal)}</strong>
                    </div>
                    <div style={rowStyle}><span className="placeholder-copy">IRPJ básico</span><span>{brl(taxes.irpjBasic)}</span></div>
                    <div style={rowStyle}><span className="placeholder-copy">CSLL</span><span>{brl(taxes.csll)}</span></div>
                    <div style={rowStyle}><span className="placeholder-copy">Adic. IRPJ</span><span>{brl(taxes.additionalIrpjEstimated)}</span></div>
                    <div style={{ ...rowStyle, marginTop: 4, borderTop: '1px solid #eee', paddingTop: 4 }}>
                      <HelpTip help="Soma de ISS, PIS, COFINS, INSS quando aplicável, IRPJ, CSLL e adicional de IRPJ calculados para o projeto.">Total de impostos</HelpTip>
                      <strong>{brl(taxes.totalTax)}</strong>
                    </div>
                  </div>
                </details>
              </div>
            );
          })() : null}
        </div>

        {/* Coluna 2 */}
        <div className="acp-det-col">
          <div className="page-card acp-det-block">
            <div className="acp-det-avanco">
              <div className="acp-det-metric-top">
                <HelpTip help="Quanto do escopo vendido já foi executado: cruza o realizado dos RDOs (metros de tubulação, litros de óleo) com o previsto, ponderado pelo peso de cada serviço. Sem escopo cadastrado, usa o avanço manual informado no cronograma.">Avanço do escopo{progressSuffix}</HelpTip>
                <span className="acp-det-metric-val">{fmtPct(data.avancoPct)}</span>
              </div>
              <Bar value={data.avancoPct} />
            </div>
            <RequiredWeeklyProgressCard target={data.requiredWeeklyProgress} />
            <ProgressHistoryChart points={data.progressHistory} />

            <div className="acp-det-two">
              <div className="acp-det-standby-kpi">
                <span className="acp-det-kpi-label"><HelpTip help="Número de dias com parada (standby) registrada nos relatórios de execução.">Standby</HelpTip></span>
                <strong>{data.standby.count}</strong>
                <span className="acp-det-kpi-sub">dia(s)</span>
                {!isGroup ? (
                  <button
                    type="button"
                    className="mini-btn alt acp-standby-history-trigger"
                    aria-haspopup="dialog"
                    data-acp-standby-history-trigger
                    onClick={() => setStandbyHistoryOpen(true)}
                  >
                    Ver histórico
                  </button>
                ) : null}
              </div>
              <div><span className="acp-det-kpi-label"><HelpTip help="Soma das horas-homem de stand-by de todos os relatórios de execução do projeto, multiplicando o tempo pela equipe do turno.">Hora total parada</HelpTip></span><strong>{fmtHM(data.standby.minutes)}</strong></div>
            </div>

            <div className="acp-det-sub"><HelpTip help="Status dos dias mais recentes com relatório de execução: verde = trabalhado, amarelo = trabalhado com standby, vermelho = totalmente parado (standby cobrindo a jornada). Passe o mouse para ver as horas.">Últimos dias</HelpTip></div>
            <div className="acp-det-dots">
              {data.ultimosDias.length === 0 ? (
                <span className="placeholder-copy">Sem relatórios de execução.</span>
              ) : data.ultimosDias.map((d, i) => (
                <PortalTip
                  key={i}
                  triggerClassName="acp-det-dot-wrap"
                  ariaLabel={`${fmtDate(d.date)}: ${DAY_META[d.status].label}`}
                  content={(
                    <>
                      <div className="acp-det-tip-date">{fmtDate(d.date)}</div>
                      <div className="acp-det-tip-status">
                        <span className={`acp-det-tip-dot ${DAY_META[d.status].cls}`} />{DAY_META[d.status].label}
                      </div>
                      <div className="acp-det-tip-row"><span>Trabalhado</span><strong>{fmtHM(d.workedMinutes)}</strong></div>
                      <div className="acp-det-tip-row"><span>Standby</span><strong>{fmtHM(d.standbyMinutes)}</strong></div>
                    </>
                  )}
                >
                  <span className={`acp-det-dot ${DAY_META[d.status].cls}`} />
                </PortalTip>
              ))}
            </div>

            <div className="acp-det-two" style={{ marginTop: 10 }}>
              <div><span className="acp-det-kpi-label"><HelpTip help="Total de horas extras-homem identificadas nos relatórios de execução do projeto, multiplicando a HE pela equipe do turno.">Horas extras</HelpTip></span><strong>{fmtHM(data.overtimeMinutes)}</strong></div>
            </div>
          </div>
        </div>

        {/* Coluna 3 */}
        <div className="acp-det-col">
          <div className="page-card acp-det-block">
            <div className="acp-det-sub"><HelpTip help="Escopo vendido informado manualmente (aba Cronograma): serviços, sistemas e quantitativos, com o peso de cada serviço no avanço.">Escopo cadastrado</HelpTip></div>
            <PlannedScopeView scope={effectiveScope} />
            {!isGroup && projectId ? (
              <div className="acp-mission-reports-action">
                <ProjectReportsDialog
                  projectId={projectId}
                  missionLabel={`Missão ${h.code} · ${h.clientName}`}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {!isGroup ? (
        <div className="page-card acp-det-block quality-deviations" data-quality-project-deviations>
          <div className="quality-deviations-head">
            <div className="acp-det-sub">Desvios</div>
            <a className="equip-link" href="/qualidade?tab=registros">Abrir Qualidade</a>
          </div>
          {qualityDeviationsLoading ? (
            <div className="placeholder-copy">Carregando desvios...</div>
          ) : qualityDeviations.length === 0 ? (
            <div className="placeholder-copy">Nenhum desvio registrado.</div>
          ) : (
            <ul className="quality-deviation-list">
              {qualityDeviations.map(deviation => {
                const expanded = expandedQualityDeviationIds.has(deviation.id);
                const detailsId = `quality-deviation-${deviation.id}`;
                return (
                  <li key={deviation.id} className={expanded ? 'is-expanded' : ''}>
                    <div className="quality-deviation-row">
                      <div className="quality-deviation-main">
                        <strong>{deviation.number}</strong>
                        <span>{deviation.nature?.name || '—'}</span>
                        <small>{fmtDate(deviation.eventDate)}</small>
                      </div>
                      <div className="quality-deviation-meta">
                        <span className={qualityImpactBadgeClass(deviation.impact)}>
                          {QUALITY_IMPACT_LABELS[deviation.impact] || deviation.impact}
                        </span>
                        <span className="badge">{QUALITY_STATUS_LABELS[deviation.status] || deviation.status}</span>
                        <span className={deviation.recurrent ? 'badge badge-pen' : 'badge'}>
                          {deviation.occurrences12m}x 12m
                        </span>
                        <button
                          type="button"
                          className="mini-btn alt quality-deviation-toggle"
                          aria-expanded={expanded}
                          aria-controls={detailsId}
                          onClick={() => toggleQualityDeviation(deviation.id)}
                        >
                          {expanded ? 'Recolher' : 'Ver mais'}
                        </button>
                      </div>
                    </div>
                    {expanded ? (
                      <div id={detailsId} className="quality-deviation-details">
                        <dl className="quality-deviation-fields">
                          <div>
                            <dt>Disposição</dt>
                            <dd>{QUALITY_DISPOSITION_LABELS[deviation.disposition] || deviation.disposition}</dd>
                          </div>
                          <div>
                            <dt>Origem</dt>
                            <dd>{deviation.origin || '—'}</dd>
                          </div>
                          {deviation.linkedRnc ? (
                            <div>
                              <dt>RNC vinculada</dt>
                              <dd>{deviation.linkedRnc}</dd>
                            </div>
                          ) : null}
                          {deviation.actionDeadline ? (
                            <div>
                              <dt>Prazo da ação</dt>
                              <dd>{fmtDate(deviation.actionDeadline)}</dd>
                            </div>
                          ) : null}
                        </dl>
                        <div className="quality-deviation-text">
                          <span>Descrição</span>
                          <p>{deviation.description}</p>
                        </div>
                        {deviation.definedAction || deviation.actionOwner ? (
                          <div className="quality-deviation-text">
                            <span>Ação definida</span>
                            <p>
                              {deviation.definedAction || '—'}
                              {deviation.actionOwner ? ` · Responsável: ${deviation.actionOwner}` : ''}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {!isGroup ? (
        <section className="page-card acp-project-notes" data-acp-project-notes aria-labelledby="acp-project-notes-title">
          <div className="acp-project-notes-head">
            <h3 id="acp-project-notes-title">Notas da gestão</h3>
            <span>{projectNotes.length} {projectNotes.length === 1 ? 'nota' : 'notas'}</span>
          </div>

          {canManageProjectNotes ? (
            <form className="acp-project-note-form" onSubmit={submitProjectNote}>
              <div className="field-group acp-project-note-field">
                <label className="sr-only" htmlFor="acp-project-note-content">Nova nota</label>
                <textarea
                  id="acp-project-note-content"
                  value={projectNoteContent}
                  onChange={event => setProjectNoteContent(event.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder="Adicionar uma nota…"
                  disabled={createProjectNoteMutation.isPending}
                />
              </div>
              <button
                type="submit"
                className="mini-btn"
                disabled={!projectNoteContent.trim() || createProjectNoteMutation.isPending}
              >
                {createProjectNoteMutation.isPending ? 'Adicionando…' : 'Adicionar'}
              </button>
            </form>
          ) : null}

          {projectNoteError ? <div className="form-error" role="alert">{projectNoteError}</div> : null}
          {projectNotesLoadError ? (
            <div className="form-error" role="alert">Não foi possível carregar as notas.</div>
          ) : projectNotesLoading ? (
            <div className="placeholder-copy">Carregando notas…</div>
          ) : projectNotes.length === 0 ? (
            <div className="placeholder-copy">Nenhuma nota adicionada.</div>
          ) : (
            <ol className="acp-project-note-list">
              {projectNotes.map(note => (
                <li key={note.id}>
                  <div className="acp-project-note-meta">
                    <strong>{note.author.name}</strong>
                    <time dateTime={note.createdAt}>{fmtDateTime(note.createdAt)}</time>
                  </div>
                  <p>{note.content}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      <div className="page-card acp-det-block">
        <details className="acp-det-equips-details" open>
          <summary className="acp-det-collabs-summary">
            Equipamentos na obra ({equipamentos.length})
          </summary>
          {equipamentos.length === 0 ? (
            <div className="placeholder-copy" style={{ marginTop: 8 }}>Nenhum equipamento em obra.</div>
          ) : (
            <div className="acp-det-equips-grid" style={{ marginTop: 8 }}>
              {equipamentos.map((e, i) => (
                <div className="acp-det-equip-item" key={`${e.name}-${i}`}>
                  <span>{e.code ? `${e.code} — ${e.name}` : e.name}</span>
                  <strong>{e.days} dia{e.days === 1 ? '' : 's'}</strong>
                  <small>desde {fmtDate(e.since)}</small>
                </div>
              ))}
            </div>
          )}
        </details>
        <div className="acp-det-romaneios-action">
          <ProjectRomaneiosDialog
            key={groupId || projectId}
            projectId={projectId}
            groupId={groupId}
            missionLabel={`${isGroup ? 'Missões' : 'Missão'} ${h.code}`}
          />
        </div>
      </div>

      {/* Colaboradores em largura total: apropriação financeira em destaque e jornada dos RDOs para conferência. */}
      <div className="page-card acp-det-block">
        <details className="acp-det-collabs-details" open>
          <summary className="acp-det-collabs-summary">
            Colaboradores na obra ({data.colaboradores.length})
          </summary>
          {data.colaboradores.length === 0 ? (
            <div className="placeholder-copy" style={{ marginTop: 8 }}>Nenhum colaborador nos relatórios de execução.</div>
          ) : (
            <div className="acp-det-collab-body">
              <div className="acp-det-collab-context" role="note">
                <strong>Base da apropriação: ponto de {fmtDate(data.maoDeObra.periodStart)} a {fmtDate(data.maoDeObra.periodEnd)}</strong>
                <span>O deslocamento já está incluído nas horas e no custo total; aparece separado apenas para detalhamento.</span>
              </div>

              <div className="acp-table-wrap">
                <table className="acp-table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Cargo</th>
                      <th style={{ textAlign: 'right' }}>
                        <HelpTip help="Horas do ponto atribuídas ao projeto pelo mesmo rateio que calculou o custo. Quando não houver apropriação do Ponto Mais, a jornada dos relatórios aparece em azul como referência e não entra no custo. Em um grupo, soma a apropriação das missões.">Horas apropriadas</HelpTip>
                      </th>
                      <th style={{ textAlign: 'right' }}>
                        <HelpTip help="Parcela do custo total do colaborador atribuída ao projeto no período do ponto.">Custo apropriado</HelpTip>
                      </th>
                      <th style={{ textAlign: 'right' }}>
                        <HelpTip help="Custo apropriado dividido pelas horas apropriadas. Por isso este valor pode variar entre colaboradores com salários-base próximos.">Custo efetivo/h</HelpTip>
                      </th>
                      <th style={{ textAlign: 'right' }}>
                        <HelpTip help="Horas apropriadas em dias marcados como viagem. O valor abaixo é a parcela proporcional do custo apropriado e não representa um custo adicional.">Deslocamento</HelpTip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.colaboradores.map((c, i) => (
                      <tr key={i}>
                        <td>{c.name}</td>
                        <td data-label="Cargo">{c.role}</td>
                        <td data-label="Horas apropriadas" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {c.horasApropriadas != null && c.horasApropriadas > 0 ? (
                            <button
                              type="button"
                              className="acp-collaborator-hours-trigger"
                              onClick={() => setHoursDetail({ collaborator: c, source: 'POINT' })}
                              title={`Conferir os dias apropriados de ${c.name}`}
                            >
                              {fmtHours(c.horasApropriadas)}
                            </button>
                          ) : c.horas > 0 ? (
                            <button
                              type="button"
                              className="acp-report-hours-fallback-trigger"
                              onClick={() => setHoursDetail({ collaborator: c, source: 'REPORT' })}
                              title={`Conferir os RDOs de origem da jornada de ${c.name}; estas horas não entram no custo apropriado`}
                              aria-label={`Conferir ${fmtHours(c.horas)} dos relatórios de ${c.name}`}
                            >
                              <span className="acp-report-hours-fallback-value">
                                {fmtHours(c.horas)}
                                <small>RDO</small>
                              </span>
                            </button>
                          ) : fmtHours(c.horasApropriadas)}
                        </td>
                        <td data-label="Custo apropriado" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{brl(c.custo)}</td>
                        <td data-label="Custo efetivo/h" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {c.custoHora != null ? `${brl(c.custoHora)}/h` : '—'}
                        </td>
                        <td data-label="Deslocamento" style={{ textAlign: 'right' }}>
                          {c.horasDeslocamento > 0 ? (
                            <span className="acp-det-collab-travel">
                              <strong>{fmtHours(c.horasDeslocamento)}</strong>
                              {c.custoDeslocamento != null ? <small>{brl(c.custoDeslocamento)} do custo</small> : null}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details className="acp-det-collab-audit">
                <summary className="acp-det-collabs-summary">Conferir jornada dos relatórios</summary>
                <p className="acp-det-collab-audit-copy">
                  {isGroup
                    ? 'Esta jornada vem dos RDOs e não é usada para calcular o custo. O total sem sobreposição considera, em cada data, a maior jornada lançada entre as missões mescladas.'
                    : 'Esta jornada vem dos RDOs e não é usada para calcular o custo.'}
                </p>
                <div className="acp-table-wrap">
                  <table className="acp-table acp-det-collab-audit-table">
                    <thead>
                      <tr>
                        <th>Nome</th>
                        <th style={{ textAlign: 'right' }}>{isGroup ? 'Jornada sem sobreposição' : 'Jornada dos relatórios'}</th>
                        {isGroup ? <th style={{ textAlign: 'right' }}>Soma por missão</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {data.colaboradores.map((c, i) => (
                        <tr key={i}>
                          <td>{c.name}</td>
                          <td data-label={isGroup ? 'Sem sobreposição' : 'Jornada dos relatórios'} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtHours(c.horas)}</td>
                          {isGroup ? (
                            <td data-label="Soma por missão" style={{ textAlign: 'right' }}>
                              <span className={c.sobreposicaoHoras > 0 ? 'acp-det-collab-overlap' : undefined}>{fmtHours(c.horasLancadas)}</span>
                              {c.sobreposicaoHoras > 0 ? (
                                <small className="acp-det-collab-overlap-note">{fmtHours(c.sobreposicaoHoras)} em sobreposição</small>
                              ) : null}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}
        </details>
      </div>

      <div className="page-card acp-det-footer">
        <div><span><HelpTip help="Data de mobilização, cadastrada manualmente no cronograma.">Mobilização</HelpTip></span><strong>{fmtDate(data.footer.mobilizationDate)}</strong></div>
        <div><span><HelpTip help="Data de início real, cadastrada manualmente no cronograma.">Início</HelpTip></span><strong>{fmtDate(data.footer.startDate)}</strong></div>
        <div><span><HelpTip help="Início + dias corridos previstos no comercial.">Previsão de término</HelpTip></span><strong>{fmtDate(data.footer.expectedEndDate)}</strong></div>
        <div><span><HelpTip help="Estimativa realista: projeta o término pela velocidade de avanço acumulada até a data de referência dos dias corridos.">Previsão pelo ritmo</HelpTip></span><strong>{fmtDate(data.footer.projectedEndByPace)}</strong></div>
      </div>

      <ProjectStandbyHistoryDialog
        project={standbyHistoryOpen && !isGroup && projectId
          ? { projectId, code: h.code }
          : null}
        onClose={() => setStandbyHistoryOpen(false)}
      />

      <ProjectCollaboratorHoursDialog
        collaborator={hoursDetail?.collaborator ?? null}
        source={hoursDetail?.source}
        isGroup={isGroup}
        onClose={() => setHoursDetail(null)}
      />

      <Modal open={scheduleProject !== null} onClose={closeSchedule} ariaLabelledBy="acp-detail-schedule-title" panelClassName="modal-card acp-manage-card">
        <div className="acp-manage">
          <div className="acp-manage-head">
            <div className="sec" id="acp-detail-schedule-title">Cronograma — Missão {scheduleProject?.code ?? h.code}</div>
            <button className="mini-btn alt" type="button" onClick={closeSchedule} aria-label="Fechar">✕</button>
          </div>
          <div className="acp-manage-body">
            {scheduleProject ? (
              <ProjectScheduleEditor
                key={scheduleProject.projectId}
                ref={scheduleRef}
                projectId={scheduleProject.projectId}
                canManage={canManage}
                onDirtyChange={setScheduleDirty}
              />
            ) : null}
          </div>
          <div className="acp-manage-foot">
            <button type="button" className="mini-btn alt" onClick={closeSchedule}>Cancelar</button>
            <button type="button" className="mini-btn" disabled={!scheduleDirty} onClick={() => scheduleRef.current?.save()}>Salvar</button>
          </div>
        </div>
      </Modal>
      <ProjectProgressHistoryNovelty
        user={progressHistoryNoveltyUser}
        enabled={progressHistoryNoveltyActive}
        onSeen={() => setProgressHistoryNoveltyActive(false)}
      />
      <ProjectWeeklyTargetNovelty
        user={progressHistoryNoveltyUser}
        enabled={weeklyTargetNoveltyActive && !isGroup && Boolean(data.requiredWeeklyProgress)}
        onSeen={() => setWeeklyTargetNoveltyActive(false)}
      />
      <ProjectManualCostNovelty
        user={progressHistoryNoveltyUser}
        enabled={manualCostNoveltyActive && canAddManualCost}
        onSeen={() => setManualCostNoveltyActive(false)}
      />
      <ProjectQualityDeviationsNovelty
        user={progressHistoryNoveltyUser}
        enabled={qualityDeviationsNoveltyActive && !isGroup}
        onSeen={() => setQualityDeviationsNoveltyActive(false)}
      />
      <ProjectAdditionalProposalsNovelty
        user={progressHistoryNoveltyUser}
        enabled={additionalProposalsNoveltyActive && hasAdditionalProposalContribution}
        onSeen={() => setAdditionalProposalsNoveltyActive(false)}
      />
      <ProjectStandbyHistoryNovelty
        user={progressHistoryNoveltyUser}
        enabled={standbyHistoryNoveltyActive && !isGroup && Boolean(projectId)}
        onSeen={() => setStandbyHistoryNoveltyActive(false)}
      />
    </div>
  );
}
