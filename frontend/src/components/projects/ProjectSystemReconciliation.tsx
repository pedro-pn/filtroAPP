import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { ApiClientError } from '../../api/client';
import { getSystemReconciliation, saveMeasurementSystems, type MeasurementSelection, type ReconciledMeasurement, type ReconciledReport } from '../../api/systemReconciliation';
import { listProjectSystems, type ProjectSystem } from '../../api/projectSystems';
import { matchesSearch } from '../../utils/search';
import { ProjectProgressBreakdown } from './ProjectProgressBreakdown';
import './system-reconciliation.css';

const labels: Record<string, string> = { limpeza: 'Limpeza química', pressao: 'Teste de pressão', filtragem: 'Filtragem', flushing: 'Flushing' };
const reportTitle = (report: ReconciledReport) => `${report.reportType} ${report.sequenceNumber == null ? 'sem número' : String(report.sequenceNumber).padStart(3, '0')}`;
const compatible = (item: ReconciledMeasurement) => ['MATCHED', 'GLOBAL_SCOPE'].includes(item.reconciliation.status);

const selection = (report: ReconciledReport, item: ReconciledMeasurement): MeasurementSelection => ({ source: report.source, reportId: report.id, measurementKey: item.measurementKey, revision: report.revision });
const rowKey = (report: ReconciledReport, item: ReconciledMeasurement) => `${report.source}:${report.id}:${item.measurementKey}`;

function MeasurementLink({ item, systems, disabled, saving, onSave }: {
  item: ReconciledMeasurement; systems: ProjectSystem[]; disabled: boolean; saving: boolean; onSave: (id: string | null) => void;
}) {
  const previousId = item.projectSystemId || item.reconciliation.matchedSystem?.id || '';
  const [selected, setSelected] = useState(previousId || item.reconciliation.suggestedSystemId || '');
  const candidates = systems.filter(system => item.reconciliation.compatibleSystemIds.includes(system.id));
  const previous = systems.find(system => system.id === previousId);
  const previousOutsideScope = Boolean(previousId && !candidates.some(system => system.id === previousId));
  return <div className="reconciliation-link">
    <label>
      <span>Sistema desta medição</span>
      <select value={selected} disabled={disabled} onChange={event => setSelected(event.target.value)}>
        <option value="">Manter identificação original</option>
        {previousOutsideScope ? <option value={previousId} disabled>
          {previous ? `${previous.equipment} · ${previous.name}` : 'Destino antigo indisponível'} — vínculo salvo sem meta compatível
        </option> : null}
        {candidates.map(system => <option key={system.id} value={system.id}>{system.equipment} · {system.name}</option>)}
      </select>
    </label>
    <button type="button" className="mini-btn" disabled={disabled || selected === (item.projectSystemId || '') || Boolean(selected && !candidates.some(system => system.id === selected))}
      onClick={() => onSave(selected || null)}>{saving ? 'Salvando…' : selected ? 'Salvar vínculo' : 'Restaurar identificação original'}</button>
    {!previousId && item.reconciliation.suggestedSystemId ? <small>Destino sugerido pelo nome. Confira antes de salvar.</small> : null}
    {!candidates.length ? <small>{item.reconciliation.status === 'GLOBAL_SCOPE' ? 'A meta global não exige um vínculo individual.' : 'Nenhum destino com meta compatível. Confira o serviço, diâmetro e quantidade prevista no cronograma.'}</small> : null}
    {item.projectSystemId ? <small>Este vínculo vale somente para esta medição. Restaurar a identificação original mantém as associações anteriores.</small> : null}
  </div>;
}

