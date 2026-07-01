import { useQuery } from '@tanstack/react-query';

import { getProjectProgress, type ProgressSystem } from '../../api/acompanhamentoComercial';

const SERVICE_LABELS: Record<string, string> = {
  LIMPEZA_QUIMICA: 'Limpeza química',
  TESTE_PRESSAO: 'Teste de pressão',
  FLUSHING: 'Flushing',
  FILTRAGEM: 'Filtragem'
};
const SYSTEM_LABELS: Record<string, string> = { TUBULACAO: 'Tubulações', OLEO: 'Óleo' };
const UNIT_LABELS: Record<string, string> = { M: 'm', KG: 'kg', T: 't', UN: 'un', L: 'L' };

const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const fmtQty = (v: number | null, unit: string | null) =>
  v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${unit ? ` ${UNIT_LABELS[unit] ?? ''}` : ''}`;

function systemLine(sys: ProgressSystem) {
  return `${SYSTEM_LABELS[sys.systemType] ?? sys.systemType}: ${fmtQty(sys.realizedQty, sys.unit)} / ${fmtQty(sys.plannedQty, sys.unit)} · ${fmtPct(sys.pct)}`;
}

// Avanço físico do projeto (RDO ponderado por serviço) — realizado dos RDOs × escopo previsto.
export function ProjectProgressBreakdown({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['project-progress', projectId], queryFn: () => getProjectProgress(projectId) });

  if (isLoading) return <div className="placeholder-copy">Calculando avanço…</div>;
  if (!data || !data.hasScope) {
    return <div className="placeholder-copy">Cadastre o escopo previsto (com metas) para calcular o avanço.</div>;
  }

  return (
    <div className="acp-progress">
      <div className="acp-progress-total">
        <div className="acp-prog-bar big"><span style={{ width: `${Math.min(data.progressPct ?? 0, 100)}%` }} /></div>
        <strong>{fmtPct(data.progressPct)}</strong>
      </div>
      <div className="acp-progress-list">
        {data.services.map((svc, i) => (
          <div className="acp-progress-svc" key={i}>
            <div className="acp-progress-svc-head">
              <span>{SERVICE_LABELS[svc.serviceType] ?? svc.serviceType}</span>
              <span className="acp-progress-meta">peso {svc.weight.toLocaleString('pt-BR')} · {fmtPct(svc.executionPct)}</span>
            </div>
            <ul className="acp-progress-sys">
              {svc.systems.map((sys, j) => <li key={j}>{systemLine(sys)}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <p className="placeholder-copy" style={{ marginTop: 6, fontSize: 11 }}>
        Realizado somado dos RDOs (tubulação por metro, óleo por litro). Avanço = média das execuções por
        serviço, ponderada pelo peso; cada sistema limitado a 100%.
      </p>
    </div>
  );
}
