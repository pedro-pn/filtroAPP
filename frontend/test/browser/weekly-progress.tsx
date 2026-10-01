// Fixture de navegador com React/Query reais e armazenamento de API simulado.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { apiClient } from '../../src/api/client';
import { MissionWeeklyProgressPanel } from '../../src/components/projects/MissionWeeklyProgressPanel';
import { corporateToday, weekStartKey, type WeeklyProgressTarget } from '../../../shared/modules/mission-weekly-progress.js';
import '../../src/styles/variables.css';
import '../../src/styles/base.css';

const week = weekStartKey(corporateToday())!;
const shift = (days: number) => new Date(new Date(`${week}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const history = [{ date: shift(-7), progressPct: 30 }, { date: week, progressPct: 40 }];
const stored: WeeklyProgressTarget[] = [];
let conflictNext = false;
apiClient.defaults.adapter = async config => {
  const response = data => ({ config, status: 200, statusText: 'OK', headers: {}, data });
  if (config.method === 'put') {
    const input = JSON.parse(config.data);
    if (conflictNext) {
      conflictNext = false;
      throw new AxiosError('Conflict', 'ERR_BAD_REQUEST', config, undefined, { ...response({ error: 'Esta meta foi alterada por outra pessoa. Confira o histórico atualizado.' }), status: 409 });
    }
    const record = {
      id: `target-${stored.length}`, weekStartDate: input.weekStartDate, plannedPctPoints: input.plannedPctPoints,
      revision: input.expectedRevision + 1, author: { id: 'manager', name: 'Gestora de teste' }, createdAt: new Date().toISOString()
    };
    stored.push(record);
    return response(record);
  }
  return response({ targets: stored.slice(), progressHistory: history });
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
    <p>Área atual: {area}</p>
    <MissionWeeklyProgressPanel key={area} owner={area === 'efetivo' ? { area, missionId: 'm1' } : { area, projectId: 'p1' }} progressHistory={area === 'efetivo' ? undefined : history} canManage={canManage} />
  </main>;
}
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Fixture /></QueryClientProvider></React.StrictMode>);