export function ProjectSystemReconciliation({ projectId, canManage, onBack }: {
  projectId: string; canManage: boolean; onBack: () => void;
}) {
  const client = useQueryClient();
  const key = ['system-reconciliation', projectId];
  const query = useQuery({ queryKey: key, queryFn: () => getSystemReconciliation(projectId) });
  const systems = useQuery({ queryKey: ['project-systems', 'scope', projectId], queryFn: () => listProjectSystems(projectId, 'scope') });
  const [source, setSource] = useState('all');
  const [selected, setSelected] = useState<Record<string, MeasurementSelection>>({});
  const [batchTarget, setBatchTarget] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const reports = query.data?.reports ?? [];
  const entries = reports.flatMap(report => report.items.map(item => ({ report, item, key: rowKey(report, item) })));
  const items = entries.map(entry => entry.item);
  const chosen = entries.filter(entry => selected[entry.key]);
  const selectionChanged = chosen.length !== Object.keys(selected).length || chosen.some(entry => selected[entry.key].revision !== entry.report.revision);
  const batchCandidates = (systems.data ?? []).filter(system => chosen.length && chosen.every(entry => entry.item.reconciliation.compatibleSystemIds.includes(system.id)));
  function clearSelection() { setSelected({}); setBatchTarget(''); }
  const pending = items.filter(item => !compatible(item)).length;
  const linked = items.filter(item => item.projectSystemId).length;

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }, { throwOnError: true }),
      client.invalidateQueries({ queryKey: ['historical-services', projectId] }, { throwOnError: true }),
      client.invalidateQueries({ queryKey: ['project-systems'] }, { throwOnError: true }),
      client.invalidateQueries({ predicate: query => /progress|project-detail|mission-group-detail|project-cards|commercial-dashboard|statistics|project-stats/.test(String(query.queryKey[0])) }, { throwOnError: true })
    ]);
  }
  async function save(measurements: MeasurementSelection[], id: string | null) {
    if (saving.current) return;
    saving.current = true;
    setBusy('save'); setError(''); setFeedback('');
    try {
      const result = await saveMeasurementSystems(projectId, measurements, id);
      setFeedback(`${result.saved} medição(ões) atualizada(s). ${id ? 'Vínculo salvo somente nas linhas selecionadas.' : 'Identificação original restaurada.'}`);
      clearSelection();
      try { await refresh(); setNeedsRefresh(false); }
      catch { setNeedsRefresh(true); setError('Os vínculos foram salvos, mas a atualização da tela falhou. Atualize a lista antes de continuar.'); }
    } catch (cause) {
      setError((axios.isAxiosError<{ error?: string }>(cause) ? cause.response?.data?.error : null) || (cause instanceof Error ? cause.message : 'Não foi possível salvar o vínculo.'));
      const status = cause instanceof ApiClientError ? cause.status : axios.isAxiosError(cause) ? cause.response?.status : undefined;
      if (status === 409) {
        clearSelection();
        setNeedsRefresh(true);
        try { await refresh(); setNeedsRefresh(false); } catch { /* Mantém a revisão bloqueada até atualizar. */ }
      }
    } finally { setBusy(null); saving.current = false; }
  }
  async function retry() {
    if (saving.current) return;
    saving.current = true; setBusy('refresh'); setError('');
    try { await refresh(); setNeedsRefresh(false); clearSelection(); }
    catch { setNeedsRefresh(true); setError('Não foi possível atualizar a lista. Tente novamente.'); }
    finally { setBusy(null); saving.current = false; }
  }
  const unavailable = query.isError || systems.isError || needsRefresh;
  const visible = reports.filter(report => source === 'all' || report.source === source).map(report => ({ report, items: report.items.filter(item =>
    (filter === 'all' || (filter === 'pending' ? !compatible(item) : Boolean(item.projectSystemId)))
    && matchesSearch([reportTitle(report), item.equipment, item.system, item.diameter, labels[item.serviceType], item.reconciliation.matchedSystem?.equipment, item.reconciliation.matchedSystem?.name], search)
  ) })).filter(entry => entry.items.length || entry.report.unappliedLinks);
  const selectable = visible.flatMap(({ report, items }) => items.filter(item => item.reconciliation.compatibleSystemIds.length).map(item => ({ report, item, key: rowKey(report, item) }))).slice(0, 200);
  const allSelected = selectable.length > 0 && selectable.every(entry => selected[entry.key]);

  return <div className="acp-det">
    <div className="acp-det-bar">
      <button type="button" className="mini-btn alt" disabled={Boolean(busy)} onClick={onBack}>← Voltar</button>
    </div>
    <div className="page-card reconciliation-page">
    <div className="reconciliation-heading">
      <div><h2>Conciliação de sistemas</h2><p>{query.data ? `Missão ${query.data.project.code} · ${query.data.project.name}` : 'Carregando missão…'}</p></div>
    </div>
    <p>Vincule cada medição ao escopo salvo, individualmente ou selecionando várias linhas. A lista reúne históricos importados e serviços finalizados dos relatórios cadastrados no app.</p>
    <p>As identificações anteriores continuam válidas. Novos vínculos afetam somente as linhas selecionadas e preservam os nomes, quantidades e PDFs originais.</p>
    <p>Se uma quantidade reúne vários sistemas, confira a divisão nos documentos e edite as linhas do relatório antes de vincular.</p>
    {!canManage ? <p>Consulta disponível. As alterações são feitas pelo gestor de Acompanhamento.</p> : null}
    <div className="reconciliation-summary"><span>{items.length} medições</span><span>{linked} vínculos individuais</span><span>{pending} sem meta compatível</span></div>
    <p role="status" aria-live="polite">{busy ? 'Salvando e atualizando a conciliação…' : feedback}</p>
    {error || unavailable ? <div role="alert"><p>{error || 'Não foi possível carregar a conciliação.'}</p><button type="button" className="mini-btn alt" disabled={Boolean(busy)} onClick={() => void retry()}>Atualizar lista</button></div> : null}

      <div className="reconciliation-filters">
        <label>Origem<select value={source} disabled={Boolean(busy)} onChange={event => { setSource(event.target.value); clearSelection(); }}><option value="all">Todas as origens</option><option value="HISTORICAL">Históricos importados</option><option value="REPORT">Relatórios do app</option></select></label>
        <label>Buscar<input value={search} disabled={Boolean(busy)} onChange={event => { setSearch(event.target.value); clearSelection(); }} placeholder="Relatório, equipamento, sistema ou diâmetro" /></label>
        <label>Mostrar<select value={filter} disabled={Boolean(busy)} onChange={event => { setFilter(event.target.value); clearSelection(); }}><option value="all">Todas as medições</option><option value="pending">Sem meta compatível</option><option value="linked">Vínculos individuais salvos</option></select></label>
      </div>
      {canManage ? <div className="reconciliation-batch">
        <label className="reconciliation-check"><input type="checkbox" checked={allSelected} disabled={Boolean(busy) || unavailable || !selectable.length}
          onChange={event => { setSelected(event.target.checked ? Object.fromEntries(selectable.map(entry => [entry.key, selection(entry.report, entry.item)])) : {}); setBatchTarget(''); }} />Selecionar até 200 medições exibidas com meta compatível</label>
        {Object.keys(selected).length ? <>
          <strong>{Object.keys(selected).length} selecionada(s)</strong>
          <label>Destino das selecionadas<select aria-label="Destino das selecionadas" disabled={Boolean(busy) || unavailable || selectionChanged} value={batchCandidates.some(system => system.id === batchTarget) ? batchTarget : ''} onChange={event => setBatchTarget(event.target.value)}>
            <option value="">Selecione um sistema compatível com todas</option>
            {batchCandidates.map(system => <option key={system.id} value={system.id}>{system.equipment} · {system.name}</option>)}
          </select></label>
          {selectionChanged ? <p role="alert">A lista mudou. Limpe a seleção e confira as medições novamente.</p> : !batchCandidates.length ? <p>Nenhum destino é compatível com todas as linhas. Revise a seleção e as metas do cronograma.</p> : null}
          <button type="button" className="mini-btn" disabled={Boolean(busy) || unavailable || selectionChanged || !batchCandidates.some(system => system.id === batchTarget)} onClick={() => void save(Object.values(selected), batchTarget)}>Aplicar às selecionadas</button>
          <button type="button" className="mini-btn alt" disabled={Boolean(busy)} onClick={clearSelection}>Limpar seleção</button>
        </> : null}
      </div> : null}
      {query.isLoading || systems.isLoading ? <p>Carregando medições…</p> : !visible.length && !unavailable ? <p>{items.length ? 'Nenhuma medição corresponde aos filtros.' : 'Nenhum quantitativo histórico ou serviço finalizado nesta missão.'}</p> : null}
      {visible.map(({ report, items }) => <section className="reconciliation-report" key={`${report.source}:${report.id}`}>
        <h3>{reportTitle(report)} <small>· {report.reportDate.slice(0, 10).split('-').reverse().join('/')} · {report.source === 'REPORT' ? 'Relatório do app' : 'Histórico importado'}</small></h3>
        {report.unappliedLinks ? <p role="alert">{report.unappliedLinks} vínculo(s) anterior(es) não corresponde(m) mais aos quantitativos deste relatório. Confira as medições após a edição do documento.</p> : null}
        {items.map(item => <article className="reconciliation-measurement" key={`${rowKey(report, item)}:${report.revision}`}>
          <div>
            {canManage ? <label className="reconciliation-check"><input type="checkbox" aria-label={`Selecionar ${reportTitle(report)} · ${item.equipment} · ${item.system} · linha ${item.itemIndex + 1}`} checked={Boolean(selected[rowKey(report, item)])}
              disabled={Boolean(busy) || unavailable || !item.reconciliation.compatibleSystemIds.length || (!selected[rowKey(report, item)] && Object.keys(selected).length >= 200)}
              onChange={event => { const checked = event.target.checked; setSelected(previous => { const next = { ...previous }; if (checked) next[rowKey(report, item)] = selection(report, item); else delete next[rowKey(report, item)]; return next; }); setBatchTarget(''); }} />Selecionar medição</label> : null}
            <strong>{item.equipment} · {item.system}</strong>
            <p>{labels[item.serviceType]}{item.diameter ? ` · ${item.diameter} ${item.diameterUnit || 'pol'}` : ''} · {item.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} {item.unit}</p>
            <span className={`reconciliation-state ${compatible(item) ? 'compatible' : 'pending'}`}>{item.reconciliation.message}</span>
            <p>Destino: {item.reconciliation.matchedSystem ? `${item.reconciliation.matchedSystem.equipment} · ${item.reconciliation.matchedSystem.name}` : 'Pendente de identificação'}{item.projectSystemId ? ' · vínculo desta medição' : item.reconciliation.matchedSystem ? ' · identificação anterior' : ''}</p>
          </div>
          {canManage ? <MeasurementLink item={item} systems={systems.data ?? []} disabled={Boolean(busy) || unavailable || (item.reconciliation.status === 'SOURCE_CONFLICT' && !item.projectSystemId)} saving={busy === 'save'}
            onSave={id => void save([selection(report, item)], id)} /> : null}
        </article>)}
      </section>)}
    <details className="reconciliation-progress"><summary>Conferir avanço do escopo</summary><ProjectProgressBreakdown projectId={projectId} /></details>
    </div>
  </div>;
}
