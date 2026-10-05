import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getPontoColaboradores, type CollaboratorRate, type IdleBucket } from '../../api/acompanhamentoPonto';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';
import { brl } from './costFields';
import { Card, DataTable, EmptyState, Field, Select, Skeleton } from '../ui/ds';

const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
function fmtMonth(month: string): string {
  const [y, m] = month.split('-');
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MESES_PT[idx]}/${y}` : month;
}
function fmtHoras(value: number) {
  return `${value.toFixed(0)}h`;
}

interface RateView {
  normalHoras: number;
  he70Horas: number;
  he100Horas: number;
  totalMensal: number | null;
  custoHora: number | null;
  idle: { sede: IdleBucket; folga: IdleBucket };
  hasCostProfile: boolean;
}

// Dados do colaborador para o mês selecionado (ou o somado, se 'todos'). null = sem dados no mês.
function viewFor(r: CollaboratorRate, month: string): RateView | null {
  if (month === 'todos') {
    return { normalHoras: r.normalHoras, he70Horas: r.he70Horas, he100Horas: r.he100Horas, totalMensal: r.totalMensal, custoHora: r.custoHora, idle: r.idle, hasCostProfile: r.hasCostProfile };
  }
  const m = r.months.find(x => x.month === month);
  if (!m) return null;
  return { normalHoras: m.normalHoras, he70Horas: m.he70Horas, he100Horas: m.he100Horas, totalMensal: m.totalMensal, custoHora: m.custoHora, idle: m.idle, hasCostProfile: true };
}

export function LaborRateTable() {
  const { data, isLoading } = useQuery({
    queryKey: ['ponto-colaboradores'],
    queryFn: getPontoColaboradores,
    ...acompanhamentoRefreshQueryOptions
  });
  const [month, setMonth] = useState('todos');

  const rates = useMemo(() => [...(data?.rates ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [data]);
  const months = useMemo(() => [...new Set(rates.flatMap(r => r.months.map(m => m.month)))].sort(), [rates]);

  if (isLoading) return <Card className="acp-cost-ds__panel"><Skeleton height={180} /></Card>;
  if (!data?.importId) {
    return <Card className="acp-cost-ds__panel"><EmptyState title="Nenhum ponto importado" description="Envie a planilha na aba Ponto." /></Card>;
  }

  const rows = rates.map(r => ({ r, view: viewFor(r, month) })).filter(x => x.view !== null) as Array<{ r: CollaboratorRate; view: RateView }>;
  const idleTotal = rows.reduce((sum, { view }) => sum + view.idle.sede.cost + view.idle.folga.cost, 0);
  const custoCell = (bucket: IdleBucket | undefined) =>
    bucket ? `${brl(bucket.cost)}${bucket.hours ? ` · ${fmtHoras(bucket.hours)}` : ''}` : '—';

  return (
    <Card className="acp-cost-ds__panel" title="Custo por colaborador">
      <p className="acp-cost-ds__copy">
        Período do ponto vigente: <strong>{fmtDate(data.periodStart)} – {fmtDate(data.periodEnd)}</strong>.
        A folha é calculada <strong>por mês</strong> (o salário mensal sai 1× por mês; mês parcial tem o
        fixo proporcional aos dias cobertos). Use o filtro para ver um mês específico ou o total.
        <strong> Custo/hora = folha ÷ (horas do ponto + folga)</strong>. A sobra é quebrada em
        <strong> Sede</strong> (ponto batido, sem obra) e <strong>Folga</strong> (dia de semana sem ponto).
      </p>

      <Field className="acp-cost-ds__month" label="Mês" optionalText="">
        <Select value={month} onChange={e => setMonth(e.target.value)}>
          <option value="todos">Todos (somado)</option>
          {months.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
        </Select>
      </Field>

      <DataTable
        ariaLabel="Custo por colaborador"
        mobileBreakpoint="lg"
        rows={rows}
        getRowId={({ r }) => r.collaboratorId}
        columns={[
          { key: 'name', header: 'Colaborador', render: ({ r }) => r.name },
          { key: 'role', header: 'Cargo', render: ({ r }) => r.role ?? '—' },
          { key: 'normal', sortValue: ({ view }) => view.normalHoras, header: 'Normais', render: ({ view }) => fmtHoras(view.normalHoras) },
          { key: 'he70', sortValue: ({ view }) => view.he70Horas, header: 'HE 70%', render: ({ view }) => fmtHoras(view.he70Horas) },
          { key: 'he100', sortValue: ({ view }) => view.he100Horas, header: 'HE 100%', render: ({ view }) => fmtHoras(view.he100Horas) },
          { key: 'monthly', sortValue: ({ view }) => view.hasCostProfile ? view.totalMensal : null, header: 'Custo mensal', render: ({ view }) => view.hasCostProfile ? brl(view.totalMensal) : 'cargo sem custo' },
          { key: 'sede', sortValue: ({ view }) => view.hasCostProfile ? view.idle.sede.cost : null, header: 'Sede', render: ({ view }) => view.hasCostProfile ? custoCell(view.idle.sede) : '—' },
          { key: 'folga', sortValue: ({ view }) => view.hasCostProfile ? view.idle.folga.cost : null, header: 'Folga', render: ({ view }) => view.hasCostProfile ? custoCell(view.idle.folga) : '—' },
          { key: 'hourly', sortValue: ({ view }) => view.hasCostProfile ? view.custoHora : null, header: 'Custo/hora', render: ({ view }) => view.hasCostProfile ? <strong>{brl(view.custoHora)}</strong> : '—' }
        ]}
        mobile={{ renderItem: ({ r, view }) => ({
          title: r.name,
          subtitle: r.role ?? 'Sem cargo',
          value: view.hasCostProfile ? brl(view.custoHora) : 'Cargo sem custo',
          metadata: [
            { label: 'Horas normais', value: fmtHoras(view.normalHoras) },
            { label: 'HE 70% / 100%', value: `${fmtHoras(view.he70Horas)} / ${fmtHoras(view.he100Horas)}` },
            { label: 'Custo mensal', value: view.hasCostProfile ? brl(view.totalMensal) : '—' },
            { label: 'Sede / Folga', value: view.hasCostProfile ? `${custoCell(view.idle.sede)} / ${custoCell(view.idle.folga)}` : '—' }
          ]
        }) }}
      />
      {idleTotal > 0 ? (
        <p className="acp-cost-ds__copy">
          Ociosidade {month === 'todos' ? 'total no período' : `em ${fmtMonth(month)}`}: <strong>{brl(idleTotal)}</strong> (tempo pago não alocado a obras).
        </p>
      ) : null}
    </Card>
  );
}
