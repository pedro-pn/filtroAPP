// Componentes de produção com transporte simulado; nenhum dado real é alterado.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { apiClient } from '../../src/api/client';
import { ProjectScheduleEditor, type ScheduleEditorHandle } from '../../src/components/projects/ProjectScheduleEditor';
import { ToastContext } from '../../src/components/ui/ToastContext';
import { detail } from '../fixtures/project-detail.mjs';
import '../../src/styles/variables.css';
import '../../src/styles/base.css';

const storageKey = 'worked-days-progress-fixture';
const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '{"progressModel":"QUANTITIES","plannedCollaborators":null}');
const readonly = new URLSearchParams(location.search).has('readonly');
const revision = { codBd: 7, nRev: 1, workedDays: 10, plannedDays: 12 };
apiClient.defaults.adapter = async config => {
  const response = data => ({ config, status: 200, statusText: 'OK', headers: {}, data });
  if (config.method === 'patch' && config.url?.endsWith('/cronograma')) {
    if (readonly) throw new Error('Consulta tentou salvar.');
    Object.assign(saved, JSON.parse(config.data));
    sessionStorage.setItem(storageKey, JSON.stringify(saved));
    return response({ ok: true });
  }
  if (config.url?.endsWith('/revisoes')) return response({ ...saved, currentCodBd: 7, revisions: [revision] });
  if (config.url?.endsWith('/detalhe')) return response({ ...detail, fullWorkedDays: 10, fullPlannedDays: 12 });
  if (config.url?.endsWith('/escopo-previsto')) return response({ services: [], normalHours: [], overtime: [] });
  if (config.url?.endsWith('/escopos-propostas')) return response({ options: [], pending: [], warnings: [] });
  if (config.url?.endsWith('/avanco')) {
    const enabled = saved.progressModel === 'WORKED_DAYS';
    const planned = 10 * saved.plannedCollaborators;
    const pct = enabled ? 2 / planned * 100 : null;
    return response({ hasScope: enabled, progressPct: pct, progressMethod: enabled ? 'WORKED_DAYS' : null,
      workedDays: enabled ? { plannedDays: 10, plannedCollaborators: saved.plannedCollaborators,
        plannedPersonDays: planned, realizedPersonDays: 2, equivalentWorkedDays: 2 / saved.plannedCollaborators, rdoCount: 1 } : undefined,
      services: enabled ? [{ serviceType: 'DIAS_TRABALHADOS', weight: 100, executionPct: pct, systems: [{
        systemType: 'DIAS_TRABALHADOS', unit: 'PESSOA_DIA', plannedQty: planned, realizedQty: 2, pct
      }] }] : [] });
  }
  return response([]);
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const scheduleRef = useRef<ScheduleEditorHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  return <ToastContext.Provider value={{ showToast: setMessage }}><MemoryRouter>
    <main className="fv-ds" style={{ maxWidth: 850, margin: '24px auto', padding: 16 }}>
      <h1>Cronograma do projeto</h1>
      <button disabled={readonly || !dirty} onClick={() => scheduleRef.current?.save()}>Salvar cronograma</button>
      <p role="status">{message || (dirty ? 'Alterações pendentes' : 'Sem alterações')}</p>
      <ProjectScheduleEditor ref={scheduleRef} projectId="worked-days-fixture" canManage={!readonly} onDirtyChange={setDirty} />
    </main>
  </MemoryRouter></ToastContext.Provider>;
}
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
