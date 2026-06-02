import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';

import {
  allocationReportPdfFileName,
  downloadAllocationReportPdf,
  downloadProjectStatsCsv,
  statsExportFileName,
  type AllocationReportCollaborator,
  type AllocationReportDay,
  type StatsExportSection,
  type StatsOverviewProject,
  type StatsParams,
  type StatsProjectData,
  type StatsServiceStats,
  type StatsSummary,
  type StatsTimelineSlot
} from '../../api/statistics';
import {
  useAllocationReport,
  useAllocationReportRecipientMutations,
  useAllocationReportRecipients,
  useProjectStats,
  useProjectSegments,
  useStatsOverview
} from '../../hooks/useProjectStats';
import { useProjects } from '../../hooks/useProjects';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import { downloadBlob } from '../../utils/download';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const headerLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_HEADER.png`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMin(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

function fmtNum(n: number, decimals = 1): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function today(): string {
  return dateInputValue(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return dateInputValue(d);
}

function startOfWeek(): string {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return dateInputValue(d);
}

function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function currentMonthNumber(): string {
  return String(new Date().getMonth() + 1).padStart(2, '0');
}

function currentYearValue(): string {
  return String(new Date().getFullYear());
}

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function dateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

type PeriodPreset = 'today' | 'week' | 'month' | 'year' | 'custom';

function presetParams(preset: PeriodPreset): Pick<StatsParams, 'from' | 'to' | 'granularity'> {
  const t = today();
  if (preset === 'today') return { from: t, to: t, granularity: 'day' };
  if (preset === 'week') return { from: startOfWeek(), to: addDays(startOfWeek(), 6), granularity: 'day' };
  if (preset === 'month') return { from: startOfMonth(), to: t, granularity: 'week' };
  return { from: startOfYear(), to: t, granularity: 'month' };
}

// ─── KPI Cards ────────────────────────────────────────────────────────────────

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-kpi-card">
      <div className="stats-kpi-value">{value}</div>
      <div className="stats-kpi-label">{label}</div>
    </div>
  );
}

function KpiCards({ summary }: { summary: StatsSummary }) {
  return (
    <div className="stats-kpi-layout">
      {/* Linha geral */}
      <div className="stats-kpi-row">
        <KpiCard label="Dias executados" value={String(summary.totalDays)} />
        <KpiCard label="Standby (dias)" value={String(summary.standbyCount)} />
        {summary.standbyMinutes > 0 && (
          <KpiCard label="Standby (horas)" value={fmtMin(summary.standbyMinutes)} />
        )}
      </div>

      {/* Turno diurno */}
      <div className="stats-kpi-group">
        <div className="stats-kpi-group-label">Diurno</div>
        <div className="stats-kpi-row">
          <KpiCard label="Horas trabalhadas" value={fmtMin(summary.daytimeWorkedMinutes)} />
          <KpiCard label="Horas extras" value={fmtMin(summary.daytimeOvertimeMinutes)} />
          <KpiCard label="Colaboradores (média)" value={fmtNum(summary.avgDaytimeCollaborators)} />
        </div>
      </div>

      {/* Turno noturno */}
      <div className="stats-kpi-group">
        <div className="stats-kpi-group-label">Noturno</div>
        <div className="stats-kpi-row">
          <KpiCard label="Horas trabalhadas" value={fmtMin(summary.nighttimeWorkedMinutes)} />
          <KpiCard label="Horas extras" value={fmtMin(summary.nighttimeOvertimeMinutes)} />
          <KpiCard label="Colaboradores (média)" value={fmtNum(summary.avgNighttimeCollaborators)} />
        </div>
      </div>
    </div>
  );
}

// ─── Timeline SVG ─────────────────────────────────────────────────────────────

function TimelineChart({ slots, mode }: { slots: StatsTimelineSlot[]; mode: 'hours' | 'services' }) {
  if (slots.length === 0) return <div className="stats-empty">Nenhum dado no período.</div>;

  const W = 720;
  const H = 180;
  const PAD_L = 48;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 32;
  const barW = Math.max(8, Math.min(40, (W - PAD_L - PAD_R) / slots.length - 3));
  const step = (W - PAD_L - PAD_R) / slots.length;

  const maxVal = mode === 'hours'
    ? Math.max(...slots.map(s => s.daytimeWorkedMinutes + s.nighttimeWorkedMinutes + s.daytimeOvertimeMinutes + s.nighttimeOvertimeMinutes), 1)
    : Math.max(...slots.map(s => Object.values(s.serviceBreakdown).reduce((a, b) => a + b, 0)), 1);

  const chartH = H - PAD_T - PAD_B;

  function barX(i: number) {
    return PAD_L + i * step + step / 2 - barW / 2;
  }

  const segments = mode === 'hours'
    ? [
        { key: 'nighttimeOvertimeMinutes' as const, color: '#c81519', label: 'HE Noturna' },
        { key: 'daytimeOvertimeMinutes' as const, color: '#f97316', label: 'HE Diurna' },
        { key: 'nighttimeWorkedMinutes' as const, color: '#6366f1', label: 'Noturno' },
        { key: 'daytimeWorkedMinutes' as const, color: '#3b82f6', label: 'Diurno' },
      ]
    : [];

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: `${Math.max(W, slots.length * 30)}px`, height: 'auto' }}>
        {/* Y gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = PAD_T + chartH * (1 - pct);
          const val = mode === 'hours' ? Math.round(maxVal * pct / 60) : Math.round(maxVal * pct);
          return (
            <g key={pct}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#d1d5db" strokeWidth="0.5" />
              <text x={PAD_L - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#6b7280">
                {mode === 'hours' ? `${val}h` : val}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {slots.map((slot, i) => {
          const x = barX(i);
          if (mode === 'hours') {
            let yOffset = 0;
            return (
              <g key={slot.period}>
                {segments.map(seg => {
                  const val = slot[seg.key as keyof StatsTimelineSlot] as number || 0;
                  const h = (val / maxVal) * chartH;
                  const rect = (
                    <rect key={seg.key} x={x} y={PAD_T + chartH - yOffset - h} width={barW} height={h}
                      fill={seg.color} rx="2" />
                  );
                  yOffset += h;
                  return rect;
                })}
                <title>{`${slot.label}: ${fmtMin(slot.daytimeWorkedMinutes + slot.nighttimeWorkedMinutes)}`}</title>
              </g>
            );
          } else {
            const total = Object.values(slot.serviceBreakdown).reduce((a, b) => a + b, 0);
            const h = (total / maxVal) * chartH;
            return (
              <g key={slot.period}>
                <rect x={x} y={PAD_T + chartH - h} width={barW} height={h} fill="#30503a" rx="2" />
                <title>{`${slot.label}: ${total} serviços`}</title>
              </g>
            );
          }
        })}

        {/* X labels */}
        {slots.map((slot, i) => (
          <text key={slot.period} x={barX(i) + barW / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#6b7280"
            transform={slots.length > 12 ? `rotate(-45, ${barX(i) + barW / 2}, ${H - 4})` : undefined}>
            {slot.label}
          </text>
        ))}
      </svg>

      {mode === 'hours' && (
        <div className="stats-chart-legend">
          {segments.map(s => (
            <span key={s.key} className="stats-chart-legend-item">
              <span style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Services Section ─────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  filtragem: 'Filtragem',
  flushing: 'Flushing',
  limpeza: 'Limpeza Química',
  mecanica: 'Limpeza mecânica',
  pressao: 'Teste de Pressão',
};

interface AggregatedItem {
  key: string;
  system: string | null;
  equipmentName: string | null;
  count: number;
  volumeOleoLiters: number;
  tubesByDiameter: Record<string, number>;
}

function aggregateItemsByEquipment(byProject: StatsProjectData[]): Record<string, AggregatedItem[]> {
  const result: Record<string, Map<string, AggregatedItem>> = {};

  for (const proj of byProject) {
    for (const rdo of proj.dailyReports) {
      for (const [type, svc] of Object.entries(rdo.services)) {
        if (!result[type]) result[type] = new Map();
        const map = result[type];
        for (const item of (svc.items || [])) {
          const key = `${item.equipmentName || ''}||${item.system || ''}`;
          if (!map.has(key)) {
            map.set(key, { key, system: item.system, equipmentName: item.equipmentName, count: 0, volumeOleoLiters: 0, tubesByDiameter: {} });
          }
          const agg = map.get(key)!;
          agg.count += 1;
          agg.volumeOleoLiters += item.volumeOleoLiters ?? 0;
          for (const [d, m] of Object.entries(item.tubesByDiameter || {})) {
            agg.tubesByDiameter[d] = (agg.tubesByDiameter[d] || 0) + m;
          }
        }
      }
    }
  }

  return Object.fromEntries(
    Object.entries(result).map(([type, map]) => [
      type,
      Array.from(map.values()).sort((a, b) => b.count - a.count)
    ])
  );
}

function ServiceItemLabel({ item }: { item: AggregatedItem }) {
  const parts = [item.equipmentName, item.system].filter(Boolean);
  return <span className="stats-svc-item-label">{parts.length ? parts.join(' - ') : '—'}</span>;
}

function totalTubeLength(tubesByDiameter: Record<string, number>): number {
  return Object.values(tubesByDiameter || {}).reduce((sum, meters) => sum + meters, 0);
}

function ServicesSection({ services, byProject }: { services: Record<string, StatsServiceStats>; byProject: StatsProjectData[] }) {
  const entries = Object.entries(services).sort((a, b) => b[1].serviceCount - a[1].serviceCount);
  if (entries.length === 0) return <div className="stats-empty">Nenhum serviço no período.</div>;

  const itemsByType = aggregateItemsByEquipment(byProject);

  return (
    <div className="stats-services-list">
      {entries.map(([type, stats]) => {
        const items = itemsByType[type] || [];
        const tubeTotal = totalTubeLength(stats.tubesByDiameter);
        return (
          <div key={type} className="stats-service-card">
            <div className="stats-service-header">
              <span className="stats-service-type">{SERVICE_LABELS[type] || type}</span>
              <span className="stats-service-count">{stats.serviceCount} serviço{stats.serviceCount !== 1 ? 's' : ''}</span>
            </div>
            <div className="stats-service-details">
              {stats.volumeOleoLiters > 0 && (
                <span>Volume total: <strong>{fmtNum(stats.volumeOleoLiters, 0)} L</strong></span>
              )}
              {tubeTotal > 0 && (
                <span>Comprimento total: <strong>{fmtNum(tubeTotal, 1)} m</strong></span>
              )}
              {Object.entries(stats.tubesByDiameter).map(([d, m]) => (
                <span key={d}>
                  <strong>{d}</strong> → <strong>{fmtNum(m, 1)} m</strong>
                </span>
              ))}
              {stats.hasTubulacao > 0 && (
                <span>Em tubulação: <strong>{stats.hasTubulacao}×</strong></span>
              )}
            </div>
            {items.length > 0 && (
              <table className="stats-svc-items-table">
                <thead>
                  <tr>
                    <th>Equipamento / Sistema</th>
                    <th>Qtd.</th>
                    {type === 'filtragem' ? <th>Volume (L)</th> : <th>Diâm. → Metros</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const tubes = Object.entries(item.tubesByDiameter);
                    const itemTubeTotal = totalTubeLength(item.tubesByDiameter);
                    return (
                      <tr key={item.key}>
                        <td><ServiceItemLabel item={item} /></td>
                        <td>{item.count}</td>
                        <td>
                          {type === 'filtragem'
                            ? (item.volumeOleoLiters > 0 ? `${fmtNum(item.volumeOleoLiters, 0)} L` : '—')
                            : tubes.length > 0
                              ? (
                                  <>
                                    <span className="stats-tube-entry"><strong>Total</strong> → {fmtNum(itemTubeTotal, 1)} m</span>
                                    {tubes.map(([d, m]) => (
                                      <span key={d} className="stats-tube-entry"><strong>{d}</strong> → {fmtNum(m, 1)} m</span>
                                    ))}
                                  </>
                                )
                              : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── By Project Section ───────────────────────────────────────────────────────

const DAILY_COLS = 10;

function RdoServiceRows({ services }: { services: Record<string, StatsServiceStats> }) {
  const entries = Object.entries(services);
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map(([type, svc]) => {
        const items = svc.items || [];
        if (items.length === 0) {
          return (
            <tr key={type} className="stats-svc-subrow">
              <td colSpan={DAILY_COLS} className="stats-svc-subrow-cell">
                <span className="stats-svc-subrow-type">{SERVICE_LABELS[type] || type}</span>
                <span className="stats-svc-subrow-detail">—</span>
              </td>
            </tr>
          );
        }
        return items.map((item, idx) => {
          const label = [item.equipmentName, item.system].filter(Boolean).join(' - ') || '—';
          const tubes = Object.entries(item.tubesByDiameter || {});
          const tubeTotal = totalTubeLength(item.tubesByDiameter || {});
          const hasVolume = type === 'filtragem' && item.volumeOleoLiters != null && item.volumeOleoLiters > 0;
          return (
            <tr key={`${type}-${idx}`} className="stats-svc-subrow">
              <td colSpan={DAILY_COLS} className="stats-svc-subrow-cell">
                {idx === 0 && <span className="stats-svc-subrow-type">{SERVICE_LABELS[type] || type}</span>}
                {idx > 0 && <span className="stats-svc-subrow-type stats-svc-subrow-type--cont" />}
                <span className="stats-svc-subrow-label">{label}</span>
                {hasVolume && (
                  <span className="stats-svc-subrow-qty">{fmtNum(item.volumeOleoLiters!, 0)} L</span>
                )}
                {tubes.length > 0 && (
                  <span className="stats-svc-subrow-qty">
                    <span className="stats-tube-entry"><strong>Total</strong> → {fmtNum(tubeTotal, 1)} m</span>
                    {tubes.map(([d, m]) => (
                      <span key={d} className="stats-tube-entry"><strong>{d}</strong> → {fmtNum(m, 1)} m</span>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          );
        });
      })}
    </>
  );
}

function ProjectDailyDetail({
  project,
  expanded,
  dailyReportsIncluded,
  detailParams
}: {
  project: StatsProjectData;
  expanded: boolean;
  dailyReportsIncluded: boolean;
  detailParams: StatsParams;
}) {
  const detailQuery = useProjectStats(
    {
      ...detailParams,
      projectId: project.projectId,
      includeDailyReports: true
    },
    expanded && !dailyReportsIncluded
  );

  if (!expanded) return null;

  const detailProject = dailyReportsIncluded
    ? project
    : detailQuery.data?.byProject.find(item => item.projectId === project.projectId);

  if (!dailyReportsIncluded) {
    if (detailQuery.isLoading) {
      return (
        <div className="stats-byproject-detail">
          <div className="stats-empty">Carregando RDOs detalhados...</div>
        </div>
      );
    }
    if (detailQuery.isError) {
      return (
        <div className="stats-byproject-detail">
          <div className="stats-empty">Não foi possível carregar os RDOs detalhados deste projeto.</div>
        </div>
      );
    }
    if (detailQuery.data && !detailQuery.data.meta.dailyReportsIncluded) {
      return (
        <div className="stats-byproject-detail">
          <div className="stats-empty">Detalhe diário omitido pelo volume da consulta. Reduza o período deste projeto.</div>
        </div>
      );
    }
  }

  if (!detailProject) return null;

  return (
    <div className="stats-byproject-detail">
      <table className="stats-daily-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>RDO</th>
            <th>Status</th>
            <th>H. Diur.</th>
            <th>HE Diur.</th>
            <th>H. Not.</th>
            <th>HE Not.</th>
            <th>Col. D</th>
            <th>Col. N</th>
            <th>Standby</th>
          </tr>
        </thead>
        <tbody>
          {detailProject.dailyReports.map(rdo => {
            const dateStr = formatDateOnlyPtBr(rdo.reportDate);
            const hasSvcs = Object.keys(rdo.services).length > 0;
            return (
              <Fragment key={rdo.reportId}>
                <tr key={rdo.reportId} className={hasSvcs ? 'stats-daily-row--has-svcs' : ''}>
                  <td>{dateStr}</td>
                  <td>{rdo.sequenceNumber ?? '-'}</td>
                  <td>{rdo.status === 'SIGNED' ? 'Assinado' : 'Aprovado'}</td>
                  <td>{fmtMin(rdo.daytimeWorkedMinutes)}</td>
                  <td>{fmtMin(rdo.daytimeOvertimeMinutes)}</td>
                  <td>{fmtMin(rdo.nighttimeWorkedMinutes)}</td>
                  <td>{fmtMin(rdo.nighttimeOvertimeMinutes)}</td>
                  <td>{rdo.daytimeCollaborators}</td>
                  <td>{rdo.nighttimeCollaborators}</td>
                  <td>{rdo.standby ? fmtMin(rdo.standbyMinutes) : '—'}</td>
                </tr>
                {hasSvcs && <RdoServiceRows key={`${rdo.reportId}-svcs`} services={rdo.services} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProjectRow({
  project,
  expanded,
  onToggle,
  dailyReportsIncluded,
  detailParams
}: {
  project: StatsProjectData;
  expanded: boolean;
  onToggle: () => void;
  dailyReportsIncluded: boolean;
  detailParams: StatsParams;
}) {
  return (
    <div className="stats-byproject-row">
      <button className="stats-byproject-toggle" type="button" onClick={onToggle}>
        <span className="stats-byproject-code">{project.code}</span>
        <span className="stats-byproject-name">{project.name}</span>
        <span className="stats-byproject-meta">
          {project.summary.reportCount} RDO{project.summary.reportCount !== 1 ? 's' : ''} · {fmtMin(project.summary.daytimeWorkedMinutes + project.summary.nighttimeWorkedMinutes)} diurnos/noturnos
        </span>
        <span className="stats-byproject-chevron">{expanded ? '▲' : '▼'}</span>
      </button>
      <ProjectDailyDetail
        project={project}
        expanded={expanded}
        dailyReportsIncluded={dailyReportsIncluded}
        detailParams={detailParams}
      />
    </div>
  );
}

function ByProjectSection({
  byProject,
  dailyReportsIncluded,
  detailParams
}: {
  byProject: StatsProjectData[];
  dailyReportsIncluded: boolean;
  detailParams: StatsParams;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const s = new Set(prev);
    if (s.has(id)) {
      s.delete(id);
    } else {
      s.add(id);
    }
    return s;
  });

  if (!byProject || byProject.length === 0) return null;

  return (
    <div className="stats-byproject-list">
      {byProject.map(project => (
        <ProjectRow
          key={project.projectId}
          project={project}
          expanded={expanded.has(project.projectId)}
          onToggle={() => toggle(project.projectId)}
          dailyReportsIncluded={dailyReportsIncluded}
          detailParams={detailParams}
        />
      ))}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function StatsDashboard() {
  const [preset, setPreset] = useState<PeriodPreset>('year');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customGranularity, setCustomGranularity] = useState<StatsParams['granularity']>('month');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [projectStatus, setProjectStatus] = useState<'all' | 'active' | 'archived'>('all');
  const [segment, setSegment] = useState('');
  const [timelineMode, setTimelineMode] = useState<'hours' | 'services'>('hours');
  const [exportingSection, setExportingSection] = useState<StatsExportSection | null>(null);
  const [exportError, setExportError] = useState('');

  const projectsQuery = useProjects();
  const segmentsQuery = useProjectSegments();

  const allProjects = useMemo(() => (projectsQuery.data || [])
    .filter(project => !project.managerOnly)
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true })), [projectsQuery.data]);
  const visibleProjectIds = useMemo(() => new Set(allProjects.map(project => project.id)), [allProjects]);
  const selectedVisibleProjects = useMemo(
    () => selectedProjects.filter(id => visibleProjectIds.has(id)),
    [selectedProjects, visibleProjectIds]
  );

  const periodPart = preset === 'custom'
    ? { from: customFrom || startOfYear(), to: customTo || today(), granularity: customGranularity }
    : presetParams(preset);

  const statsParams: StatsParams = {
    ...periodPart,
    projectStatus,
    ...(segment ? { segment } : {}),
    ...(selectedVisibleProjects.length > 0 ? { projectId: selectedVisibleProjects, includeDailyReports: true } : {})
  };

  const statsQuery = useProjectStats(statsParams);

  const data = statsQuery.data;
  const singleProject = selectedVisibleProjects.length === 1;

  useEffect(() => {
    if (!projectsQuery.data || selectedProjects.length === selectedVisibleProjects.length) return;
    setSelectedProjects(selectedVisibleProjects);
  }, [projectsQuery.data, selectedProjects, selectedVisibleProjects]);

  function toggleProject(id: string) {
    setSelectedProjects(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function handleExport(section: StatsExportSection) {
    setExportError('');
    setExportingSection(section);
    try {
      const params = { ...statsParams, section };
      const blob = await downloadProjectStatsCsv(params);
      downloadBlob(blob, statsExportFileName(params));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Não foi possível exportar o CSV.');
    } finally {
      setExportingSection(null);
    }
  }

  function ExportButton({ section, children }: { section: StatsExportSection; children: string }) {
    return (
      <button
        type="button"
        className="mini-btn alt"
        disabled={exportingSection !== null}
        onClick={() => void handleExport(section)}
      >
        {exportingSection === section ? 'Exportando...' : children}
      </button>
    );
  }

  return (
    <div className="survey-dashboard stats-dashboard">

      {/* ── Filters ── */}
      <div className="survey-dash-card stats-filters">
        <div className="stats-filters-row">
          {/* Period presets */}
          <div className="stats-filter-group">
            <label className="stats-filter-label">Período</label>
            <div className="stats-preset-btns">
              {(['today', 'week', 'month', 'year'] as const).map(p => (
                <button key={p} type="button" className={`stats-preset-btn${preset === p ? ' active' : ''}`}
                  onClick={() => setPreset(p)}>
                  {p === 'today' ? 'Hoje' : p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : 'Ano'}
                </button>
              ))}
              <button type="button" className={`stats-preset-btn${preset === 'custom' ? ' active' : ''}`}
                onClick={() => setPreset('custom')}>
                Personalizado
              </button>
            </div>
            {preset === 'custom' && (
              <div className="stats-custom-period">
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
                <span>até</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
                <select value={customGranularity} onChange={e => setCustomGranularity(e.target.value as StatsParams['granularity'])}>
                  <option value="day">Por dia</option>
                  <option value="week">Por semana</option>
                  <option value="month">Por mês</option>
                  <option value="year">Por ano</option>
                </select>
              </div>
            )}
          </div>

          {/* Project status */}
          <div className="stats-filter-group">
            <label className="stats-filter-label">Status do projeto</label>
            <select className="stats-filter-select" value={projectStatus}
              onChange={e => setProjectStatus(e.target.value as typeof projectStatus)}>
              <option value="all">Todos</option>
              <option value="active">Em andamento</option>
              <option value="archived">Arquivados/finalizados</option>
            </select>
          </div>

          {/* Segment */}
          {segmentsQuery.data && segmentsQuery.data.length > 0 && (
            <div className="stats-filter-group">
              <label className="stats-filter-label">Segmento</label>
              <select className="stats-filter-select" value={segment} onChange={e => setSegment(e.target.value)}>
                <option value="">Todos os segmentos</option>
                {segmentsQuery.data.map(s => (
                  <option key={s.slug} value={s.slug}>{s.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Project multi-select */}
        <div className="stats-filter-group">
          <label className="stats-filter-label">
            Projetos {selectedVisibleProjects.length > 0 ? `(${selectedVisibleProjects.length} selecionados)` : '(todos)'}
          </label>
          <div className="stats-project-chips">
            {allProjects.map(p => (
              <button key={p.id} type="button"
                className={`stats-project-chip${selectedVisibleProjects.includes(p.id) ? ' active' : ''}`}
                onClick={() => toggleProject(p.id)}>
                {p.code}
              </button>
            ))}
            {selectedVisibleProjects.length > 0 && (
              <button type="button" className="stats-project-chip-clear"
                onClick={() => setSelectedProjects([])}>
                Limpar seleção
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Loading / Error ── */}
      {statsQuery.isLoading && (
        <div className="page-card placeholder-copy">Carregando estatísticas...</div>
      )}
      {statsQuery.isError && (
        <div className="page-card placeholder-copy" style={{ color: 'var(--rd)' }}>
          Erro ao carregar estatísticas. Tente novamente.
        </div>
      )}
      {exportError && (
        <div className="page-card placeholder-copy" style={{ color: 'var(--rd)' }}>
          {exportError}
        </div>
      )}

      {data && (
        <>
          {/* ── KPIs ── */}
          <div className="survey-dash-card">
            <div className="survey-dash-card-title">Resumo do período</div>
            <KpiCards summary={data.summary} />
          </div>

          {/* ── Timeline ── */}
          {data.timeline.length > 0 && (
            <div className="survey-dash-card">
              <div className="stats-card-header">
                <div className="survey-dash-card-title">Evolução temporal</div>
                <div className="stats-tab-btns">
                  <button type="button" className={`stats-tab-btn${timelineMode === 'hours' ? ' active' : ''}`}
                    onClick={() => setTimelineMode('hours')}>Horas trabalhadas</button>
                  <button type="button" className={`stats-tab-btn${timelineMode === 'services' ? ' active' : ''}`}
                    onClick={() => setTimelineMode('services')}>Serviços realizados</button>
                </div>
              </div>
              <TimelineChart slots={data.timeline} mode={timelineMode} />
            </div>
          )}

          {/* ── Services ── */}
          <div className="survey-dash-card">
            <div className="survey-dash-card-title">Serviços executados</div>
            <ServicesSection services={data.services} byProject={data.byProject} />
          </div>

          {/* ── By Project ── */}
          {!singleProject && data.byProject.length > 0 && (
            <div className="survey-dash-card">
              <div className="stats-card-header">
                <div className="survey-dash-card-title">Por projeto</div>
                <div className="stats-export-btns">
                  <ExportButton section="summary">CSV Resumo</ExportButton>
                  <ExportButton section="byProject">CSV Por projeto</ExportButton>
                  <ExportButton section="services">CSV Serviços</ExportButton>
                </div>
              </div>
              <ByProjectSection
                byProject={data.byProject}
                dailyReportsIncluded={Boolean(data.meta.dailyReportsIncluded)}
                detailParams={statsParams}
              />
            </div>
          )}

          {singleProject && data.byProject.length > 0 && (
            <div className="survey-dash-card">
              <div className="stats-card-header">
                <div className="survey-dash-card-title">RDOs do projeto</div>
                <div className="stats-export-btns">
                  <ExportButton section="services">CSV Serviços</ExportButton>
                </div>
              </div>
              <ByProjectSection
                byProject={data.byProject}
                dailyReportsIncluded={Boolean(data.meta.dailyReportsIncluded)}
                detailParams={statsParams}
              />
            </div>
          )}

          {/* ── Data quality warning ── */}
          {(data.meta.ignoredLegacyRows.volumeOleo > 0 || data.meta.ignoredLegacyRows.tubulacao > 0) && (
            <div className="survey-dash-card stats-warning">
              <div className="survey-dash-card-title">Qualidade dos dados</div>
              <p>
                Alguns registros antigos foram ignorados por formato inválido:
                {data.meta.ignoredLegacyRows.volumeOleo > 0 && ` ${data.meta.ignoredLegacyRows.volumeOleo} volume(s) de óleo`}
                {data.meta.ignoredLegacyRows.tubulacao > 0 && ` ${data.meta.ignoredLegacyRows.tubulacao} linha(s) de tubulação`}.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Overlay wrapper ──────────────────────────────────────────────────────────

interface StatsDashboardOverlayProps {
  onClose: () => void;
}

export function StatsDashboardOverlay({ onClose }: StatsDashboardOverlayProps) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  return (
    <div className="survey-dash-overlay" role="dialog" aria-modal="true" aria-label="Dashboard de Estatísticas">
      <div className="survey-dash-overlay-topbar">
        <img className="survey-dash-overlay-logo" src={headerLogoUrl} alt="Filtrovali" />
        <span className="survey-dash-overlay-title">Dashboard de Estatísticas</span>
        <button className="survey-dash-overlay-back" type="button" onClick={onClose}>← Voltar</button>
      </div>
      <div className="survey-dash-overlay-scroll">
        <div className="survey-dash-overlay-content">
          <StatsDashboard />
        </div>
      </div>
    </div>
  );
}

// ─── Stats Overview (mini dashboard na aba) ───────────────────────────────────

const REPORT_TYPE_LABELS: Record<string, string> = {
  RDO: 'RDO', RTP: 'RTP', RLQ: 'RLQ', RCPU: 'RCPU', RLM: 'RLM', RLF: 'RLF', RLI: 'RLI'
};

const ALL_REPORT_TYPES = ['RDO', 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLF', 'RLI'];

const MONTH_OPTIONS = [
  ['01', 'Janeiro'],
  ['02', 'Fevereiro'],
  ['03', 'Março'],
  ['04', 'Abril'],
  ['05', 'Maio'],
  ['06', 'Junho'],
  ['07', 'Julho'],
  ['08', 'Agosto'],
  ['09', 'Setembro'],
  ['10', 'Outubro'],
  ['11', 'Novembro'],
  ['12', 'Dezembro']
];

function OverviewCountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stats-ov-count-card">
      <div className="stats-ov-count-value">{value}</div>
      <div className="stats-ov-count-label">{label}</div>
    </div>
  );
}

function TopProjectsBar({ rows }: { rows: StatsOverviewProject[] }) {
  const maxRdo = Math.max(...rows.map(r => r.rdoCount), 1);
  return (
    <div className="stats-ov-bar-list">
      {rows.map(row => (
        <div key={row.projectId} className="stats-ov-bar-row">
          <span className="stats-ov-bar-code">{row.code}</span>
          <span className="stats-ov-bar-name">{row.name}</span>
          <div className="stats-ov-bar-track">
            <div className="stats-ov-bar-fill" style={{ width: `${(row.rdoCount / maxRdo) * 100}%` }} />
          </div>
          <span className="stats-ov-bar-count">{row.rdoCount}</span>
        </div>
      ))}
    </div>
  );
}

function ReportTypeTable({ rows }: { rows: StatsOverviewProject[] }) {
  const usedTypes = ALL_REPORT_TYPES.filter(t => rows.some(r => (r.reportCounts[t] ?? 0) > 0));

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="stats-ov-type-table">
        <thead>
          <tr>
            <th>Projeto</th>
            {usedTypes.map(t => <th key={t}>{REPORT_TYPE_LABELS[t]}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const total = Object.values(row.reportCounts).reduce((a, b) => (a as number) + (b as number), 0) as number;
            return (
              <tr key={row.projectId}>
                <td className="stats-ov-type-project">
                  <span className="stats-ov-type-code">{row.code}</span>
                  <span className="stats-ov-type-name">{row.name}</span>
                </td>
                {usedTypes.map(t => (
                  <td key={t} className="stats-ov-type-num">
                    {row.reportCounts[t]
                      ? <strong>{row.reportCounts[t]}</strong>
                      : <span className="stats-ov-type-zero">—</span>}
                  </td>
                ))}
                <td className="stats-ov-type-num stats-ov-type-total">{total || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatAllocationDate(value: string) {
  return formatDateOnlyPtBr(value);
}

function AllocationDayList({ days }: { days: AllocationReportDay[] }) {
  if (days.length === 0) return <span className="stats-alloc-empty-cell">Sem alocação</span>;
  return (
    <div className="stats-alloc-day-list">
      {days.map((day, index) => (
        <div key={`${day.date}-${day.projectId}-${day.shift}-${index}`} className="stats-alloc-day-item">
          <span className="stats-alloc-date">{formatAllocationDate(day.date)}</span>
          <span className="stats-alloc-shift">{day.shift}</span>
          <span className="stats-alloc-project">{day.projectName}</span>
          <span className="stats-alloc-client">{day.clientName || '-'}</span>
          <span className="stats-alloc-cnpj">{day.clientCnpj || '-'}</span>
        </div>
      ))}
    </div>
  );
}

function AllocationTable({ collaborators }: { collaborators: AllocationReportCollaborator[] }) {
  if (collaborators.length === 0) {
    return <div className="stats-empty">Nenhuma alocação encontrada para o mês selecionado.</div>;
  }

  return (
    <div className="stats-alloc-table-wrap">
      <table className="stats-alloc-table">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Cargo</th>
            <th>Alocações do mês</th>
          </tr>
        </thead>
        <tbody>
          {collaborators.map(collaborator => (
            <tr key={collaborator.collaboratorId || collaborator.collaboratorName}>
              <td className="stats-alloc-person">{collaborator.collaboratorName}</td>
              <td>{collaborator.collaboratorRole || '-'}</td>
              <td><AllocationDayList days={collaborator.days} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthlyAllocationDashboard() {
  const [selectedYear, setSelectedYear] = useState(currentYearValue());
  const [selectedMonth, setSelectedMonth] = useState(currentMonthNumber());
  const [activeTab, setActiveTab] = useState<'summary' | 'recipients'>('summary');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);

  const yearMonth = `${selectedYear}-${selectedMonth}`;
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, index) => String(current + 1 - index));
  }, []);
  const allocationQuery = useAllocationReport(yearMonth);
  const recipientsQuery = useAllocationReportRecipients();
  const recipientMutations = useAllocationReportRecipientMutations();

  async function handleDownloadPdf() {
    setMessage('');
    setPdfLoading(true);
    try {
      const blob = await downloadAllocationReportPdf(yearMonth);
      downloadBlob(blob, allocationReportPdfFileName(yearMonth));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível baixar o PDF.');
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleAddRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    try {
      await recipientMutations.saveRecipient.mutateAsync({
        name: recipientName.trim() || undefined,
        email: recipientEmail.trim()
      });
      setRecipientName('');
      setRecipientEmail('');
      setMessage('Destinatário salvo.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível salvar o destinatário.');
    }
  }

  async function handleToggleRecipient(id: string, isActive: boolean) {
    setMessage('');
    try {
      await recipientMutations.updateRecipient.mutateAsync({ id, payload: { isActive: !isActive } });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o destinatário.');
    }
  }

  async function handleRemoveRecipient(id: string) {
    setMessage('');
    try {
      await recipientMutations.removeRecipient.mutateAsync(id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível remover o destinatário.');
    }
  }

  async function handleSendNow() {
    setMessage('');
    try {
      const result = await recipientMutations.sendNow.mutateAsync(yearMonth);
      if (result.skipped) {
        setMessage(result.reason === 'no_recipients'
          ? 'Nenhum destinatário ativo cadastrado.'
          : 'Envio não realizado.');
        return;
      }
      setMessage(`E-mail enviado para ${result.sent} destinatário${result.sent === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível enviar o relatório agora.');
    }
  }

  const data = allocationQuery.data;
  const recipients = recipientsQuery.data || [];
  const activeRecipients = recipients.filter(item => item.isActive).length;

  return (
    <div className="stats-alloc-dashboard">
      <div className="survey-dash-card stats-alloc-section">
        <div className="stats-card-header">
          <div>
            <div className="survey-dash-card-title">Alocação mensal de colaboradores</div>
            <div className="stats-alloc-subtitle">Resumo dia a dia por projeto e CNPJ.</div>
          </div>
          <div className="stats-alloc-actions">
            <label className="stats-alloc-select-field">
              <span>Ano</span>
              <select className="stats-filter-select stats-alloc-year" value={selectedYear} onChange={event => setSelectedYear(event.target.value)}>
                {yearOptions.map(year => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <label className="stats-alloc-select-field">
              <span>Mês</span>
              <select className="stats-filter-select stats-alloc-month" value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)}>
                {MONTH_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <button className="mini-btn" type="button" onClick={handleDownloadPdf} disabled={pdfLoading || allocationQuery.isLoading}>
              {pdfLoading ? 'Gerando...' : 'Baixar PDF'}
            </button>
          </div>
        </div>

        <div className="stats-alloc-tabs" role="tablist" aria-label="Seções da alocação mensal">
          <button type="button" role="tab" aria-selected={activeTab === 'summary'} className={`stats-tab-btn${activeTab === 'summary' ? ' active' : ''}`} onClick={() => setActiveTab('summary')}>
            Resumo
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'recipients'} className={`stats-tab-btn${activeTab === 'recipients' ? ' active' : ''}`} onClick={() => setActiveTab('recipients')}>
            Destinatários
          </button>
        </div>

        {activeTab === 'summary' && (
          <>
            {allocationQuery.isLoading && <div className="stats-empty">Carregando alocações...</div>}
            {allocationQuery.isError && <div className="stats-empty">Erro ao carregar alocações do mês.</div>}
            {data && (
              <>
                <div className="stats-alloc-kpis">
                  <OverviewCountCard label="RDOs" value={data.summary.reportCount} />
                  <OverviewCountCard label="Colaboradores" value={data.summary.collaboratorCount} />
                  <OverviewCountCard label="Alocações" value={data.summary.allocationCount} />
                  <OverviewCountCard label="Projetos" value={data.summary.projectCount} />
                </div>
                <AllocationTable collaborators={data.collaborators} />
              </>
            )}
          </>
        )}
      </div>

      {activeTab === 'recipients' && <div className="survey-dash-card stats-alloc-section">
        <div className="stats-card-header">
          <div>
            <div className="survey-dash-card-title">Destinatários do envio mensal</div>
            <div className="stats-alloc-subtitle">O envio automático ocorre no dia 1 para o mês anterior. Ativos: {activeRecipients}</div>
          </div>
          <button
            className="mini-btn"
            type="button"
            onClick={handleSendNow}
            disabled={recipientMutations.sendNow.isPending || recipientsQuery.isLoading || activeRecipients === 0}
          >
            {recipientMutations.sendNow.isPending ? 'Enviando...' : 'Enviar agora'}
          </button>
        </div>

        <form className="stats-alloc-recipient-form" onSubmit={handleAddRecipient}>
          <input
            type="text"
            value={recipientName}
            onChange={event => setRecipientName(event.target.value)}
            placeholder="Nome opcional"
          />
          <input
            type="email"
            value={recipientEmail}
            onChange={event => setRecipientEmail(event.target.value)}
            placeholder="email@empresa.com"
            required
          />
          <button className="mini-btn" type="submit" disabled={recipientMutations.saveRecipient.isPending}>
            Salvar e-mail
          </button>
        </form>

        {message && <div className="stats-alloc-message">{message}</div>}
        {recipientsQuery.isLoading && <div className="stats-empty">Carregando destinatários...</div>}
        {recipientsQuery.isError && <div className="stats-empty">Erro ao carregar destinatários.</div>}
        {recipients.length > 0 ? (
          <div className="stats-alloc-recipient-list">
            {recipients.map(recipient => (
              <div key={recipient.id} className={`stats-alloc-recipient${recipient.isActive ? '' : ' inactive'}`}>
                <div>
                  <strong>{recipient.name || recipient.email}</strong>
                  {recipient.name && <span>{recipient.email}</span>}
                </div>
                <div className="stats-alloc-recipient-actions">
                  <button className="mini-btn alt" type="button" onClick={() => handleToggleRecipient(recipient.id, recipient.isActive)}>
                    {recipient.isActive ? 'Desativar' : 'Ativar'}
                  </button>
                  <button className="mini-btn danger" type="button" onClick={() => handleRemoveRecipient(recipient.id)}>
                    Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          !recipientsQuery.isLoading && <div className="stats-empty">Nenhum destinatário cadastrado.</div>
        )}
      </div>}
    </div>
  );
}

export function MonthlyAllocationDashboardOverlay({ onClose }: StatsDashboardOverlayProps) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  return (
    <div className="survey-dash-overlay" role="dialog" aria-modal="true" aria-label="Alocação mensal de colaboradores">
      <div className="survey-dash-overlay-topbar">
        <img className="survey-dash-overlay-logo" src={headerLogoUrl} alt="Filtrovali" />
        <span className="survey-dash-overlay-title">Alocação Mensal</span>
        <button className="survey-dash-overlay-back" type="button" onClick={onClose}>← Voltar</button>
      </div>
      <div className="survey-dash-overlay-scroll">
        <div className="survey-dash-overlay-content">
          <MonthlyAllocationDashboard />
        </div>
      </div>
    </div>
  );
}

export function StatsOverview() {
  const { data, isLoading, isError } = useStatsOverview();
  const [showAll, setShowAll] = useState(false);

  if (isLoading) return <div className="page-card placeholder-copy">Carregando visão geral...</div>;
  if (isError) return <div className="page-card placeholder-copy" style={{ color: 'var(--rd)' }}>Erro ao carregar dados.</div>;
  if (!data) return null;

  const top10 = data.byProject.slice(0, 10);
  const withReports = data.byProject.filter(r => Object.keys(r.reportCounts).length > 0);
  const tableRows = showAll ? withReports : withReports.slice(0, 15);

  return (
    <div className="stats-ov-wrap">
      {/* Contadores */}
      <div className="survey-dash-card stats-ov-section">
        <div className="survey-dash-card-title">Projetos</div>
        <div className="stats-ov-count-row">
          <OverviewCountCard label="Em andamento" value={data.projectCounts.active} />
          <OverviewCountCard label="Arquivados / finalizados" value={data.projectCounts.archived} />
          <OverviewCountCard label="Total" value={data.projectCounts.total} />
        </div>
      </div>

      {/* Top por RDOs */}
      {top10.length > 0 && (
        <div className="survey-dash-card stats-ov-section">
          <div className="survey-dash-card-title">Projetos com mais RDOs aprovados / assinados</div>
          <TopProjectsBar rows={top10} />
        </div>
      )}

      {/* Relatórios por tipo */}
      {tableRows.length > 0 && (
        <div className="survey-dash-card stats-ov-section">
          <div className="survey-dash-card-title">Relatórios por projeto e tipo</div>
          <ReportTypeTable rows={tableRows} />
          {withReports.length > 15 && !showAll && (
            <button type="button" className="stats-ov-show-more" onClick={() => setShowAll(true)}>
              Ver todos os {withReports.length} projetos
            </button>
          )}
        </div>
      )}

      {data.byProject.length === 0 && (
        <div className="survey-dash-card">
          <div className="stats-empty">Nenhum relatório aprovado ou assinado encontrado.</div>
        </div>
      )}
    </div>
  );
}
