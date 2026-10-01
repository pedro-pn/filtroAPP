import { parseProposalPercentage, consideredProposalValue } from '../../utils/proposalPercentage';
import { Alert, Button, Field, Input } from '../ui/ds';

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
    <details className="acp-schedule-ds__proposal-details">
      <summary>Ajustar percentual da proposta</summary>
      <div className="acp-schedule-ds__proposal-content">
      <Field id={`acp-proposal-percentage-${projectId}`} label="Percentual da proposta considerado (%)" optionalText="">
        <Input type="number" min="0" max="100" step="0.01" inputMode="decimal"
          required value={value} disabled={!canManage} onChange={event => onChange(event.target.value)} />
      </Field>
      <p className="acp-schedule-ds__muted">100% considera a proposta integral. O percentual ajusta custos, receita, dias, horas e quantitativos previstos, incluindo os adicionais. Cada projeto mantém seu percentual, mesmo quando mesclado.</p>
      {percentage == null ? <Alert tone="danger">Informe um percentual de 0% a 100%, com no máximo duas casas decimais.</Alert> : null}
      {rows.some(row => row.value != null) ? (
        <div className="acp-schedule-ds__proposal-grid" aria-label="Prévia da proposta considerada">
          {rows.map(row => <div key={row.label}>
            <strong>{row.label}</strong>
            <span>Integral <b>{formatValue(row.value, row.unit)}</b></span>
            <span>Considerado{percentage != null ? ` (${percentage.toLocaleString('pt-BR')}%)` : ''} <b>{formatValue(percentage == null ? null : consideredProposalValue(row.value, percentage), row.unit)}</b></span>
          </div>)}
        </div>
      ) : null}
      {canManage ? <Button type="button" size="sm" variant="secondary" onClick={() => onChange('100')}>Restaurar 100%</Button> : null}
      </div>
    </details>
  );
}
