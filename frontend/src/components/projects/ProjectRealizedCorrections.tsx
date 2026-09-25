import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import {
  listRealizedCorrections, saveRealizedCorrection,
  type RealizedCorrectionRow, type TubeCorrectionService
} from '../../api/acompanhamentoComercial';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';

const LABELS: Record<TubeCorrectionService, string> = {
  TESTE_PRESSAO: 'RTH · Teste de pressão',
  LIMPEZA_QUIMICA: 'RLQ · Limpeza química',
  FLUSHING: 'FLU · Flushing'
};
const quantity = (value: number) => `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
const dateLabel = (date: string) => date.split('-').reverse().join('/');

function parseMeters(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  const normalized = text.includes(',') ? text.replaceAll('.', '').replace(',', '.') : text;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 && Math.abs(Math.round(value * 100) - value * 100) < 1e-7 ? value : null;
}

export function ProjectRealizedCorrections({ projectId, canManage = false }: { projectId: string; canManage?: boolean }) {
  const client = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const queryKey = ['realized-corrections', projectId];
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: () => listRealizedCorrections(projectId), ...acompanhamentoRefreshQueryOptions });
  const [date, setDate] = useState('');
  const [serviceType, setServiceType] = useState<TubeCorrectionService>('TESTE_PRESSAO');
  const [meters, setMeters] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [message, setMessage] = useState('');
  const [showAll, setShowAll] = useState(false);

  const correctedRows = data?.rows.filter(row => row.correctedMeters !== null) ?? [];
  const visibleRows = showAll || correctedRows.length === 0 ? data?.rows ?? [] : correctedRows;
  const selected = data?.rows.find(row => row.date === date && row.serviceType === serviceType);
  const mutation = useMutation({
    mutationFn: (value: number | null) => saveRealizedCorrection(projectId, {
      date, serviceType, quantityM: value, reason: reason.trim(), reference: reference.trim() || null,
      expectedRevision: selected?.revision ?? 0, expectedSourceMeters: selected?.sourceMeters ?? 0
    }),
    onSuccess: async () => {
      setMessage('Correção registrada. O avanço foi atualizado.');
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ predicate: query => /progress|project-detail|mission-group-detail|project-cards|commercial-dashboard|project-execution|execution-dashboard/.test(String(query.queryKey[0])) })
      ]);
    },
    onError: err => setMessage(err instanceof Error ? err.message : 'Não foi possível salvar a correção.')
  });

  function selectRow(row: RealizedCorrectionRow) {
    setDate(row.date);
    setServiceType(row.serviceType);
    setMeters(String(row.effectiveMeters).replace('.', ','));
    setReason(row.reason || 'Metragem validada com o responsável pela obra.');
    setReference(row.reference || '');
    setMessage('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    const value = parseMeters(meters);
    if (value === null) return setMessage('Informe uma metragem válida com até duas casas decimais.');
    if (reason.trim().length < 10) return setMessage('Informe o motivo da correção (ao menos 10 caracteres).');
    mutation.mutate(value);
  }

  return <details className="acp-realized">
    <summary className="acp-realized-summary">
      <span className="acp-realized-summary-copy">
        <strong>Conciliação de metragens</strong>
        <small>Compare o RDO com o realizado validado por dia e serviço.</small>
      </span>
      {correctedRows.length > 0 ? <span className="acp-realized-count">{correctedRows.length} {correctedRows.length === 1 ? 'ajuste' : 'ajustes'}</span> : null}
    </summary>
    <div className="acp-realized-content">
      <p className="acp-realized-intro">A metragem validada substitui somente os metros deste dia no avanço. O RDO original permanece disponível.</p>
      {isLoading ? <p className="placeholder-copy">Carregando metragens…</p> : error ? <p role="alert" className="acp-alert danger">Não foi possível carregar as correções.</p> : null}
      {data?.rows.length ? <>
        {correctedRows.length > 0 && data.rows.length > correctedRows.length ? <div className="acp-realized-toolbar">
          <span>{showAll ? `${data.rows.length} lançamentos` : `${correctedRows.length} lançamentos ajustados`}</span>
          <button type="button" className="mini-btn alt" onClick={() => setShowAll(value => !value)}>
            {showAll ? 'Mostrar apenas ajustados' : 'Mostrar todos os dias'}
          </button>
        </div> : null}
        <div className="acp-realized-list">
          {[...visibleRows].reverse().map(row => {
            const adjusted = row.correctedMeters !== null;
            const difference = row.effectiveMeters - row.sourceMeters;
            return <article className="acp-realized-row" key={`${row.date}:${row.serviceType}`}>
              <div className="acp-realized-row-head">
                <div className="acp-realized-identity"><time dateTime={row.date}>{dateLabel(row.date)}</time><strong>{LABELS[row.serviceType]}</strong></div>
                <span className={`acp-realized-state ${adjusted ? 'is-adjusted' : ''}`}>{adjusted ? 'Validado' : 'Valor do RDO'}</span>
              </div>
              <div className="acp-realized-row-body">
                <div className="acp-realized-measures">
                  <div><span>RDO</span><strong>{quantity(row.sourceMeters)}</strong></div>
                  <span className="acp-realized-arrow" aria-hidden="true">→</span>
                  <div><span>Aplicado no avanço</span><strong>{quantity(row.effectiveMeters)}</strong></div>
                  {adjusted ? <span className={`acp-realized-delta ${difference > 0 ? 'is-positive' : difference < 0 ? 'is-negative' : ''}`}>
                    {difference > 0 ? '+' : ''}{quantity(difference)}
                  </span> : null}
                </div>
                {canManage ? <button type="button" className="mini-btn alt" onClick={() => selectRow(row)}>Conferir</button> : null}
              </div>
              {row.sourceChanged ? <p className="acp-realized-warning">O RDO mudou após a correção. Confira este lançamento.</p> : null}
              {row.reason ? <p className="acp-realized-reason">{row.reason}</p> : null}
              {row.history.length > 0 ? <details className="acp-realized-history"><summary>Histórico de revisões ({row.history.length})</summary>
                <ol>{row.history.map(item => <li key={item.revision}><strong>Revisão {item.revision}</strong> · {item.quantityM === null ? 'RDO restaurado' : quantity(item.quantityM)} · {item.reason}{item.reference ? ` · ${item.reference}` : ''}</li>)}</ol>
              </details> : null}
            </article>;
          })}
        </div>
      </> : !isLoading && !error ? <p className="placeholder-copy">Nenhuma metragem de tubulação lançada neste projeto.</p> : null}
      {canManage ? <form ref={formRef} onSubmit={submit} className="acp-realized-form">
        <div className="acp-realized-form-heading"><strong>Registrar ou revisar metragem</strong><span>Disponível para serviços com meta global de tubulação.</span></div>
        <div className="acp-realized-fields">
          <div className="field-group"><label htmlFor={`realized-date-${projectId}`}>Dia</label><input id={`realized-date-${projectId}`} type="date" required value={date} onChange={event => setDate(event.target.value)} /></div>
          <div className="field-group"><label htmlFor={`realized-service-${projectId}`}>Serviço</label><select id={`realized-service-${projectId}`} value={serviceType} onChange={event => setServiceType(event.target.value as TubeCorrectionService)}>
            {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></div>
          <div className="field-group"><label htmlFor={`realized-meters-${projectId}`}>Metragem validada (m)</label><input id={`realized-meters-${projectId}`} type="text" inputMode="decimal" required value={meters} onChange={event => setMeters(event.target.value)} placeholder="Ex.: 280,00" /></div>
          <div className="field-group acp-realized-field-wide"><label htmlFor={`realized-reason-${projectId}`}>Motivo da correção</label><input id={`realized-reason-${projectId}`} type="text" required minLength={10} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Ex.: conferência com o responsável pela obra" /></div>
          <div className="field-group acp-realized-field-wide"><label htmlFor={`realized-reference-${projectId}`}>Referência (opcional)</label><input id={`realized-reference-${projectId}`} type="text" maxLength={500} value={reference} onChange={event => setReference(event.target.value)} placeholder="Planilha, ata ou link de conferência" /></div>
        </div>
        <div className="acp-realized-actions">
          <button type="submit" className="mini-btn" disabled={mutation.isPending}>Salvar metragem validada</button>
          {selected?.correctedMeters !== null && selected?.correctedMeters !== undefined ? <button type="button" className="mini-btn alt" disabled={mutation.isPending || reason.trim().length < 10} onClick={() => mutation.mutate(null)}>Restaurar valor do RDO</button> : null}
          {message ? <span role="status">{message}</span> : null}
        </div>
      </form> : null}
    </div>
  </details>;
}
