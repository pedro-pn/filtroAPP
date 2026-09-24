import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

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
  const queryKey = ['realized-corrections', projectId];
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: () => listRealizedCorrections(projectId), ...acompanhamentoRefreshQueryOptions });
  const [date, setDate] = useState('');
  const [serviceType, setServiceType] = useState<TubeCorrectionService>('TESTE_PRESSAO');
  const [meters, setMeters] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [message, setMessage] = useState('');

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
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    const value = parseMeters(meters);
    if (value === null) return setMessage('Informe uma metragem válida com até duas casas decimais.');
    if (reason.trim().length < 10) return setMessage('Informe o motivo da correção (ao menos 10 caracteres).');
    mutation.mutate(value);
  }

  return <details className="acp-progress-svc" style={{ marginTop: 12 }}>
    <summary>Conciliação de metragens do realizado</summary>
    <p>O valor validado substitui, nesta data e neste serviço, os metros dos RDOs no Acompanhamento e no Efetivo. Os relatórios originais permanecem disponíveis. Esta correção exige meta global de tubulação.</p>
    {isLoading ? <p>Carregando metragens…</p> : error ? <p role="alert">Não foi possível carregar as correções.</p> : null}
    {data?.rows.length ? <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Dia</th><th>Serviço</th><th>RDO</th><th>Validado</th><th>Diferença</th><th>Motivo / histórico</th>{canManage ? <th>Ação</th> : null}</tr></thead>
        <tbody>{[...data.rows].reverse().map(row => <tr key={`${row.date}:${row.serviceType}`}>
          <td>{dateLabel(row.date)}</td><td>{LABELS[row.serviceType]}</td><td>{quantity(row.sourceMeters)}</td>
          <td>{row.correctedMeters === null ? '—' : quantity(row.correctedMeters)}</td>
          <td>{row.correctedMeters === null ? '—' : quantity(row.effectiveMeters - row.sourceMeters)}</td>
          <td>{row.sourceChanged ? <strong>O RDO mudou após a correção. Confira novamente. </strong> : null}{row.reason || 'Sem correção'}{row.history.length ? <details><summary>{row.history.length} revisão(ões)</summary>
            <ol>{row.history.map(item => <li key={item.revision}>Rev. {item.revision} · {item.quantityM === null ? 'RDO restaurado' : quantity(item.quantityM)} · {item.reason}{item.reference ? ` · ${item.reference}` : ''}</li>)}</ol>
          </details> : null}</td>
          {canManage ? <td><button type="button" className="mini-btn" onClick={() => selectRow(row)}>Conferir</button></td> : null}
        </tr>)}</tbody>
      </table>
    </div> : null}
    {canManage ? <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 12 }}>
      <label>Dia<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>Serviço<select value={serviceType} onChange={event => setServiceType(event.target.value as TubeCorrectionService)}>
        {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Metragem validada (m)<input type="text" inputMode="decimal" required value={meters} onChange={event => setMeters(event.target.value)} placeholder="Ex.: 280,00" /></label>
      <label style={{ gridColumn: '1 / -1' }}>Motivo<input type="text" required minLength={10} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Ex.: conferência com o responsável da obra" /></label>
      <label style={{ gridColumn: '1 / -1' }}>Referência (opcional)<input type="text" maxLength={500} value={reference} onChange={event => setReference(event.target.value)} placeholder="Planilha, ata ou link de conferência" /></label>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="submit" className="mini-btn" disabled={mutation.isPending}>Salvar metragem validada</button>
        {selected?.correctedMeters !== null && selected?.correctedMeters !== undefined ? <button type="button" className="mini-btn" disabled={mutation.isPending || reason.trim().length < 10} onClick={() => mutation.mutate(null)}>Restaurar valor do RDO</button> : null}
        {message ? <span role="status">{message}</span> : null}
      </div>
    </form> : null}
  </details>;
}
