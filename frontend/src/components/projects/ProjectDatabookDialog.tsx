import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { makeDatabookSchemas } from '../../../../shared/schemas/databooks.js';
import { createDatabook, downloadDatabook, getDatabookPhoto, getDatabookSources, getDatabookStockDocument, listDatabooks, retryDatabook,
  type DatabookInput, type DatabookPhotoSource, type DatabookRecord, type DatabookSources } from '../../api/databooks';
import { emptyDatabookInput, reconcileDatabookSelection } from '../../utils/databook';
import { formatDateOnly } from '../../utils/dateOnly';
import { downloadBlob } from '../../utils/download';
import { Modal } from '../ui/Modal';
import { Alert, Badge, Button, Field, Input, Select, Skeleton, Textarea } from '../ui/ds';
import { SortableEvidenceList } from '../ui/SortableEvidenceList';
import { ProjectDatabookNovelty } from './ProjectDatabookNovelty';
import './ProjectDatabookDialog.css';

const schemas = makeDatabookSchemas(z) as { create: z.ZodType<DatabookInput, DatabookInput>; period: z.ZodType<{ startDate: string; endDate: string }> };
const stateLabel = { PENDING: 'Na fila', RUNNING: 'Gerando', FAILED: 'Falhou', COMPLETED: 'Concluído' };
const stateTone = { PENDING: 'neutral', RUNNING: 'info', FAILED: 'danger', COMPLETED: 'success' } as const;
const phaseOptions = [{ value: 'UNSPECIFIED', label: 'Não informada' }, { value: 'BEFORE', label: 'Antes' }, { value: 'DURING', label: 'Durante' }, { value: 'AFTER', label: 'Depois' }];
const message = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir a ação.';

function PhotoThumbnail({ projectId, photo, period }: { projectId: string; photo: DatabookPhotoSource; period: { startDate: string; endDate: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '120px' });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const image = useQuery({ queryKey: ['databook-photo', projectId, photo.key, period.startDate, period.endDate],
    queryFn: () => getDatabookPhoto(projectId, photo, period), enabled: visible, staleTime: Infinity, retry: false });
  useEffect(() => {
    if (!image.data) return;
    const value = URL.createObjectURL(image.data); setUrl(value); return () => URL.revokeObjectURL(value);
  }, [image.data]);
  return <div ref={ref} className="databook-photo-preview">{url ? <img src={url} alt={photo.label} /> : image.isError ? <span>Foto indisponível</span> : <Skeleton height={100} label="Carregando foto" />}</div>;
}

