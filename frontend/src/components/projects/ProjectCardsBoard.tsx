import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getProjectCards, type LastDayStatus, type ProjectCard } from '../../api/acompanhamentoComercial';

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
function pct(value?: number | null) {
  return value === null || value === undefined ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

const STATUS_META: Record<LastDayStatus, { label: string; cls: string }> = {
  TRABALHADO: { label: 'Último dia trabalhado', cls: 'ok' },
  PARADO: { label: 'Parado (standby)', cls: 'warn' },
  SEM_RDO: { label: 'Sem RDO', cls: 'muted' }
};

function Bar({ value }: { value: number | null }) {
  return (
    <div className="acp-prog-bar"><span style={{ width: `${Math.min(Math.max(value ?? 0, 0), 100)}%` }} /></div>
  );
}

function Card({ card }: { card: ProjectCard }) {
  const status = STATUS_META[card.lastDay.status];
  return (
    <div className="acp-pcard">
      <div className="acp-pcard-head">
        <strong>{card.code}</strong>
        <span className="acp-pcard-name">{card.name || '—'}</span>
      </div>
      {card.clientName ? <div className="acp-pcard-client">{card.clientName}</div> : null}

      <div className="acp-pcard-metric">
        <div className="acp-pcard-metric-top">
          <span>Dias trabalhados</span>
          <span className="acp-pcard-metric-val">
            {card.workedDays}/{card.totalDays ?? '—'}{card.daysConsumedPct != null ? ` · ${card.daysConsumedPct}% consumido` : ''}
          </span>
        </div>
        <Bar value={card.daysConsumedPct} />
      </div>

      <div className="acp-pcard-metric">
        <div className="acp-pcard-metric-top">
          <span>Avanço de escopo</span>
          <span className="acp-pcard-metric-val">{pct(card.progressPct)}</span>
        </div>
        <Bar value={card.progressPct} />
      </div>

      <div className="acp-pcard-row">
        <span>Status dia anterior</span>
        <span className={`acp-pcard-status ${status.cls}`}>
          {status.label}{card.lastDay.date ? ` · ${formatDate(card.lastDay.date)}` : ''}
        </span>
      </div>

      <div className="acp-pcard-row">
        <span>Colaboradores em obra</span>
        <span className="acp-pcard-strong">{card.collaboratorsCount}</span>
      </div>

      <div className="acp-pcard-dates">
        <div><span>Início</span><strong>{formatDate(card.startDate)}</strong></div>
        <div><span>Previsão de término</span><strong>{formatDate(card.expectedEndDate)}</strong></div>
      </div>
    </div>
  );
}

// Aba "Projetos": um card por projeto com previsto x realizado (dias, avanço, colaboradores, prazos).
export function ProjectCardsBoard() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['project-cards'], queryFn: () => getProjectCards() });

  const cards = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = data ?? [];
    if (!term) return list;
    return list.filter(c => `${c.code} ${c.name} ${c.clientName}`.toLowerCase().includes(term));
  }, [data, search]);

  if (isLoading) return <div className="page-card placeholder-copy">Carregando projetos…</div>;

  if ((data ?? []).length === 0) {
    return (
      <div className="page-card placeholder-copy">
        Nenhum projeto com proposta comercial importada. Importe o banco do comercial e cadastre a
        missão com o número do contrato.
      </div>
    );
  }

  return (
    <div className="acp-pcards-wrap">
      <div className="page-card acp-filters">
        <div className="field-group">
          <label htmlFor="acp-pcards-search">Buscar</label>
          <input
            id="acp-pcards-search"
            type="search"
            placeholder="Código, missão ou cliente"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="acp-pcards-grid">
        {cards.map(card => <Card key={card.projectId} card={card} />)}
      </div>
    </div>
  );
}
