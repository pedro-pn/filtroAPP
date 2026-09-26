import type { DailyProgressPoint } from '../../api/acompanhamentoComercial';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import { Card } from '../ui/ds';
import { fmtPct, physicalQuantityLabel, SERVICE_LABELS } from './projectDetailModel';
import './ProjectScopeDailyTable.css';

const weekdayFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' });

function validDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatQuantity(value: number) {
  return (Math.round(value * 100) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function totalLabel(unit: string) {
  if (unit === 'UN') return 'Unidades executadas';
  if (unit === 'L') return 'Óleo filtrado (L)';
  return `Total (${physicalQuantityLabel(unit)})`;
}

function quantityFor(point: DailyProgressPoint | undefined, serviceType: string, unit: string) {
  return point?.services?.find(service => service.serviceType === serviceType)
    ?.quantities?.find(quantity => quantity.unit === unit)?.realizedQty;
}

export function ProjectScopeDailyTable({ points, filterLabel }: {
  points?: DailyProgressPoint[];
  filterLabel?: string;
}) {
  const ordered = (points ?? [])
    .filter(point => validDate(point.date) && Number.isFinite(point.progressPct))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const measures = [...new Map(ordered.flatMap(point => point.services?.flatMap(service =>
    service.quantities?.map(quantity => [
      `${service.serviceType}:${quantity.unit}`,
      { serviceType: service.serviceType, unit: quantity.unit }
    ] as const) ?? []) ?? [])).values()];
  const units = [...new Set(measures.map(measure => measure.unit))];
  const rows = ordered.map((point, index) => {
    const previous = ordered[index - 1];
    const services = measures.map(({ serviceType, unit }) => {
      const current = quantityFor(point, serviceType, unit);
      const prior = quantityFor(previous, serviceType, unit);
      return current == null ? null : current - (prior ?? 0);
    });
    return {
      point,
      services,
      totals: units.map(unit => {
        const values = services.filter((_, measureIndex) => measures[measureIndex].unit === unit);
        return values.some(value => value !== null)
          ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
      })
    };
  }).reverse();

  return <Card padding="sm" className="acp-scope-daily" data-acp-scope-daily>
    <details className="acp-scope-daily__details">
      <summary className="acp-detail-summary acp-scope-daily__summary">
        Avanço diário do escopo <span>· {filterLabel || 'Escopo total'}</span>
      </summary>
      <div className="acp-scope-daily__content">
        <p className="acp-scope-daily__intro">Últimos lançamentos primeiro</p>
        {rows.length === 0 ? <p className="acp-scope-daily__empty">Ainda não há avanço diário registrado para este recorte.</p>
        : measures.length === 0 ? <p className="acp-scope-daily__empty">Sem quantitativos de execução por serviço para este recorte.</p> : <>
          <div className="acp-scope-daily__table-wrap">
            <table>
              <caption className="sr-only">Produção diária por serviço e avanço acumulado do escopo</caption>
              <thead><tr>
                <th scope="col">Data</th>
                <th scope="col">Dia da semana</th>
                {measures.map(({ serviceType, unit }) => <th scope="col" key={`${serviceType}:${unit}`}>
                  {SERVICE_LABELS[serviceType] ?? serviceType} ({physicalQuantityLabel(unit)})
                </th>)}
                {units.map(unit => <th scope="col" key={unit}>{totalLabel(unit)}</th>)}
                <th scope="col">Avanço acumulado</th>
              </tr></thead>
              <tbody>{rows.map(({ point, services, totals }) => <tr key={point.date}>
                <th scope="row">{formatDateOnlyPtBr(point.date)}</th>
                <td>{weekdayFormatter.format(validDate(point.date)!)}</td>
                {services.map((value, index) => <td key={`${measures[index].serviceType}:${measures[index].unit}`}>
                  {value == null ? '—' : formatQuantity(value)}
                </td>)}
                {totals.map((value, index) => <td className="acp-scope-daily__daily" key={units[index]}>
                  {value == null ? '—' : formatQuantity(value)}
                </td>)}
                <td className="acp-scope-daily__total">{fmtPct(point.progressPct)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="acp-scope-daily__mobile" aria-label="Avanço diário em cartões">
            {rows.map(({ point, services, totals }) => <article key={point.date}>
              <div className="acp-scope-daily__mobile-head">
                <span>{formatDateOnlyPtBr(point.date)} · {weekdayFormatter.format(validDate(point.date)!)}</span>
                <strong>Acumulado {fmtPct(point.progressPct)}</strong>
              </div>
              {totals.map((value, index) => <p key={units[index]}>{totalLabel(units[index])}
                <strong>{value == null ? '—' : `${formatQuantity(value)} ${physicalQuantityLabel(units[index])}`}</strong>
              </p>)}
              {measures.length > 0 ? <div className="acp-scope-daily__services">
                {measures.map(({ serviceType, unit }, index) => <span key={`${serviceType}:${unit}`}>
                  <b>{SERVICE_LABELS[serviceType] ?? serviceType}</b>
                  {services[index] == null ? '—' : `${formatQuantity(services[index])} ${physicalQuantityLabel(unit)}`}
                </span>)}
              </div> : null}
            </article>)}
          </div>
        </>}
      </div>
    </details>
  </Card>;
}
