import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import { getNewReportBootstrap } from '../../src/api/bootstrap';
import type { EquipmentCategory, RdoEquipmentSlot } from '../../src/api/equipamentos';
import { ServiceFields } from '../../src/components/reports/ServiceFields';
import { ToastProvider } from '../../src/components/ui/Toast';
import { Button } from '../../src/components/ui/ds';
import { RdoSlotsConfig } from '../../src/pages/equipamentos/RdoSlotsConfig';
import { legacyServiceData } from '../../src/pages/reportDetailServiceData';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { buildReportServicePayload } from '../../src/utils/reportServicePayload';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/legacy.css';
import '../../src/pages/collaborator/NewReportPage.css';
import '../../src/pages/equipamentos/EquipmentConfig.ds.css';

const storageKey = 'rdo-equipment-categories-fixture';
const categories = [
  ['chemical', 'Limpeza química', 'ULQ-01'], ['flushing', 'Flushing', 'FLU-01'],
  ['filtration', 'Filtragem', 'UFG-01'], ['uth', 'Teste hidrostático', 'UTH-01'],
  ['manometer', 'Manômetros', 'MAN-01'], ['manometer-alt', 'Manômetros digitais', 'MAN-02'],
  ['counter', 'Contadores de partículas', 'CP-01'], ['counter-alt', 'Contadores portáteis', 'CP-02'],
  ['dryer', 'Desidratação', 'DES-01'], ['dryer-alt', 'Centrífugas', 'CEN-01'],
  ['unavailable', 'Não liberada neste serviço', 'FORA-01']
].map(([id, name, code]) => ({ id, name, code, systemKey: id, isActive: true })) as Array<EquipmentCategory & { code: string }>;
const equipments = categories.map(category => ({ id: `equipment-${category.id}`, categoryId: category.id,
  code: category.code, name: category.name, isActive: true, serialNumber: '123' }));
const slot = (key: string, fieldLabel: string, primary: string[], secondary: string[] = []): RdoEquipmentSlot => ({
  key, serviceType: key.split('.')[0], fieldLabel, label: `${key.split('.')[0]} · ${fieldLabel}`,
  kind: 'UNITS_MULTI', defaultSystemKey: '', categoryIds: primary, secondaryCategoryIds: secondary
});
const initialSlots = [
  slot('limpeza.ulq', 'Unidade de Limpeza Química', ['chemical', 'flushing']),
  slot('pressao.uth', 'Unidade de Teste Hidrostático (UTH)', ['uth'], ['filtration']),
  slot('pressao.manometros', 'Manômetros', ['manometer'], ['manometer-alt']),
  slot('flushing.primario', 'Unidade de Flushing', ['flushing'], ['chemical']),
  slot('flushing.secundario', 'Unidade de filtragem', ['filtration'], ['chemical']),
  slot('filtragem.ufg', 'Unidade de filtragem', ['filtration'], ['flushing']),
  ...['flushing', 'filtragem'].flatMap(service => [
    slot(`${service}.particulas`, 'Contador utilizado', ['counter'], ['counter-alt']),
    slot(`${service}.desidratacao`, 'Equipamento de desidratação', ['dryer'], ['dryer-alt'])
  ])
];
const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
let slots: RdoEquipmentSlot[] = stored?.slots || initialSlots;
const initialServices = [{ id: 'first', type: 'limpeza', data: {} }, { id: 'second', type: 'limpeza', data: { ulq: ['equipment-chemical'] } }];
const fixture = { failSave: false, calls: [] as unknown[] };
Object.assign(window, { equipmentCategoryFixture: fixture });
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  let data: unknown;
  if (url.endsWith('/rdo-slots')) data = slots;
  else if (url.includes('/rdo-slots/')) {
    const body = JSON.parse(config.data);
    fixture.calls.push(body);
    if (fixture.failSave) throw new Error('Falha simulada ao salvar categorias');
    const key = url.split('/').at(-1);
    slots = slots.map(item => item.key === key ? { ...item, ...body } : item);
    sessionStorage.setItem(storageKey, JSON.stringify({ ...JSON.parse(sessionStorage.getItem(storageKey) || '{}'), slots }));
    data = slots.find(item => item.key === key);
  } else if (url.endsWith('/bootstrap/new-report')) data = {
    projects: [], collaborators: [], units: [], manometers: [], counters: [], drafts: [], equipments,
    rdoSlotMap: Object.fromEntries(slots.map(item => [item.key, item.categoryIds])),
    rdoSecondarySlotMap: Object.fromEntries(slots.map(item => [item.key, item.secondaryCategoryIds])),
    rdoEquipmentCategories: categories, inhibitionOptions: { vessels: [], systems: [] }
  };
  else throw new Error(`API não simulada: ${url}`);
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};

function Fixture() {
  const [view, setView] = useState('report');
  const [readOnly, setReadOnly] = useState(false);
  const [saved, setSaved] = useState(false);
  const [services, setServices] = useState<Array<{ id: string; type: string; data: Record<string, unknown> }>>(() =>
    stored?.services ? stored.services.map((item: Parameters<typeof legacyServiceData>[0]) => ({ id: item.id,
      type: item.serviceType, data: legacyServiceData(item) })) : initialServices);
  const bootstrap = useQuery({ queryKey: ['bootstrap', 'equipment-fixture'], queryFn: getNewReportBootstrap });
  return <main className="fv-ds equip-page-v2 rdo-form-page" style={{ maxWidth: 1040, margin: 'auto', padding: 20 }}>
    <h1>Equipamentos por serviço</h1>
    <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
      <Button onClick={() => setView('report')}>Relatório</Button>
      <Button onClick={() => setView('config')}>Configuração</Button>
    </nav>
    {view === 'config' ? <RdoSlotsConfig categories={categories} /> : <>
      <label><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} /> Somente leitura</label>
      {services.map((service, index) => <section key={service.id} aria-label={`Serviço ${index + 1}`} className="fv-card" style={{ padding: 16, margin: '16px 0' }}>
        <h2>Serviço {index + 1}</h2>
        <select aria-label={`Tipo do serviço ${index + 1}`} value={service.type} disabled={readOnly}
          onChange={event => setServices(current => current.map(item => item.id === service.id ? { ...item, type: event.target.value, data: {} } : item))}>
          <option value="limpeza">Limpeza química</option><option value="pressao">Teste de pressão</option>
          <option value="flushing">Flushing</option><option value="filtragem">Filtragem</option>
        </select>
        <ServiceFields serviceType={service.type} data={service.data} groupKey={service.id} units={[]} manometers={[]} counters={[]}
          equipments={bootstrap.data?.equipments} rdoSlotMap={bootstrap.data?.rdoSlotMap}
          rdoSecondarySlotMap={bootstrap.data?.rdoSecondarySlotMap} rdoEquipmentCategories={bootstrap.data?.rdoEquipmentCategories}
          hideUploads hideNotes appearance="design-system" disabled={readOnly}
          onChange={patch => { setSaved(false); setServices(current => current.map(item => item.id === service.id ? { ...item, data: { ...item.data, ...patch } } : item)); }} />
      </section>)}
      <Button disabled={readOnly} onClick={() => {
        const payload = services.map(service => ({ id: service.id, ...buildReportServicePayload(service) }));
        sessionStorage.setItem(storageKey, JSON.stringify({ slots, services: payload }));
        setSaved(true);
      }}>Salvar relatório</Button>
      {saved ? <p role="status">Relatório salvo</p> : null}
    </>}
  </main>;
}
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ThemeProvider><ToastProvider><Fixture /></ToastProvider></ThemeProvider></QueryClientProvider>);
