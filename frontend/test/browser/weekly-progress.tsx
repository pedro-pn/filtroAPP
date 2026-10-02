// Fixture de navegador com React/Query reais e armazenamento de API simulado.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { apiClient } from '../../src/api/client';
import { MissionWeeklyProgressPanel } from '../../src/components/projects/MissionWeeklyProgressPanel';
import { MissionWeeklyProgressSummaryCard } from '../../src/components/projects/MissionWeeklyProgressSummaryCard';
import { Card } from '../../src/components/ui/ds';
import { AppIcon } from '../../src/components/icons/AppIcon';
import { CalendarClock, ClipboardList, Gauge, UsersRound } from 'lucide-react';
import '../../src/components/projects/ProjectDetailOverview.css';
import { corporateToday, weekStartKey, type WeeklyProgressTarget } from '../../../shared/modules/mission-weekly-progress.js';
import '../../src/styles/variables.css';
import '../../src/styles/base.css';

const week = weekStartKey(corporateToday())!;
const shift = (days: number) => new Date(new Date(`${week}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const history = [{ date: shift(-7), progressPct: 30 }, { date: week, progressPct: 40 }];
const weekdayParts = (new URLSearchParams(window.location.search).get('workdayHours') ?? '08:00').split(':').map(Number);
const defaultReferenceDayHours = weekdayParts[0] + weekdayParts[1] / 60;
const serviceHistory = [
  { date: week, serviceType: 'LIMPEZA_QUIMICA', quantities: { M: 150, L: 0, UN: 3 } },
  { date: week, serviceType: 'TESTE_PRESSAO', quantities: { M: 50, L: 0, UN: 0 } },
  { date: week, serviceType: 'FILTRAGEM', quantities: { M: 0, L: 12000, UN: 0 } }
];
const stored: WeeklyProgressTarget[] = [];
let conflictNext = false;
let serviceMode: 'single' | 'pair' | 'oil' = 'pair';
let productiveMultiplier = 1;
let missingBase = false;
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
apiClient.defaults.adapter = async config => {
  const response = data => ({ config, status: 200, statusText: 'OK', headers: {}, data });
  if (config.method === 'put' || config.method === 'delete') {
    const input = JSON.parse(config.data);
    const latest = stored.filter(target => target.weekStartDate === input.weekStartDate).sort((a, b) => b.revision - a.revision)[0];
    if (conflictNext || input.expectedRevision !== (latest?.revision ?? 0)) {
      conflictNext = false;
      throw new AxiosError('Conflict', 'ERR_BAD_REQUEST', config, undefined, { ...response({ error: 'Esta meta foi alterada por outra pessoa. Confira o histórico atualizado.' }), status: 409 });
    }
    const record = {
      id: `target-${stored.length}`, weekStartDate: input.weekStartDate, plannedPctPoints: input.plannedPctPoints ?? null, definition: config.method === 'delete' ? undefined : input.definition, ...(config.method === 'delete' ? { isDeleted: true } : {}),
      revision: input.expectedRevision + 1, author: { id: 'manager', name: 'Gestora de teste' }, createdAt: new Date().toISOString()
    };
    stored.push(record);
    return response(record);
  }
  const production = serviceMode === 'oil' ? serviceHistory.slice(2) : serviceMode === 'single' ? serviceHistory.slice(0, 1) : serviceHistory.slice(0, 2);
  const productivity = missingBase ? [] : production.map(point => ({ date: point.date, serviceType: point.serviceType, quantities: { M: 0, L: 0, UN: 0 },
    productivePersonMinutes: (point.serviceType === 'FILTRAGEM' ? 10 : serviceMode === 'single' ? 15 : point.serviceType === 'LIMPEZA_QUIMICA' ? 9 : 6) * 480 * productiveMultiplier, productivityIssues: [] }));
  return response({ targets: stored.slice(), defaultReferenceDayHours, progressHistory: history, serviceHistory: [...production, ...productivity] });
};

function Fixture() {
  const [area, setArea] = useState<'acompanhamento' | 'efetivo'>('acompanhamento');
  const [canManage, setCanManage] = useState(true);
  return <main style={{ maxWidth: 920, margin: '20px auto', padding: 12 }}>
    <h1>Metas semanais de avanço</h1>
    <p>Teste isolado · Semana {week}</p>
    <button onClick={() => setArea(area === 'acompanhamento' ? 'efetivo' : 'acompanhamento')}>Trocar área</button>
    <button onClick={() => setCanManage(!canManage)}>Alternar permissão</button>
    <button onClick={() => { conflictNext = true; }}>Simular conflito na próxima gravação</button>
    <button onClick={() => { serviceMode = 'single'; void queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] }); }}>Usar somente limpeza</button>
    <button onClick={() => { serviceMode = 'pair'; void queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] }); }}>Usar limpeza e teste</button>
    <button onClick={() => { serviceMode = 'oil'; void queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] }); }}>Usar filtragem</button>
    <button onClick={() => { productiveMultiplier = 1.5; void queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] }); }}>Atualizar tempo produtivo do RDO</button>
    <button onClick={() => { missingBase = true; void queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] }); }}>Remover base produtiva do RDO</button>
    <p>Área atual: {area}</p>
    <div className="fv-ds acp-overview"><div className="acp-overview-kpis">
      <Card padding="sm" className="acp-overview-kpi"><div className="acp-overview-kpi-icon"><AppIcon icon={Gauge} /></div><span>Ritmo necessário</span><strong>12 m/semana</strong><small>Escopo total</small></Card>
      <MissionWeeklyProgressSummaryCard key={area} owner={area === 'efetivo' ? { area, missionId: 'm1' } : { area, projectId: 'p1' }} progressHistory={area === 'efetivo' ? undefined : history} />
      <Card padding="sm" className="acp-overview-kpi"><div className="acp-overview-kpi-icon"><AppIcon icon={ClipboardList} /></div><span>Último RDO</span><strong>28/09/2026</strong><small>Último lançamento</small></Card>
      <Card padding="sm" className="acp-overview-kpi"><div className="acp-overview-kpi-icon"><AppIcon icon={UsersRound} /></div><span>Equipe</span><strong>5</strong><small>colaboradores</small></Card>
      <Card padding="sm" className="acp-overview-kpi"><div className="acp-overview-kpi-icon"><AppIcon icon={CalendarClock} /></div><span>Previsão pelo ritmo</span><strong>14/10/2026</strong><small>Avanço acumulado</small></Card>
    </div></div>
    <MissionWeeklyProgressPanel key={area} owner={area === 'efetivo' ? { area, missionId: 'm1' } : { area, projectId: 'p1' }} progressHistory={area === 'efetivo' ? undefined : history} canManage={canManage} />
  </main>;
}
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><QueryClientProvider client={queryClient}><Fixture /></QueryClientProvider></React.StrictMode>);
