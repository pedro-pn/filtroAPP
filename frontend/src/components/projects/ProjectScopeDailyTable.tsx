import { SortableTable } from '../ui/SortableTable';
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
  return `Total (${physicalQuantityLabel(unit)})`;
}

function mobileTotalLabel(unit: string, serviceType?: string) {
  if (unit === 'M') return 'Metros executados';
  if (unit === 'UN') return 'Unidades executadas';
  if (unit === 'L') return serviceType ? SERVICE_LABELS[serviceType] ?? serviceType : 'Litros executados';
  return `Produção (${physicalQuantityLabel(unit)})`;
}

function mobileQuantity(value: number, unit: string) {
  if (unit === 'UN') return `${formatQuantity(value)} ${value === 1 ? 'unidade' : 'unidades'}`;
  return `${formatQuantity(value)} ${unit === 'L' ? 'L' : physicalQuantityLabel(unit)}`;
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
  const visibleTotalIndexes = units.flatMap((unit, index) =>
    unit === 'L' && measures.filter(measure => measure.unit === unit).length === 1 ? [] : [index]);
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
    <details className="acp-scope-daily__details" open>
      <summary className="acp-detail-summary acp-scope-daily__summary">
        Avanço diário do escopo <span>· {filterLabel || 'Escopo total'}</span>
      </summary>
      <div className="acp-scope-daily__content">
        <p className="acp-scope-daily__intro">Últimos lançamentos primeiro</p>
        {rows.length === 0 ? <p className="acp-scope-daily__empty">Ainda não há avanço diário registrado para este recorte.</p>
        : measures.length === 0 ? <p className="acp-scope-daily__empty">Sem quantitativos de execução por serviço para este recorte.</p> : <>
          <div className="acp-scope-daily__table-wrap">
            <SortableTable>
              <caption className="sr-only">Produção diária por serviço e avanço acumulado do escopo</caption>
              <thead><tr>
                <th scope="col">Data</th>
                <th scope="col">Dia da semana</th>
                {measures.map(({ serviceType, unit }) => <th scope="col" key={`${serviceType}:${unit}`}>
                  {SERVICE_LABELS[serviceType] ?? serviceType} ({physicalQuantityLabel(unit)})
                </th>)}
                {visibleTotalIndexes.map(index => <th scope="col" key={units[index]}>{totalLabel(units[index])}</th>)}
                <th scope="col">Avanço acumulado</th>
              </tr></thead>
              <tbody>{rows.map(({ point, services, totals }) => <tr key={point.date}>
                <th scope="row" data-sort-value={point.date}>{formatDateOnlyPtBr(point.date)}</th>
                <td>{weekdayFormatter.format(validDate(point.date)!)}</td>
                {services.map((value, index) => <td key={`${measures[index].serviceType}:${measures[index].unit}`}>
                  {value == null ? '—' : formatQuantity(value)}
                </td>)}
                {visibleTotalIndexes.map(index => {
                  const value = totals[index];
                  return <td className="acp-scope-daily__daily" key={units[index]}>
                    {value == null ? '—' : formatQuantity(value)}
                  </td>;
                })}
                <td className="acp-scope-daily__total" data-sort-value={point.progressPct}>{fmtPct(point.progressPct)}</td>
              </tr>)}</tbody>
            </SortableTable>
          </div>
          <div className="acp-scope-daily__mobile" aria-label="Avanço diário em cartões">
            {rows.map(({ point, services, totals }) => {
              const dailyTotals = totals.flatMap((value, index) => value == null ? [] : [{ unit: units[index], value }]);
              const dailyServices = measures.flatMap((measure, index) => {
                const value = services[index];
                return value == null ? [] : [{ ...measure, value }];
              });
              const splitUnits = new Set(units.filter(unit => dailyServices.filter(service => service.unit === unit).length > 1));
              const splitServices = dailyServices.filter(service => splitUnits.has(service.unit));
              return <article key={point.date}>
                <header className="acp-scope-daily__mobile-head">
                  <div><time dateTime={point.date.slice(0, 10)}>{formatDateOnlyPtBr(point.date)}</time>
                    <span>{weekdayFormatter.format(validDate(point.date)!)}</span></div>
                  <div className="acp-scope-daily__mobile-progress">
                    <span>Avanço acumulado</span><strong>{fmtPct(point.progressPct)}</strong>
                  </div>
                </header>
                <div className="acp-scope-daily__mobile-production">
                  <span className="acp-scope-daily__mobile-label">Executado no dia</span>
                  {dailyTotals.length ? <div className="acp-scope-daily__mobile-metrics">
                    {dailyTotals.map(({ unit, value }) => {
                      const activeServices = dailyServices.filter(service => service.unit === unit);
                      return <div className="acp-scope-daily__mobile-metric" key={unit}>
                        <span>{mobileTotalLabel(unit, unit === 'L' && activeServices.length === 1 ? activeServices[0].serviceType : undefined)}</span>
                        <strong>{mobileQuantity(value, unit)}</strong>
                        {activeServices.length === 1 && unit !== 'L' ? <small>{SERVICE_LABELS[activeServices[0].serviceType] ?? activeServices[0].serviceType}</small> : null}
                      </div>;
                    })}
                  </div> : <p className="acp-scope-daily__mobile-empty">Sem produção física medida neste dia.</p>}
                </div>
                {splitServices.length ? <details className="acp-scope-daily__mobile-breakdown">
                  <summary>Ver por serviço</summary>
                  <dl>{splitServices.map(({ serviceType, unit, value }) => <div key={`${serviceType}:${unit}`}>
                    <dt>{SERVICE_LABELS[serviceType] ?? serviceType}</dt>
                    <dd>{mobileQuantity(value, unit)}</dd>
                  </div>)}</dl>
                </details> : null}
              </article>;
            })}
          </div>
        </>}
      </div>
    </details>
  </Card>;
}
