import { parseProposalPercentage, consideredProposalValue } from '../../utils/proposalPercentage';

export interface ProposalPreviewRow { label: string; value: number | null; unit: 'BRL' | 'dias' | 'h' }

function formatValue(value: number | null, unit: ProposalPreviewRow['unit']) {
  if (value == null) return '—';
  return unit === 'BRL' ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}

export function ProjectProposalPercentageField({ projectId, value, canManage, onChange, rows }: {
  projectId: string;
  value: string;
  canManage: boolean;
  onChange: (value: string) => void;
  rows: ProposalPreviewRow[];
}) {
  const percentage = parseProposalPercentage(value);
  return (
    <div className="acp-planned-cost">
      <div className="field-group">
        <label htmlFor={`acp-proposal-percentage-${projectId}`}>Percentual da proposta considerado (%)</label>
        <input id={`acp-proposal-percentage-${projectId}`} type="number" min="0" max="100" step="0.01"
          required value={value} disabled={!canManage} onChange={event => onChange(event.target.value)} />
      </div>
      <p className="placeholder-copy">100% considera a proposta integral. O percentual ajusta custos, receita, dias, horas e quantitativos previstos, incluindo os adicionais. Cada projeto mantém seu percentual, mesmo quando mesclado.</p>
      {percentage == null ? <p className="form-error" role="alert">Informe um percentual de 0% a 100%, com no máximo duas casas decimais.</p> : null}
      {rows.some(row => row.value != null) ? (
        <div className="table-scroll">
          <table className="acp-proposal-preview">
            <thead><tr><th>Previsto</th><th>Integral</th><th>Considerado{percentage != null ? ` (${percentage.toLocaleString('pt-BR')}%)` : ''}</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.label}><th>{row.label}</th><td>{formatValue(row.value, row.unit)}</td>
              <td>{formatValue(percentage == null ? null : consideredProposalValue(row.value, percentage), row.unit)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
      {canManage ? <button type="button" className="mini-btn alt" onClick={() => onChange('100')}>Restaurar 100%</button> : null}
    </div>
  );
}
