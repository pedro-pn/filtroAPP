import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  downloadHistoricalTemplate, importHistoricalServices, listHistoricalServices,
  previewHistoricalServices, updateHistoricalServices,
  type HistoricalImportPreview, type HistoricalMeasurement, type HistoricalServiceReport, type HistoricalServiceType
} from '../../api/historicalServices';
import { downloadReportPdf } from '../../api/reports';
import type { Project } from '../../types/domain';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/ToastContext';
import { downloadBlob } from '../../utils/download';
import { matchesSearch } from '../../utils/search';
import {
  historicalFormCsv, historicalReportForm, historicalServiceLabels, historicalTotals,
  newHistoricalItem, type HistoricalFormItem
} from './historicalServicesForm';
import './historical-services.css';

const quantityText = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
const dateText = (value: string) => value.slice(0, 10).split('-').reverse().join('/');
const reportTitle = (report: { reportType: string; sequenceNumber: number }) => `${report.reportType} ${String(report.sequenceNumber).padStart(3, '0')}`;
const actionLabels = { CREATE: 'Novo', SKIP: 'Já importado', CONFLICT: 'Conflito' };

function MeasurementsTable({ items }: { items: HistoricalMeasurement[] }) {
  return <div className="historical-table-scroll" tabIndex={0} aria-label="Quantitativos do relatório">
    <table className="historical-table">
      <thead><tr><th>Serviço</th><th>Equipamento do cliente</th><th>Sistema</th><th>Diâmetro (pol)</th><th>Quantidade</th></tr></thead>
      <tbody>{items.map((item, index) => <tr key={index}>
        <td>{historicalServiceLabels[item.serviceType]}</td><td>{item.equipment}</td><td>{item.system}</td>
        <td>{item.diameter || '—'}</td><td>{quantityText(item.quantity)} {item.unit}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function HistoricalServicesModal({ projects, initialProjectId, onClose }: {
  projects: Project[]; initialProjectId: string; onClose: () => void;
}) {
  const [projectId, setProjectId] = useState(initialProjectId || projects[0]?.id || '');
  const [busy, setBusy] = useState(false);
  return <Modal open onClose={() => { if (!busy) onClose(); }} closeOnEscape={!busy} ariaLabelledBy="historical-title" panelClassName="modal-card historical-modal">
    <div className="historical-heading">
      <h2 id="historical-title">Serviços históricos</h2>
      <button type="button" className="mini-btn alt" onClick={onClose} disabled={busy}>Fechar</button>
    </div>
    <HistoricalServicesContent key={projectId} projects={projects} projectId={projectId} onProjectChange={setProjectId} onBusyChange={setBusy} />
  </Modal>;
}

export function HistoricalServicesContent({ projects, projectId, onProjectChange, onBusyChange }: {
  projects: Project[]; projectId: string; onProjectChange: (projectId: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<HistoricalImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [editing, setEditing] = useState<HistoricalServiceReport | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(historicalReportForm());
  const [fileKey, setFileKey] = useState(0);
  const editorRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const history = useQuery({ queryKey: ['historical-services', projectId], queryFn: () => listHistoricalServices(projectId), enabled: Boolean(projectId) });
  useEffect(() => {
    if (showForm) {
      editorRef.current?.scrollIntoView({ block: 'start' });
      editorRef.current?.querySelector('input')?.focus({ preventScroll: true });
    }
  }, [showForm, editing?.id]);

  function resetInput() {
    setCsv(''); setFileName(''); setPreview(null); setError(''); setShowForm(false); setEditing(null); setFileKey(value => value + 1);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); onBusyChange(true); setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  async function changed() {
    await queryClient.invalidateQueries({ queryKey: ['historical-services', projectId] });
    // Progress views must refresh when they are next opened.
    await queryClient.invalidateQueries({ predicate: query => /acompanhamento|progress|project-stats|statistics/.test(String(query.queryKey[0])), refetchType: 'none' });
  }
  async function readFile(file?: File) {
    resetInput();
    if (!file) return;
    await run(async () => {
      if (!/\.csv$/i.test(file.name)) throw new Error('Selecione um arquivo CSV.');
      if (file.size > 500_000) throw new Error('O CSV deve ter no máximo 500 KB.');
      const bytes = await file.arrayBuffer();
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { content = new TextDecoder('windows-1252').decode(bytes); }
      setCsv(content); setFileName(file.name);
      setPreview(await previewHistoricalServices(projectId, content));
    });
  }
  function openForm(report?: HistoricalServiceReport) {
    resetInput(); setForm(historicalReportForm(report)); setEditing(report ?? null); setShowForm(true);
  }
  function updateItem(index: number, patch: Partial<HistoricalFormItem>) {
    setPreview(null);
    setForm(current => ({ ...current, items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  }
  async function submitForm(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const content = historicalFormCsv(form);
      if (editing) {
        await updateHistoricalServices(projectId, editing.id, content, editing.revision);
        resetInput(); await changed(); showToast('Quantitativos atualizados.', 'success');
      } else {
        setCsv(content); setFileName('Lançamento manual');
        setPreview(await previewHistoricalServices(projectId, content));
      }
    });
  }
  async function confirmImport() {
    if (!preview?.canImport) return;
    await run(async () => {
      const result = await importHistoricalServices(projectId, csv, preview.token, fileName);
      resetInput(); await changed();
      showToast(`${result.created} relatório(s) importado(s).${result.skipped ? ` ${result.skipped} já existente(s).` : ''}`, 'success');
    });
  }

  const visible = (history.data ?? []).filter(report => {
    const date = report.reportDate.slice(0, 10);
    return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
  }).map(report => ({
    ...report, visibleItems: report.items.filter(item => (!serviceFilter || item.serviceType === serviceFilter)
      && matchesSearch([report.reportType, report.sequenceNumber, dateText(report.reportDate), item.equipment, item.system, item.diameter, historicalServiceLabels[item.serviceType]], search))
  })).filter(report => report.visibleItems.length);
  const totals = historicalTotals(visible.filter(report => !report.sourceConflict).flatMap(report => report.visibleItems));

  return <div className="historical-content">
    <p className="historical-help">Quantitativos finais por relatório emitido. Cada diâmetro ocupa uma linha. Importe um CSV ou lance os dados manualmente, mesmo sem o PDF.</p>
    <div className="field-group">
      <label htmlFor="historical-project">Projeto</label>
      <select id="historical-project" value={projectId} disabled={busy || showForm} onChange={event => {
        onProjectChange(event.target.value); resetInput(); setSearch(''); setServiceFilter(''); setDateFrom(''); setDateTo('');
      }}>
        {!!projects.length && <option value="">Selecionar projeto...</option>}
        {!projects.length && <option value="">Nenhum projeto disponível</option>}
        {projects.map(project => <option key={project.id} value={project.id}>{project.code} — {project.name}{project.isActive === false ? ' (arquivado)' : ''}</option>)}
      </select>
    </div>
    <div className="historical-toolbar">
      <button className="mini-btn alt" type="button" disabled={busy} onClick={() => void run(async () => downloadBlob(await downloadHistoricalTemplate(), 'servicos-historicos-modelo.csv'))}>Baixar modelo CSV</button>
      <label className={`mini-btn historical-upload ${busy || !projectId || showForm ? 'disabled' : ''}`}>
        Importar CSV<input key={fileKey} aria-label="Importar CSV de serviços históricos" type="file" accept=".csv,text/csv" disabled={busy || !projectId || showForm} onChange={event => void readFile(event.target.files?.[0])} />
      </label>
      <button className="mini-btn alt" type="button" disabled={busy || !projectId || showForm} onClick={() => openForm()}>Adicionar relatório</button>
    </div>
    <p className="historical-help">Use RLQ para limpeza química, RTP para teste de pressão e RCPU para filtragem ou flushing. Equipamento do cliente e sistema são textos livres. Diâmetros em polegadas aceitam pol ou apóstrofo ('). Comprimentos: cm ou m. Volumes: L ou mL. Substitua os exemplos do modelo pelos dados dos relatórios.</p>
    {busy && <p role="status">Processando...</p>}
    {error && <div className="historical-error" role="alert">{error}</div>}

    {showForm && <form ref={editorRef} className="historical-editor" onSubmit={submitForm}>
      <h3>{editing ? `Editar ${reportTitle(editing)}` : 'Adicionar relatório'}</h3>
      <fieldset disabled={busy}>
        <div className="historical-form-grid">
          <div className="field-group"><label htmlFor="historical-type">Relatório</label><select id="historical-type" value={form.reportType} onChange={event => {
            const reportType = event.target.value as HistoricalServiceReport['reportType'];
            setPreview(null);
            setForm(current => ({ ...current, reportType, items: current.items.map(item => ({ ...item,
              serviceType: reportType === 'RLQ' ? 'limpeza' : reportType === 'RTP' ? 'pressao' : 'filtragem',
              unit: reportType === 'RCPU' ? 'L' : 'm', diameter: reportType === 'RCPU' ? '' : item.diameter
            })) }));
          }}><option>RLQ</option><option>RTP</option><option>RCPU</option></select></div>
          <div className="field-group"><label htmlFor="historical-number">Número</label><input id="historical-number" inputMode="numeric" value={form.sequenceNumber} required onChange={event => { setPreview(null); setForm({ ...form, sequenceNumber: event.target.value }); }} /></div>
          <div className="field-group"><label htmlFor="historical-date">Data do relatório</label><input id="historical-date" type="date" value={form.reportDate} required onChange={event => { setPreview(null); setForm({ ...form, reportDate: event.target.value }); }} /></div>
        </div>
        {form.items.map((item, index) => <div className="historical-item-editor" key={index}>
          <div className="historical-form-grid">
            <div className="field-group"><label htmlFor={`hs-service-${index}`}>Serviço</label><select id={`hs-service-${index}`} value={item.serviceType} onChange={event => {
              const serviceType = event.target.value as HistoricalServiceType;
              updateItem(index, { serviceType, unit: serviceType === 'filtragem' ? 'L' : 'm', diameter: serviceType === 'filtragem' ? '' : item.diameter });
            }}>{(Object.entries(historicalServiceLabels) as Array<[HistoricalServiceType, string]>).filter(([type]) => form.reportType === 'RLQ' ? type === 'limpeza' : form.reportType === 'RTP' ? type === 'pressao' : ['filtragem', 'flushing'].includes(type)).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></div>
            <div className="field-group"><label htmlFor={`hs-equipment-${index}`}>Equipamento do cliente</label><input id={`hs-equipment-${index}`} maxLength={180} required value={item.equipment} onChange={event => updateItem(index, { equipment: event.target.value })} /></div>
            <div className="field-group"><label htmlFor={`hs-system-${index}`}>Sistema</label><input id={`hs-system-${index}`} maxLength={180} required value={item.system} onChange={event => updateItem(index, { system: event.target.value })} /></div>
            <div className="field-group"><label htmlFor={`hs-diameter-${index}`}>Diâmetro (pol)</label><input id={`hs-diameter-${index}`} disabled={['L', 'mL'].includes(item.unit)} required={['m', 'cm'].includes(item.unit)} placeholder={['m', 'cm'].includes(item.unit) ? 'Ex.: 2 ou 1 1/2' : 'Não se aplica'} value={item.diameter} onChange={event => updateItem(index, { diameter: event.target.value })} /></div>
            <div className="field-group"><label htmlFor={`hs-quantity-${index}`}>Quantidade</label><input id={`hs-quantity-${index}`} inputMode="decimal" required value={item.quantity} onChange={event => updateItem(index, { quantity: event.target.value })} /></div>
            <div className="field-group"><label htmlFor={`hs-unit-${index}`}>Unidade</label><select id={`hs-unit-${index}`} value={item.unit} onChange={event => updateItem(index, { unit: event.target.value as HistoricalMeasurement['unit'], diameter: ['L', 'mL'].includes(event.target.value) ? '' : item.diameter })}>
              {item.serviceType !== 'filtragem' && <><option value="m">m — metros</option><option value="cm">cm — centímetros</option></>}{['filtragem', 'flushing'].includes(item.serviceType) && <><option value="L">L — litros</option><option value="mL">mL — mililitros</option></>}
            </select></div>
          </div>
          {form.items.length > 1 && <button type="button" className="mini-btn alt" onClick={() => { setPreview(null); setForm({ ...form, items: form.items.filter((_, i) => i !== index) }); }}>Remover linha {index + 1}</button>}
        </div>)}
        <div className="historical-toolbar">
          <button type="button" className="mini-btn alt" onClick={() => {
            const last = form.items[form.items.length - 1]; setPreview(null);
            setForm({ ...form, items: [...form.items, { ...newHistoricalItem(last.serviceType), equipment: last.equipment, system: last.system, unit: last.unit }] });
          }}>+ Adicionar medição</button>
          <button type="submit" className="mini-btn">{editing ? 'Salvar alterações' : 'Conferir lançamento'}</button>
          <button type="button" className="mini-btn alt" onClick={resetInput}>Cancelar</button>
        </div>
      </fieldset>
    </form>}

    {preview && <section className="historical-preview" aria-label="Prévia da importação">
      <div className="historical-heading"><h3>Prévia — {fileName}</h3><button type="button" className="mini-btn alt" disabled={busy} onClick={resetInput}>Cancelar importação</button></div>
      <p>{preview.rowCount} linha(s) · {preview.reports.filter(report => report.action === 'CREATE').length} novo(s) relatório(s) · {preview.reports.filter(report => report.action === 'SKIP').length} já importado(s)</p>
      {!!preview.errors.length && <div className="historical-error" role="alert"><ul>{preview.errors.map((issue, index) => <li key={index}>Linha {issue.line}: {issue.message}</li>)}</ul></div>}
      {preview.reports.map(report => <article className="historical-report" key={`${report.reportType}:${report.sequenceNumber}`}>
        <div className="historical-heading"><strong>{reportTitle(report)} · {dateText(report.reportDate)}</strong><span className={`historical-status historical-status-${report.action.toLowerCase()}`}>{actionLabels[report.action]}</span></div>
        <p className="historical-help">Linhas {report.lines.join(', ')} · {report.sourceReportId ? 'Relatório localizado no app' : 'Referência do relatório registrada pela planilha'}</p>
        {report.error && <p className="historical-error">{report.error}</p>}
        <MeasurementsTable items={report.items} />
      </article>)}
      <button type="button" className="mini-btn" disabled={busy || !preview.canImport} onClick={() => void confirmImport()}>Confirmar importação</button>
      {!preview.canImport && <p className="historical-help">{preview.errors.length || preview.reports.some(report => report.action === 'CONFLICT') ? 'Corrija os erros e envie o CSV novamente. Nenhum dado deste arquivo foi importado.' : 'Todos os relatórios deste arquivo já estão importados.'}</p>}
    </section>}

    <section className="historical-history" aria-label="Histórico de serviços">
      <h3>Quantitativos cadastrados</h3>
      <div className="historical-filters">
        <div className="field-group"><label htmlFor="historical-search">Buscar</label><input id="historical-search" type="search" placeholder="Equipamento, sistema, diâmetro ou relatório" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <div className="field-group"><label htmlFor="historical-filter-service">Serviço</label><select id="historical-filter-service" value={serviceFilter} onChange={event => setServiceFilter(event.target.value)}><option value="">Todos</option>{Object.entries(historicalServiceLabels).map(([type, label]) => <option value={type} key={type}>{label}</option>)}</select></div>
        <div className="field-group"><label htmlFor="historical-from">De</label><input id="historical-from" type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></div>
        <div className="field-group"><label htmlFor="historical-to">Até</label><input id="historical-to" type="date" value={dateTo} min={dateFrom} onChange={event => setDateTo(event.target.value)} /></div>
      </div>
      {history.isPending && projectId && <p role="status">Carregando histórico...</p>}
      {history.isError && <div className="historical-error" role="alert">{history.error.message} <button className="mini-btn alt" type="button" onClick={() => void history.refetch()}>Tentar novamente</button></div>}
      {!!totals.length && <><div className="historical-totals" aria-label="Totais dos resultados">{totals.map(total => <span key={`${total.serviceType}:${total.unit}`}>{historicalServiceLabels[total.serviceType]}: <strong>{quantityText(total.quantity)} {total.unit}</strong></span>)}</div><p className="historical-help">Totais convertidos para metros e litros. As linhas preservam a unidade informada.</p></>}
      {!history.isPending && !history.isError && !visible.length && <p className="historical-help">{history.data?.length ? 'Nenhum lançamento corresponde aos filtros.' : 'Nenhum serviço histórico cadastrado neste projeto. Importe um CSV ou adicione um relatório.'}</p>}
      {visible.map(report => <article className="historical-report" key={report.id}>
        <div className="historical-heading"><strong>{reportTitle(report)} · {dateText(report.reportDate)}</strong><div className="historical-toolbar">
          {report.sourceReportId && <button className="mini-btn alt" type="button" disabled={busy} onClick={() => void run(async () => { downloadBlob(await downloadReportPdf(report.sourceReportId!), `${reportTitle(report)}.pdf`); })}>Baixar PDF</button>}
          <button className="mini-btn alt" type="button" disabled={busy} onClick={() => openForm(report)} aria-label={`Editar ${reportTitle(report)}`}>Editar</button>
        </div></div>
        {report.sourceConflict && <p className="historical-error">{report.sourceConflict} Este lançamento histórico está fora dos totais; confira o relatório de origem.</p>}
        <MeasurementsTable items={report.visibleItems} />
      </article>)}
    </section>
  </div>;
}
