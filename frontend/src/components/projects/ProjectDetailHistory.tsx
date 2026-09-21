import { useEffect, useRef, useState } from 'react';
import type { ProgressHistoryPoint } from '../../api/acompanhamentoComercial';
import { clampPct, fmtDate, fmtPct, fmtShortDate } from './projectDetailModel';

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

export function ProgressHistoryChart({ points }: { points?: ProgressHistoryPoint[] }) {
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
      <div className="acp-detail-history empty" data-acp-progress-history-chart>
        <div className="acp-detail-history-head">
          <span>Histórico semanal</span>
          <strong>Sem histórico</strong>
        </div>
      </div>
    );
  }

  const width = chartWidth;
  const height = 144;
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
    <div className="acp-detail-history" aria-label="Histórico semanal de avanço" data-acp-progress-history-chart>
      <div className="acp-detail-history-head">
        <span>Histórico semanal</span>
        <strong>{fmtPct(latest?.progressPct)}</strong>
      </div>
      <svg ref={chartRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Avanço de ${fmtShortDate(history[0].date)} até ${fmtShortDate(latest?.date)}`}>
        {[0, 50, 100].map(value => (
          <g key={value}>
            <line
              className="acp-detail-history-grid"
              x1={pad.left}
              y1={yFor(value)}
              x2={width - pad.right}
              y2={yFor(value)}
            />
            <text className="acp-detail-history-y" x={pad.left - 6} y={yFor(value) + 3} textAnchor="end">
              {value}
            </text>
          </g>
        ))}
        <path className="acp-detail-history-line" d={path} />
        {plotted.map(point => (
          <g
            className="acp-detail-history-point"
            key={`${point.date}-${point.progressPct}`}
            tabIndex={0}
            aria-label={pointLabel(point)}
            onFocus={() => setActivePoint(point)}
            onBlur={() => setActivePoint(null)}
            onMouseEnter={() => setActivePoint(point)}
            onMouseLeave={() => setActivePoint(null)}
          >
            <circle className="acp-detail-history-dot-hit" cx={point.x} cy={point.y} r="8" />
            <circle className="acp-detail-history-dot" cx={point.x} cy={point.y} r="3.4" />
          </g>
        ))}
        <text className="acp-detail-history-x" x={pad.left} y={height - 4} textAnchor="start">
          {fmtShortDate(history[0].date)}
        </text>
        <text className="acp-detail-history-x" x={width - pad.right} y={height - 4} textAnchor="end">
          {fmtShortDate(latest?.date)}
        </text>
        {tooltip ? (
          <g className="acp-detail-history-tip" transform={`translate(${tooltip.x} ${tooltip.y})`}>
            <rect width={tipWidth} height={tipHeight} rx="6" />
            <path
              className="acp-detail-history-tip-arrow"
              d={tooltip.above
                ? `M ${tooltip.arrowX - 5} ${tipHeight - 1} L ${tooltip.arrowX} ${tipHeight + 5} L ${tooltip.arrowX + 5} ${tipHeight - 1} Z`
                : `M ${tooltip.arrowX - 5} 1 L ${tooltip.arrowX} -5 L ${tooltip.arrowX + 5} 1 Z`}
            />
            <text className="acp-detail-history-tip-date" x="10" y="15">{tooltip.day}</text>
            <text className="acp-detail-history-tip-label" x="10" y="32">Quantidade</text>
            <text className="acp-detail-history-tip-value" x={tipWidth - 10} y="32" textAnchor="end">{tooltip.amount}</text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
