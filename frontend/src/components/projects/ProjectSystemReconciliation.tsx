import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { ApiClientError } from '../../api/client';
import { getSystemReconciliation, saveMeasurementSystems, type MeasurementSelection, type ReconciledMeasurement, type ReconciledReport } from '../../api/systemReconciliation';
import { listProjectSystems, type ProjectSystem } from '../../api/projectSystems';
import { matchesSearch } from '../../utils/search';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, MetricCard, Select, Skeleton } from '../ui/ds';
import { ProjectProgressBreakdown } from './ProjectProgressBreakdown';
import './ProjectSystemReconciliation.ds.css';

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
  return <div className="acp-reconciliation-ds__link">
    <Field label="Sistema desta medição" optionalText="" disabled={disabled}>
      <Select size="sm" value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">Manter identificação original</option>
        {previousOutsideScope ? <option value={previousId} disabled>
          {previous ? `${previous.equipment} · ${previous.name}` : 'Destino antigo indisponível'} — vínculo salvo sem meta compatível
        </option> : null}
        {candidates.map(system => <option key={system.id} value={system.id}>{system.equipment} · {system.name}</option>)}
      </Select>
    </Field>
    <Button size="sm" variant="primary" loading={saving}
      disabled={disabled || selected === (item.projectSystemId || '') || Boolean(selected && !candidates.some(system => system.id === selected))}
      onClick={() => onSave(selected || null)}>{selected ? 'Salvar vínculo' : 'Restaurar identificação original'}</Button>
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

  return <div className="fv-ds acp-reconciliation-ds">
    <div><Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={onBack}>← Voltar ao projeto</Button></div>
    <header className="acp-reconciliation-ds__heading">
      <h1>Conciliação de sistemas</h1>
      <p>{query.data ? `Missão ${query.data.project.code} · ${query.data.project.name}` : 'Carregando missão…'}</p>
    </header>
    <Card variant="flat" className="acp-reconciliation-ds__intro">
      <p>Vincule cada medição ao escopo salvo, individualmente ou selecionando várias linhas. A lista reúne históricos importados e serviços finalizados dos relatórios cadastrados no app.</p>
      <p>As identificações anteriores continuam válidas. Novos vínculos afetam somente as linhas selecionadas e preservam os nomes, quantidades e PDFs originais.</p>
      <p>Se uma quantidade reúne vários sistemas, confira a divisão nos documentos e edite as linhas do relatório antes de vincular.</p>
    </Card>
    {!canManage ? <Alert tone="info">Consulta disponível. As alterações são feitas pelo gestor de Acompanhamento.</Alert> : null}
    {query.data ? <div className="acp-reconciliation-ds__metrics">
      <MetricCard label="Medições" value={items.length} />
      <MetricCard label="Vínculos individuais" value={linked} />
      <MetricCard label="Sem meta compatível" value={pending} tone={pending ? 'warning' : 'neutral'} />
    </div> : null}
    {busy ? <Alert tone="info" role="status">{busy === 'refresh' ? 'Atualizando a conciliação…' : 'Salvando e atualizando a conciliação…'}</Alert>
      : feedback ? <Alert tone="success" role="status">{feedback}</Alert> : null}
    {error || unavailable ? <Alert tone="danger" title="A conciliação precisa ser atualizada"
      action={<Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void retry()}>Atualizar lista</Button>}>
      {error || 'Não foi possível carregar a conciliação.'}
    </Alert> : null}

    <Card variant="flat" title="Filtrar medições">
      <div className="acp-reconciliation-ds__filters">
        <Field label="Origem" optionalText="" disabled={Boolean(busy)}>
          <Select size="sm" value={source} onChange={event => { setSource(event.target.value); clearSelection(); }}>
            <option value="all">Todas as origens</option><option value="HISTORICAL">Históricos importados</option><option value="REPORT">Relatórios do app</option>
          </Select>
        </Field>
        <Field label="Buscar" optionalText="" disabled={Boolean(busy)}>
          <Input size="sm" value={search} onChange={event => { setSearch(event.target.value); clearSelection(); }} placeholder="Relatório, equipamento, sistema ou diâmetro" />
        </Field>
        <Field label="Mostrar" optionalText="" disabled={Boolean(busy)}>
          <Select size="sm" value={filter} onChange={event => { setFilter(event.target.value); clearSelection(); }}>
            <option value="all">Todas as medições</option><option value="pending">Sem meta compatível</option><option value="linked">Vínculos individuais salvos</option>
          </Select>
        </Field>
      </div>
    </Card>

    {canManage ? <Card variant="flat" title="Vincular várias medições" className="acp-reconciliation-ds__batch">
      <label className="acp-reconciliation-ds__check"><input type="checkbox" checked={allSelected} disabled={Boolean(busy) || unavailable || !selectable.length}
        onChange={event => { setSelected(event.target.checked ? Object.fromEntries(selectable.map(entry => [entry.key, selection(entry.report, entry.item)])) : {}); setBatchTarget(''); }} />Selecionar até 200 medições exibidas com meta compatível</label>
      {Object.keys(selected).length ? <div className="acp-reconciliation-ds__batch-fields">
        <Badge tone="brand">{Object.keys(selected).length} selecionada(s)</Badge>
        <Field label="Destino das selecionadas" optionalText="" disabled={Boolean(busy) || unavailable || selectionChanged}>
          <Select size="sm" value={batchCandidates.some(system => system.id === batchTarget) ? batchTarget : ''} onChange={event => setBatchTarget(event.target.value)}>
            <option value="">Selecione um sistema compatível com todas</option>
            {batchCandidates.map(system => <option key={system.id} value={system.id}>{system.equipment} · {system.name}</option>)}
          </Select>
        </Field>
        {selectionChanged ? <Alert tone="warning">A lista mudou. Limpe a seleção e confira as medições novamente.</Alert>
          : !batchCandidates.length ? <Alert tone="info">Nenhum destino é compatível com todas as linhas. Revise a seleção e as metas do cronograma.</Alert> : null}
        <div className="acp-reconciliation-ds__actions">
          <Button size="sm" variant="primary" disabled={Boolean(busy) || unavailable || selectionChanged || !batchCandidates.some(system => system.id === batchTarget)}
            onClick={() => void save(Object.values(selected), batchTarget)}>Aplicar às selecionadas</Button>
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={clearSelection}>Limpar seleção</Button>
        </div>
      </div> : null}
    </Card> : null}

    <div className="acp-reconciliation-ds__reports" aria-busy={query.isLoading || systems.isLoading}>
      {query.isLoading || systems.isLoading ? <Skeleton variant="text" lines={6} label="Carregando medições" />
        : !visible.length && !unavailable ? <EmptyState title={items.length ? 'Nenhuma medição corresponde aos filtros' : 'Nenhuma medição encontrada'}
          description={items.length ? 'Ajuste a origem, situação ou busca.' : 'Não há quantitativo histórico ou serviço finalizado nesta missão.'} /> : null}
      {visible.map(({ report, items }) => <Card variant="flat" key={`${report.source}:${report.id}`}
        title={reportTitle(report)}
        actions={<Badge tone="neutral">{report.source === 'REPORT' ? 'Relatório do app' : 'Histórico importado'}</Badge>}>
        <p className="acp-reconciliation-ds__report-date">{report.reportDate.slice(0, 10).split('-').reverse().join('/')}</p>
        {report.unappliedLinks ? <Alert tone="warning">{report.unappliedLinks} vínculo(s) anterior(es) não corresponde(m) mais aos quantitativos deste relatório. Confira as medições após a edição do documento.</Alert> : null}
        <div className="acp-reconciliation-ds__measurements">
          {items.map(item => <article className="acp-reconciliation-ds__measurement" key={`${rowKey(report, item)}:${report.revision}`}>
            <div className="acp-reconciliation-ds__measurement-info">
              {canManage ? <label className="acp-reconciliation-ds__check"><input type="checkbox" aria-label={`Selecionar ${reportTitle(report)} · ${item.equipment} · ${item.system} · linha ${item.itemIndex + 1}`} checked={Boolean(selected[rowKey(report, item)])}
                disabled={Boolean(busy) || unavailable || !item.reconciliation.compatibleSystemIds.length || (!selected[rowKey(report, item)] && Object.keys(selected).length >= 200)}
                onChange={event => { const checked = event.target.checked; setSelected(previous => { const next = { ...previous }; if (checked) next[rowKey(report, item)] = selection(report, item); else delete next[rowKey(report, item)]; return next; }); setBatchTarget(''); }} />Selecionar medição</label> : null}
              <strong>{item.equipment} · {item.system}</strong>
              <p>{labels[item.serviceType]}{item.diameter ? ` · ${item.diameter} ${item.diameterUnit || 'pol'}` : ''} · {item.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} {item.unit}</p>
              <Badge tone={compatible(item) ? 'success' : 'warning'} multiline>{item.reconciliation.message}</Badge>
              <p>Destino: {item.reconciliation.matchedSystem ? `${item.reconciliation.matchedSystem.equipment} · ${item.reconciliation.matchedSystem.name}` : 'Pendente de identificação'}{item.projectSystemId ? ' · vínculo desta medição' : item.reconciliation.matchedSystem ? ' · identificação anterior' : ''}</p>
            </div>
            {canManage ? <MeasurementLink item={item} systems={systems.data ?? []} disabled={Boolean(busy) || unavailable || (item.reconciliation.status === 'SOURCE_CONFLICT' && !item.projectSystemId)} saving={busy === 'save'}
              onSave={id => void save([selection(report, item)], id)} /> : null}
          </article>)}
        </div>
      </Card>)}
    </div>
    <details className="acp-reconciliation-ds__progress"><summary>Conferir avanço do escopo</summary>
      <ProjectProgressBreakdown projectId={projectId} canManage={canManage} appearance="design-system" />
    </details>
  </div>;
}
