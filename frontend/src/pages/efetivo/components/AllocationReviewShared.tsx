import type { ReviewViewMode } from './allocationReviewPresentation';

// Peças comuns às visões de semana e de mês da conferência de alocação.

export function AllocationReviewViewToggle({ view, onChange }: { view: ReviewViewMode; onChange: (view: ReviewViewMode) => void }) {
  return (
    <div className="efetivo-segmented allocation-review-view-toggle" role="group" aria-label="Visão">
      {([['semana', 'Semana'], ['mes', 'Mês']] as const).map(([value, label]) => (
        <button key={value} type="button" className={view === value ? 'active' : ''} aria-pressed={view === value} onClick={() => onChange(value)}>{label}</button>
      ))}
    </div>
  );
}

const LEGEND: Array<[string, string]> = [
  ['project', 'Projeto'],
  ['travel', 'Viagem'],
  ['sede', 'Sede'],
  ['folga', 'Folga'],
  ['absence', 'Férias / afastamento'],
  ['pending', 'Divergência'],
  ['none', 'Sem informação']
];

export function AllocationReviewLegend({ showDots = false }: { showDots?: boolean }) {
  return (
    <ul className="allocation-review-legend" aria-label="Legenda">
      {LEGEND.map(([tone, label]) => (
        <li key={tone}><i className={`allocation-review-swatch is-${tone}`} aria-hidden="true" />{label}</li>
      ))}
      {showDots ? <li>Pontinhos: Ponto · RDO · Efetivo</li> : null}
    </ul>
  );
}