export default function ProjectDatabookDialog({ projectId, userId, onClose }: { projectId: string; userId: string; onClose: () => void }) {
  const [params, setParams] = useSearchParams();
  const mode = params.get('databookMode') === 'new' ? 'new' : 'history';
  const queryClient = useQueryClient();
  const history = useQuery({ queryKey: ['databooks', projectId], queryFn: () => listDatabooks(projectId),
    refetchInterval: query => query.state.data?.items.some(item => ['PENDING', 'RUNNING'].includes(item.status)) ? 2500 : false });
  const initialized = useRef(false);
  const [sources, setSources] = useState<DatabookSources | null>(null);
  const [loadedPeriod, setLoadedPeriod] = useState<{ startDate: string; endDate: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [downloading, setDownloading] = useState('');
  const [photoFilter, setPhotoFilter] = useState('');
  const { register, control, reset, setValue, getValues, handleSubmit, setError, clearErrors, formState: { errors } } = useForm<DatabookInput>({
    resolver: zodResolver(schemas.create), defaultValues: emptyDatabookInput({ startDate: null, endDate: null })
  });
  const values = useWatch({ control });
  const canGenerate = history.data?.permissions.canGenerate === true;
  const changeMode = (next: 'history' | 'new') => setParams(current => { const copy = new URLSearchParams(current); copy.set('databookMode', next); return copy; }, { replace: true });
  useEffect(() => {
    if (!history.data || initialized.current) return;
    initialized.current = true; reset(emptyDatabookInput(history.data.defaults));
  }, [history.data, reset]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['databooks', projectId] });
  const prepare = useMutation({ mutationFn: async ({ period }: { period: { startDate: string; endDate: string }; preserve: boolean }) => getDatabookSources(projectId, period),
    onSuccess: (data, input) => {
      setSources(data); setLoadedPeriod(input.period); setNotice('');
      const current = getValues();
      const next = input.preserve ? reconcileDatabookSelection(current, data) : { ...current,
        reportIds: data.reports.filter(report => ['APPROVED', 'SIGNED'].includes(report.status)).map(report => report.id), photos: [], products: [], productsReviewed: false, documentVersionIds: [] };
      reset(next); clearErrors();
    }, onError: error => setNotice(message(error)) });
  const emit = useMutation({ mutationFn: (input: DatabookInput) => createDatabook(projectId, input),
    onSuccess: () => { void invalidate(); changeMode('history'); setNotice(''); }, onError: error => setNotice(message(error)) });
  const retry = useMutation({ mutationFn: (id: string) => retryDatabook(projectId, id), onSuccess: invalidate, onError: error => setNotice(message(error)) });
  const periodMatches = loadedPeriod?.startDate === values.startDate && loadedPeriod?.endDate === values.endDate;
  const busy = emit.isPending || prepare.isPending;
  const startNew = (previous?: DatabookRecord) => {
    if (busy || !history.data) return;
    const initial = previous ? { ...previous.options, previousId: previous.id, productsReviewed: false,
      products: previous.options.products.map(product => ({ ...product, confirmed: false })) } : emptyDatabookInput(history.data.defaults);
    reset(initial); setSources(null); setLoadedPeriod(null); setNotice(''); changeMode('new');
    if (previous) prepare.mutate({ period: { startDate: initial.startDate, endDate: initial.endDate }, preserve: true });
  };
  const preparePeriod = () => {
    clearErrors();
    const parsed = schemas.period.safeParse({ startDate: getValues('startDate'), endDate: getValues('endDate') });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) setError(issue.path[0] as 'startDate' | 'endDate', { message: issue.message });
      return;
    }
    prepare.mutate({ period: parsed.data, preserve: periodMatches === true });
  };
  const submit = handleSubmit(input => {
    if (!periodMatches || !sources) { setNotice('Carregue e confira as fontes do período escolhido antes de emitir.'); return; }
    setNotice(''); emit.mutate(input);
  }, () => {
    setNotice(!sources || !periodMatches ? 'Carregue e confira as fontes do período escolhido antes de emitir.' : 'Confira os campos destacados antes de emitir.');
  });
  const download = async (record: DatabookRecord, kind: 'pdf' | 'zip') => {
    setDownloading(`${record.id}-${kind}`); setNotice('');
    try { downloadBlob(await downloadDatabook(projectId, record.id, kind), `databook-${history.data?.project.code}-${record.startDate}-${record.endDate}-${record.familyId.slice(0, 8)}-rev-${record.revision}.${kind}`); }
    catch (error) { setNotice(message(error)); } finally { setDownloading(''); }
  };
  const previewFds = async (id: string, name: string) => {
    setDownloading(id); setNotice('');
    try { downloadBlob(await getDatabookStockDocument(projectId, id), name); }
    catch (error) { setNotice(message(error)); } finally { setDownloading(''); }
  };
  const selectedReportIds = values.reportIds || [];
  const selectedPhotos = (values.photos || []) as DatabookInput['photos'];
  const selectedProducts = (values.products || []) as DatabookInput['products'];
  const availablePhotos = sources?.photos.filter(photo => selectedReportIds.includes(photo.reportId)) || [];
  const visiblePhotos = availablePhotos.filter(photo => !selectedPhotos.some(item => item.key === photo.key) && [photo.reportLabel, photo.label, photo.system, photo.service, photo.fileName].join(' ').toLocaleLowerCase('pt-BR').includes(photoFilter.toLocaleLowerCase('pt-BR')));
  const toggleReport = (id: string, checked: boolean) => {
    const ids = checked ? [...selectedReportIds, id] : selectedReportIds.filter(value => value !== id);
    setValue('reportIds', ids, { shouldValidate: true });
    setValue('photos', selectedPhotos.filter(photo => sources?.photos.some(item => item.key === photo.key && ids.includes(item.reportId))));
  };
  const togglePhoto = (photo: DatabookPhotoSource) => setValue('photos', [...selectedPhotos, { key: photo.key, caption: photo.label, tag: '', phase: 'UNSPECIFIED' }]);
  const fieldClass = (invalid: unknown) => `field-group${invalid ? ' field-invalid' : ''}`;
  const familyLatest = new Map<string, DatabookRecord>();
  history.data?.items.forEach(item => { if ((familyLatest.get(item.familyId)?.revision || 0) < item.revision) familyLatest.set(item.familyId, item); });

  return <Modal open appearance="design-system" size="lg" title={`Databook${history.data ? ` · ${history.data.project.code}` : ''}`} onClose={onClose}
    closeOnEscape={!busy} showCloseButton={!busy} panelClassName="databook-dialog" footer={<div className="databook-actions">
      <Button variant="secondary" disabled={busy} onClick={onClose}>Fechar</Button>
      {mode === 'new' ? <><Button variant="secondary" disabled={busy} onClick={() => changeMode('history')}>Histórico</Button>
        <Button type="submit" form="databook-form" loading={emit.isPending} loadingLabel="Solicitando emissão" disabled={!canGenerate || prepare.isPending}>Emitir PDF e ZIP</Button></>
        : canGenerate ? <Button onClick={() => startNew()}>Novo databook / etapa</Button> : null}
    </div>}>
    {history.isPending ? <Skeleton variant="text" lines={4} /> : history.isError ? <Alert tone="danger" title="Não foi possível abrir o databook" action={<Button variant="secondary" onClick={() => void history.refetch()}>Tentar novamente</Button>}>{message(history.error)}</Alert> : <>
      <p className="databook-muted">{history.data?.project.name}</p>
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      {mode === 'history' ? <div className="databook-stack">
        {!canGenerate ? <Alert tone="info">Você pode consultar e baixar as emissões deste projeto.</Alert> : null}
        {!history.data?.items.length ? <Alert tone="info">Ainda não há databook emitido. Crie uma etapa para escolher o período e conferir as evidências.</Alert> : null}
        {history.data?.items.map(record => <article className="databook-card" key={record.id}>
          <div className="databook-actions"><strong>{record.title} · Revisão {record.revision}</strong><Badge tone={stateTone[record.status]}>{stateLabel[record.status]}</Badge></div>
          <p>{formatDateOnly(record.startDate)} a {formatDateOnly(record.endDate)} · {record.createdByName}</p>
          <p className="databook-muted">Solicitado em {formatDateOnly(record.createdAt)}{record.completedAt ? ` · concluído em ${formatDateOnly(record.completedAt)}` : ''}</p>
          {['PENDING', 'RUNNING'].includes(record.status) ? <div role="status"><progress max={100} value={record.progress} aria-label="Progresso da geração" /><span> {record.progress}% · Pode fechar esta tela; a geração continuará.</span></div> : null}
          {record.error ? <Alert tone="danger">{record.error}</Alert> : null}
          {record.warnings.length ? <details><summary>Conferências ({record.warnings.length})</summary>{record.warnings.map(warning => <p key={warning}>{warning}</p>)}</details> : null}
          <div className="databook-actions">
            {record.status === 'COMPLETED' ? <><Button variant="secondary" loading={downloading === `${record.id}-pdf`} onClick={() => void download(record, 'pdf')}>Baixar PDF</Button><Button variant="secondary" loading={downloading === `${record.id}-zip`} onClick={() => void download(record, 'zip')}>Baixar ZIP / originais</Button></> : null}
            {canGenerate && record.status === 'FAILED' ? <Button variant="secondary" disabled={retry.isPending} onClick={() => retry.mutate(record.id)}>Tentar novamente</Button> : null}
            {canGenerate && familyLatest.get(record.familyId)?.id === record.id ? <Button variant="secondary" onClick={() => startNew(record)}>Preparar nova revisão</Button> : null}
          </div>
        </article>)}
      </div> : canGenerate ? <form id="databook-form" onSubmit={submit} noValidate className="databook-stack">
        <ProjectDatabookNovelty userId={userId} guide />
        <Field label="Etapa / título do databook" required errorText={errors.title?.message} className={fieldClass(errors.title)}><Input {...register('title')} disabled={busy} placeholder="Ex.: Etapa 1 — limpeza dos APVs" /></Field>
        <div className="databook-grid" data-databook-period>
          <Field label="Data inicial" required errorText={errors.startDate?.message} className={fieldClass(errors.startDate)}><Input type="date" {...register('startDate')} disabled={busy} /></Field>
          <Field label="Data final" required errorText={errors.endDate?.message} className={fieldClass(errors.endDate)}><Input type="date" {...register('endDate')} disabled={busy} /></Field>
        </div>
        <p className="databook-muted">Padrão: primeiro e último RDO do projeto. Os dois dias escolhidos entram no databook. Períodos e escopos podem se sobrepor.</p>
        {!history.data?.defaults.startDate ? <Alert tone="info">Este projeto não possui RDO registrado. Informe as datas da etapa manualmente.</Alert> : null}
        <Field label="Resumo técnico da etapa" errorText={errors.summary?.message} className={fieldClass(errors.summary)}><Textarea {...register('summary')} disabled={busy} rows={3} /></Field>
        <div data-databook-sources><Button variant="secondary" loading={prepare.isPending} disabled={emit.isPending} onClick={preparePeriod}>{sources ? 'Atualizar fontes do período' : 'Carregar fontes do período'}</Button></div>
        {sources && !periodMatches ? <Alert tone="warning">O período mudou. Atualize as fontes para conferir a nova seleção antes de emitir.</Alert> : null}
        {sources && periodMatches ? <>
          <section className="databook-stack"><h3>Relatórios ({selectedReportIds.length}/{sources.reports.length})</h3>
            <p>Desmarque registros de outro escopo ocorrido nas mesmas datas. Fotos de relatórios desmarcados sairão da seleção.</p>
            {!sources.reports.length ? <Alert tone="warning">Nenhum relatório neste período.</Alert> : null}
            {errors.reportIds ? <p className="field-error" role="alert">{errors.reportIds.message}</p> : null}
            {sources.reports.map(report => { const approved = ['APPROVED', 'SIGNED'].includes(report.status); return <label key={report.id} className="databook-choice">
              <input type="checkbox" checked={selectedReportIds.includes(report.id)} disabled={!approved || busy} onChange={event => toggleReport(report.id, event.target.checked)} />
              <span><strong>{report.reportType} {report.sequenceNumber ?? 's/n'} · {formatDateOnly(report.date)}</strong><small>{approved ? report.status === 'SIGNED' ? 'Assinado' : 'Aprovado internamente' : 'Aguardando aprovação'} · Cliente: assinatura {report.clientSigned ? 'concluída/registrada' : report.clientSignaturesSigned ? `parcial (${report.clientSignaturesSigned}/${report.clientSignaturesRequired})` : 'não registrada'}; aceite {report.clientAccepted ? 'registrado' : 'não registrado'}</small>{report.services.map(service => [service.type, service.system].filter(Boolean).join(' · ')).filter(Boolean).join('; ')}</span>
            </label>; })}
          </section>
          <section className="databook-stack"><h3>Fotografias ({selectedPhotos.length} selecionadas)</h3>
            <p>Selecione, ordene pelo puxador ou setas e confira legenda, TAG e fase. A curadoria é exclusiva deste databook.</p>
            <SortableEvidenceList items={selectedPhotos} getId={photo => photo.key} disabled={busy} onChange={photos => setValue('photos', photos)} renderItem={(photo, index) => {
              const source = sources.photos.find(item => item.key === photo.key);
              return source ? <div className="databook-stack">
                <div className="databook-photo-heading"><PhotoThumbnail projectId={projectId} photo={source} period={loadedPeriod!} /><span>{source.reportLabel} · {formatDateOnly(source.date)}<small>{source.service} {source.system}</small></span>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => setValue('photos', selectedPhotos.filter(item => item.key !== photo.key))}>Retirar</Button></div>
                <Field label="Legenda" errorText={errors.photos?.[index]?.caption?.message} className={fieldClass(errors.photos?.[index]?.caption)}><Textarea rows={2} {...register(`photos.${index}.caption`)} value={photo.caption} disabled={busy} /></Field>
                <div className="databook-grid"><Field label="TAG / equipamento" errorText={errors.photos?.[index]?.tag?.message} className={fieldClass(errors.photos?.[index]?.tag)}><Input {...register(`photos.${index}.tag`)} value={photo.tag} disabled={busy} /></Field><Field label="Fase confirmada"><Select {...register(`photos.${index}.phase`)} value={photo.phase} options={phaseOptions} disabled={busy} /></Field></div>
              </div> : null;
            }} />
            <Field label="Buscar fotos disponíveis"><Input value={photoFilter} onChange={event => setPhotoFilter(event.target.value)} placeholder="Relatório, sistema ou legenda" /></Field>
            <div className="databook-photo-grid">{visiblePhotos.map(photo => <article className="databook-card" key={photo.key}>
              <PhotoThumbnail projectId={projectId} photo={photo} period={loadedPeriod!} /><strong>{photo.reportLabel} · {formatDateOnly(photo.date)}</strong><p>{photo.label} · {photo.service} {photo.system}</p><Button variant="secondary" size="sm" disabled={busy} onClick={() => togglePhoto(photo)}>Incluir foto</Button>
            </article>)}</div>
          </section>
          <section className="databook-stack"><h3>Produtos utilizados e FDS</h3>
            <Alert tone="info">Os produtos abaixo tiveram transferência de estoque para o projeto. Confirme o uso nesta etapa e a correspondência da FDS com o fabricante/produto. Transferência não é quantidade consumida.</Alert>
            {!sources.products.length ? <p>Não há produtos químicos movimentados para este projeto.</p> : null}
            {sources.products.map(product => {
              const index = selectedProducts.findIndex(item => item.itemId === product.id); const selected = index >= 0;
              return <article className="databook-card databook-stack" key={product.id}>
                <label className="databook-choice"><input type="checkbox" checked={selected} disabled={busy} onChange={event => {
                  setValue('productsReviewed', false); setValue('products', event.target.checked ? [...selectedProducts, { itemId: product.id, documentId: '', revision: '', confirmed: false }] : selectedProducts.filter(item => item.itemId !== product.id));
                }} /><span><strong>{product.code} · {product.name}</strong><small>Fabricante: {product.manufacturer || 'não informado'} · CAS: {product.casNumber || 'não informado'} · ONU: {product.unNumber || 'não informado'}</small></span></label>
                <details><summary>Lotes e transferências ({product.movements.length})</summary>{product.movements.map(movement => <p key={movement.id}>{formatDateOnly(movement.date)} · lote {movement.lot || 'não informado'} · {movement.quantity} {product.unitLabel} · {movement.inPeriod ? 'dentro' : 'fora'} do período</p>)}</details>
                {selected ? <>
                  {!product.documents.length ? <Alert tone="warning">FDS ausente. Cadastre o documento no Estoque antes de emitir com este produto.</Alert> : null}
                  <Field label="Documento FDS conferido" required errorText={errors.products?.[index]?.documentId?.message} className={fieldClass(errors.products?.[index]?.documentId)}><Select {...register(`products.${index}.documentId`)} value={selectedProducts[index].documentId} disabled={busy} placeholder="Escolha a FDS correspondente" options={product.documents.map(document => ({ value: document.id, label: document.fileName }))} /></Field>
                  {selectedProducts[index]?.documentId ? <Button variant="secondary" size="sm" loading={downloading === selectedProducts[index].documentId} onClick={() => void previewFds(selectedProducts[index].documentId, product.documents.find(document => document.id === selectedProducts[index].documentId)?.fileName || 'fds.pdf')}>Baixar documento para conferir</Button> : null}
                  <Field label="Revisão e data da FDS" required errorText={errors.products?.[index]?.revision?.message} className={fieldClass(errors.products?.[index]?.revision)}><Input {...register(`products.${index}.revision`)} value={selectedProducts[index].revision} disabled={busy} placeholder="Ex.: Rev. 02 — 26/06/2025" /></Field>
                  <div className={fieldClass(errors.products?.[index]?.confirmed)}><label className="databook-choice"><input type="checkbox" {...register(`products.${index}.confirmed`)} checked={selectedProducts[index].confirmed} disabled={busy} aria-invalid={Boolean(errors.products?.[index]?.confirmed)} /><span>Confirmo o uso nesta etapa e a correspondência do produto, fabricante e revisão da FDS.</span></label>{errors.products?.[index]?.confirmed ? <p className="field-error">Confirme uso e correspondência da FDS.</p> : null}</div>
                </> : null}
              </article>;
            })}
            <div className={fieldClass(errors.productsReviewed)}><label className="databook-choice"><input type="checkbox" {...register('productsReviewed')} disabled={busy} aria-invalid={Boolean(errors.productsReviewed)} /><span>Conferi a seleção de produtos e FDS desta etapa, inclusive quando nenhum produto foi utilizado.</span></label>{errors.productsReviewed ? <p className="field-error" role="alert">Confirme a conferência de produtos e FDS.</p> : null}</div>
          </section>
          <section className="databook-stack"><h3>Documentos técnicos e certificados</h3>
            <p>Selecione versões aplicáveis à etapa. Referências externas serão registradas; arquivos originais ficarão no ZIP.</p>
            {!sources.documents.length ? <p>Nenhum documento técnico cadastrado no projeto.</p> : null}
            {sources.documents.map(document => <label className="databook-choice" key={document.versionId}><input type="checkbox" disabled={busy} checked={values.documentVersionIds?.includes(document.versionId) || false} onChange={event => setValue('documentVersionIds', event.target.checked ? [...(values.documentVersionIds || []), document.versionId] : (values.documentVersionIds || []).filter(id => id !== document.versionId))} /><span>{document.title}<small>{document.versionLabel || 'Sem rótulo de revisão'} · {document.fileName || 'Referência externa'}</small></span></label>)}
          </section>
          <Alert tone="info">O PDF consolidado facilita a leitura. O ZIP preserva os originais e hashes para validar assinaturas. A emissão não registra entrega ou aceite do cliente.</Alert>
        </> : null}
      </form> : <Alert tone="info">Emissão disponível aos gestores. Você pode consultar o histórico.</Alert>}
    </>}
  </Modal>;
}
