import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getProjectProgress, type ProgressSystem } from '../../api/acompanhamentoComercial';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';

const SERVICE_LABELS: Record<string, string> = {
  LIMPEZA_QUIMICA: 'Limpeza química',
  TESTE_PRESSAO: 'Teste de pressão',
  FLUSHING: 'Flushing',
  FILTRAGEM: 'Filtragem'
};
const SYSTEM_LABELS: Record<string, string> = { TUBULACAO: 'Tubulações', OLEO: 'Óleo', SISTEMA: 'Sistemas completos' };
const UNIT_LABELS: Record<string, string> = { M: 'm', KG: 'kg', T: 't', UN: 'un', L: 'L' };

const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const fmtQty = (v: number | null, unit: string | null) =>
  v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${unit ? ` ${UNIT_LABELS[unit] ?? ''}` : ''}`;

function systemLine(sys: ProgressSystem) {
  const identity = sys.projectSystemId ? `${sys.equipment} · ${sys.systemName} · ` : '';
  const diameter = sys.diameter ? ` (${sys.diameter} ${sys.diameterUnit || 'pol'})` : '';
  return `${identity}${SYSTEM_LABELS[sys.systemType] ?? sys.systemType}${diameter}: ${fmtQty(sys.realizedQty, sys.unit)} / ${fmtQty(sys.plannedQty, sys.unit)} · ${fmtPct(sys.pct)}`;
}

// Avanço físico do projeto (RDO ponderado por serviço) — realizado dos RDOs × escopo previsto.
export function ProjectProgressBreakdown({ projectId }: { projectId: string }) {
  const [equipment, setEquipment] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['project-progress', projectId],
    queryFn: () => getProjectProgress(projectId),
    ...acompanhamentoRefreshQueryOptions
  });

  if (isLoading) return <div className="placeholder-copy">Calculando avanço…</div>;
  if (!data || !data.hasScope) {
    return <div className="placeholder-copy">Cadastre o escopo previsto (com metas) para calcular o avanço.</div>;
  }

  return (
    <div className="acp-progress">
      {data.services.some(service => service.systems.some(system => system.projectSystemId)) ? <div className="field-group">
        <label>Filtrar equipamento / UG</label>
        <select aria-label="Filtrar equipamento / UG" value={equipment} onChange={event => setEquipment(event.target.value)}>
          <option value="">Todas as UGs / equipamentos</option>
          {[...new Set(data.services.flatMap(service => service.systems.map(system => system.equipment)).filter(Boolean))].map(value => <option key={value} value={value!}>{value}</option>)}
        </select>
        <small>O percentual geral mantém todo o escopo; o filtro altera apenas as linhas exibidas.</small>
      </div> : null}
      <div className="acp-progress-total">
        <div className="acp-prog-bar big"><span style={{ width: `${Math.min(data.progressPct ?? 0, 100)}%` }} /></div>
        <strong>{fmtPct(data.progressPct)}</strong>
      </div>
      <div className="acp-progress-list">
        {data.services.map((svc, i) => (
          <div className="acp-progress-svc" key={i}>
            <div className="acp-progress-svc-head">
              <span>{SERVICE_LABELS[svc.serviceType] ?? svc.serviceType}</span>
              <span className="acp-progress-meta">peso {svc.weight.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% · {fmtPct(svc.executionPct)}</span>
            </div>
            <ul className="acp-progress-sys">
              {svc.systems.filter(sys => !equipment || sys.equipment === equipment).map((sys, j) => <li key={j}>{systemLine(sys)}</li>)}
            </ul>
          </div>
        ))}
      </div>
      {data.pendingMeasurements?.length ? <details className="acp-progress-svc" open>
        <summary>Medições sem correspondência no escopo ({data.pendingMeasurements!.length})</summary>
        <p>Não entram nas metas por sistema até a conferência de UG, nome e bitola. Associe nomes no cronograma ou medições em Serviços históricos.</p>
        <ul>{data.pendingMeasurements!.map((item, index) => <li key={index}>
          {item.equipment} · {item.system} · {SERVICE_LABELS[item.serviceType] || item.serviceType}{item.diameter ? ` · ${item.diameter} ${item.diameterUnit || 'pol'}` : ''}: {fmtQty(item.quantity, item.unit)}
        </li>)}</ul>
      </details> : null}
      <p className="placeholder-copy" style={{ marginTop: 6, fontSize: 11 }}>
        Realizado = serviços finalizados e quantitativos históricos, sem duplicar relatórios derivados.
        Metas por sistema consideram equipamento/UG, sistema e bitola. Em cada tipo de medição, a execução
        é proporcional à quantidade prevista, limitada à meta de cada linha; os serviços usam seus pesos.
      </p>
    </div>
  );
}
