import { useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Download, FileText, Files, PenLine } from 'lucide-react';

import {
  confirmPublicSignature,
  confirmPublicSignatureBatch,
  getPublicReport,
  getPublicSignature,
  type PublicSignatureBatchConfirmPayload,
  type PublicSignatureBatchResult,
  type PublicSignatureEmailDelivery,
  type PublicSignaturePayload,
  type PublicSignatureReportPayload,
  publicSignaturePdfUrl,
  publicSignatureZipUrl,
  publicReportPdfUrl,
  rejectPublicSignature
} from '../api/publicSignatures';
import { PrivacyNotice } from '../components/privacy/PrivacyNotice';
import { SignatureDialog } from '../components/reports/SignatureDialog';
import { PublicReportDocumentPreview } from '../components/reports/PublicReportDocumentPreview';
import { BrandLogo } from '../components/brand/BrandLogo';
import { Alert, Button, Card, Field, Skeleton, StatusPill, Textarea, type SemanticTone } from '../components/ui/ds';
import { useToast } from '../components/ui/ToastContext';
import { SIGNATURE_RDO_NOTICE_VERSION } from '../constants/privacy';
import { formatDateOnlyPtBr } from '../utils/dateOnly';
import previewRdoPdf from '../assets/previews/rdo-assinatura-exemplo.pdf?url';
import previewRdo43Pdf from '../assets/previews/rdo-assinatura-exemplo-43.pdf?url';
import previewRdo44Pdf from '../assets/previews/rdo-assinatura-exemplo-44.pdf?url';
import previewRdo45Pdf from '../assets/previews/rdo-assinatura-exemplo-45.pdf?url';
import previewSigned42Pdf from '../assets/previews/rdo-assinado-exemplo-42.pdf?url';
import previewSigned43Pdf from '../assets/previews/rdo-assinado-exemplo-43.pdf?url';
import previewSigned44Pdf from '../assets/previews/rdo-assinado-exemplo-44.pdf?url';
import previewSigned45Pdf from '../assets/previews/rdo-assinado-exemplo-45.pdf?url';
import previewSignedZip from '../assets/previews/rdos-assinados-exemplo.zip?url';

import './RdoPublicPage.css';

const statusText: Record<string, string> = {
  ACTIVE: 'Disponível para assinatura', SIGNED: 'Assinatura já registrada',
  REJECTED: 'Relatório reprovado', INVALIDATED: 'Link invalidado', EXPIRED: 'Link expirado',
  UNAVAILABLE: 'Relatório indisponível', INVALID: 'Link inválido'
};
const statusTone: Record<string, SemanticTone> = {
  ACTIVE: 'info', SIGNED: 'brand', REJECTED: 'danger', INVALIDATED: 'danger',
  EXPIRED: 'warning', UNAVAILABLE: 'neutral', INVALID: 'danger'
};
const previewProject = { code: '5800', name: 'Projeto de demonstração', clientName: 'Cliente Exemplo' };
const previewPdfUrls: Record<string, string> = {
  'visual-preview-42': previewRdoPdf, 'visual-preview-43': previewRdo43Pdf,
  'visual-preview-44': previewRdo44Pdf, 'visual-preview-45': previewRdo45Pdf
};
const previewSignedPdfUrls: Record<string, string> = {
  'visual-preview-42': previewSigned42Pdf, 'visual-preview-43': previewSigned43Pdf,
  'visual-preview-44': previewSigned44Pdf, 'visual-preview-45': previewSigned45Pdf
};
const previewReports: PublicSignatureReportPayload[] = [42, 43, 44, 45].map((sequenceNumber, index) => ({
  signatureId: `visual-preview-${sequenceNumber}`,
  status: 'ACTIVE',
  expiresAt: '2030-12-31T23:59:59Z',
  signer: { name: 'Marina Costa', prefillName: true, email: 'marina@exemplo.com', status: 'PENDING' },
  report: { id: `visual-report-${sequenceNumber}`, reportType: 'RDO', sequenceNumber, reportDate: `2026-10-${20 + index}`, status: 'APPROVED', sourceDocumentHash: 'visual-preview', project: previewProject }
}));
const previewSignature: PublicSignaturePayload = {
  status: 'ACTIVE', expiresAt: previewReports[0].expiresAt,
  signer: { ...previewReports[0].signer, signatureId: previewReports[0].signatureId },
  report: previewReports[0].report,
  batch: { pendingCount: previewReports.length, project: previewProject, reports: previewReports }
};

function reportLabel(item?: PublicSignatureReportPayload) {
  return item ? `${item.report.reportType} ${item.report.sequenceNumber || ''}`.trim() : 'Relatório';
}

export function PublicSignaturePage({ readOnly = false }: { readOnly?: boolean }) {
  const { token = '' } = useParams();
  const location = useLocation();
  const preview = !readOnly && import.meta.env.DEV && new URLSearchParams(location.search).get('visualizar') === '1';
  const previewSigned = preview && new URLSearchParams(location.search).get('estado') === 'assinado';
  const previewSingle = preview && new URLSearchParams(location.search).get('quantidade') === '1';
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [viewedSignatureId, setViewedSignatureId] = useState<string>();
  const [signingSignatureIds, setSigningSignatureIds] = useState<string[]>([]);
  const [rejectedSignatureId, setRejectedSignatureId] = useState<string>();
  const [rejectionReason, setRejectionReason] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [batchResults, setBatchResults] = useState<PublicSignatureBatchResult[]>([]);
  const [emailDeliveries, setEmailDeliveries] = useState<PublicSignatureEmailDelivery[]>([]);
  const [previewStatuses, setPreviewStatuses] = useState<Record<string, 'SIGNED' | 'REJECTED'>>(() =>
    previewSigned ? Object.fromEntries(previewReports.map(item => [item.signatureId!, 'SIGNED'])) : {});

  const signatureQuery = useQuery({
    queryKey: [readOnly ? 'public-report' : 'public-signature', token],
    queryFn: async (): Promise<PublicSignaturePayload> => {
      if (!readOnly) return getPublicSignature(token);
      const data = await getPublicReport(token);
      return { ...data, report: data.report ? { ...data.report, sourceDocumentHash: '' } : undefined };
    },
    enabled: !!token && !preview
  });

  const confirmMutation = useMutation({
    mutationFn: async (payload: PublicSignatureBatchConfirmPayload) => {
      if (payload.signatureIds.length > 1) return confirmPublicSignatureBatch(token, payload);
      const { signatureIds, ...confirmation } = payload;
      const data = await confirmPublicSignature(token, { ...confirmation, signatureId: signatureIds[0] });
      return { results: [{ signatureId: signatureIds[0], success: true, completed: data.completed }], emailDeliveries: [data.emailDelivery] };
    },
    onSuccess: data => {
      setSignatureOpen(false);
      setBatchResults(data.results);
      setEmailDeliveries(data.emailDeliveries);
      const failures = data.results.filter(item => !item.success).length;
      showToast(failures ? 'Confira os RDOs que ainda precisam de assinatura.' : 'Assinaturas registradas com sucesso.', failures ? 'error' : 'success');
      void queryClient.invalidateQueries({ queryKey: ['public-signature', token] });
    },
    onError: error => {
      setSignatureOpen(false);
      showToast(error instanceof Error ? error.message : 'Não foi possível assinar.', 'error');
      void queryClient.invalidateQueries({ queryKey: ['public-signature', token] });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: ({ comment, signatureId }: { comment: string; signatureId?: string }) => rejectPublicSignature(token, comment, signatureId),
    onSuccess: () => {
      setRejectOpen(false);
      setRejectionReason('');
      showToast('Reprovação registrada.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['public-signature', token] });
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível reprovar.', 'error')
  });

  const payload = preview ? {
    ...previewSignature,
    batch: { ...previewSignature.batch!, reports: previewSingle ? previewReports.slice(0, 1) : previewReports }
  } : signatureQuery.data;
  const report = payload?.report;
  const signer = payload?.signer;
  const status = (preview && signer?.signatureId ? previewStatuses[signer.signatureId] : undefined) || payload?.status || 'INVALID';
  const reportItems: PublicSignatureReportPayload[] = (payload?.batch?.reports?.length
    ? payload.batch.reports
    : report && signer ? [{ signatureId: signer.signatureId, status, expiresAt: payload.expiresAt || null, signer, report }] : []
  ).map(item => preview && item.signatureId && previewStatuses[item.signatureId]
    ? { ...item, status: previewStatuses[item.signatureId] } : item);
  const batchMode = reportItems.length > 1;
  const activeItems = reportItems.filter(item => item.status === 'ACTIVE' && item.signatureId);
  const signedItems = reportItems.filter(item => item.status === 'SIGNED');
  const selectedItem = reportItems.find(item => item.signatureId === viewedSignatureId)
    || activeItems[0] || reportItems[0];
  const signingItems = reportItems.filter(item => item.signatureId && signingSignatureIds.includes(item.signatureId));
  const rejectedItem = reportItems.find(item => item.signatureId === rejectedSignatureId);
  const canSign = !readOnly && activeItems.length > 0;
  const signedCount = batchResults.filter(item => item.success).length;
  const failures = batchResults.filter(item => !item.success);
  const initialSignerName = signingItems[0]?.signer.prefillName ? signingItems[0].signer.name : '';
  const selectedPdfUrl = preview ? previewPdfUrls[selectedItem?.signatureId || ''] || previewRdoPdf
    : publicSignaturePdfUrl(token, selectedItem?.signatureId);
  const signedPdfUrl = (item: PublicSignatureReportPayload) => preview
    ? previewSignedPdfUrls[item.signatureId || ''] || previewSigned42Pdf
    : publicSignaturePdfUrl(token, item.signatureId);

  function openSignatureDialog(ids: string[]) {
    if (!privacyAccepted || !ids.length) return;
    setSigningSignatureIds(ids);
    confirmMutation.reset();
    setSignatureOpen(true);
  }

  function handleRejectSubmit(event: FormEvent) {
    event.preventDefault();
    const reason = rejectionReason.trim();
    if (!reason) { showToast('Informe o motivo da reprovação.', 'error'); return; }
    if (preview) {
      if (rejectedSignatureId) setPreviewStatuses(current => ({ ...current, [rejectedSignatureId]: 'REJECTED' }));
      setRejectOpen(false);
      showToast('Reprovação simulada.', 'info');
      return;
    }
    rejectMutation.mutate({ comment: reason, signatureId: rejectedSignatureId });
  }

  return (
    <main className={`fv-ds rdo-public-shell public-signature-page${batchMode ? ' public-signature-page--batch' : ''}`} data-fv-ds>
      <header className="rdo-public-header"><BrandLogo className="rdo-public-logo" /></header>
      <Card className="rdo-public-card public-signature-card" padding="lg" title={readOnly ? 'Consulta do RDO' : 'Assinatura eletrônica'}>
        {preview ? <Alert tone="info">Demonstração visual · PDFs de exemplo, sem registro de assinaturas.</Alert> : null}
        {!preview && signatureQuery.isLoading ? <Skeleton variant="text" lines={5} label={readOnly ? 'Carregando RDO' : 'Carregando assinatura'} /> : null}
        {!preview && signatureQuery.isError ? <Alert tone="danger" title="Não foi possível carregar o link">
          {signatureQuery.error instanceof Error ? signatureQuery.error.message : 'Tente novamente mais tarde.'}
        </Alert> : null}
        {(preview || (!signatureQuery.isLoading && !signatureQuery.isError)) ? <>
          <StatusPill className="rdo-public-status" status={status} label={readOnly && status === 'ACTIVE' ? 'Disponível para consulta' : statusText[status] || status} tone={statusTone[status] || 'neutral'} />
          {report ? <dl className="rdo-public-details">
            <div><dt>Projeto</dt><dd>{report.project.code} - {report.project.name}</dd></div>
            {!batchMode ? <>
              <div><dt>Relatório</dt><dd>{report.reportType} {report.sequenceNumber || ''}</dd></div>
              <div><dt>Data</dt><dd>{formatDateOnlyPtBr(report.reportDate || '')}</dd></div>
            </> : null}
            {!readOnly ? <div><dt>Signatário</dt><dd>{signer?.name || '-'} · {signer?.email || '-'}</dd></div> : null}
            {readOnly && payload?.expiresAt ? <div><dt>Link válido até</dt><dd>{new Date(payload.expiresAt).toLocaleString('pt-BR')}</dd></div> : null}
          </dl> : <Alert tone="warning">O link está inválido, expirado ou indisponível.</Alert>}

          {batchResults.length ? <Alert tone={failures.length ? 'warning' : 'success'} title={signedCount ? `${signedCount} RDO${signedCount === 1 ? '' : 's'} com assinatura registrada` : 'Não foi possível concluir as assinaturas'}>
            {failures.length ? <ul>{failures.map(result => <li key={result.signatureId}>
              {reportLabel(reportItems.find(item => item.signatureId === result.signatureId))}: {result.error}
            </li>)}</ul> : 'Obrigado! Seus relatórios assinados estão disponíveis para download abaixo.'}
          </Alert> : null}
          {emailDeliveries.some(delivery => delivery.status === 'queued') ? <Alert tone="success">Uma cópia dos relatórios assinados será enviada para {signer?.email}.</Alert> : null}
          {emailDeliveries.some(delivery => delivery.status === 'sent') ? <Alert tone="success">Uma cópia dos relatórios assinados foi enviada para {signer?.email}.</Alert> : null}
          {emailDeliveries.some(delivery => delivery.status === 'failed') ? <Alert tone="warning">Sua assinatura foi registrada, mas não foi possível enviar todas as cópias por e-mail. Baixe os relatórios abaixo.</Alert> : null}
          {confirmMutation.isError ? <Alert tone="danger" title="Não foi possível confirmar todas as assinaturas">
            {confirmMutation.error instanceof Error ? confirmMutation.error.message : 'Tente novamente.'}
          </Alert> : null}

          {readOnly && status === 'ACTIVE' && report ? <>
            <PublicReportDocumentPreview key={token} pdfUrl={publicReportPdfUrl(token)} title={`${report.reportType} ${report.sequenceNumber || ''}`.trim()} />
            <div className="public-signature-actions public-report-actions"><a className="fv-button fv-button--primary" href={publicReportPdfUrl(token)} target="_blank" rel="noopener noreferrer">Baixar PDF do RDO</a></div>
          </> : null}

          {!readOnly && signedItems.length ? <section className="public-signature-downloads" aria-labelledby="signed-rdos-title">
            <div className="public-signature-downloads-heading">
              <div><h2 id="signed-rdos-title">{signedItems.length === 1 ? 'Relatório assinado' : 'Relatórios assinados'}</h2>
                <p>{signedItems.length === 1 ? 'Baixe o PDF com sua assinatura.' : 'Baixe cada PDF individualmente ou todos juntos em um arquivo ZIP.'}</p></div>
              {signedItems.length > 1 ? <a className="fv-button fv-button--primary fv-button--md" href={preview ? previewSignedZip : publicSignatureZipUrl(token)} download><Download size={16} aria-hidden="true" /> Baixar todos (ZIP)</a> : null}
            </div>
            {signedItems.length === 1 ? <a className="fv-button fv-button--primary fv-button--md" href={signedPdfUrl(signedItems[0])} download><Download size={16} aria-hidden="true" /> Baixar PDF assinado</a> : <ul className="public-signature-download-list">
              {signedItems.map(item => <li key={item.signatureId}>
                <FileText size={22} aria-hidden="true" />
                <div><strong>{reportLabel(item)}</strong><span>{formatDateOnlyPtBr(item.report.reportDate || '')}</span></div>
                <a className="fv-button fv-button--secondary fv-button--sm" href={signedPdfUrl(item)} download aria-label={`Baixar PDF assinado do ${reportLabel(item)}`}><Download size={16} aria-hidden="true" /> Baixar PDF</a>
              </li>)}
            </ul>}
            {signedItems.some(item => item.report.status !== 'SIGNED') && !preview ? <p className="rdo-public-footnote">Os PDFs incluem as assinaturas registradas até este momento. Há relatórios que ainda aguardam outros signatários.</p> : null}
          </section> : null}

          {!readOnly && reportItems.length && (activeItems.length > 0 || !signedItems.length) ? <div className="public-signature-workspace">
            {batchMode ? <aside className="public-signature-pending" aria-labelledby="pending-rdos-title">
              <div className="public-signature-pending-heading">
                <span className="public-signature-pending-icon"><Files size={22} aria-hidden="true" /></span>
                <div><h2 id="pending-rdos-title">RDOs deste projeto</h2><p>{activeItems.length} pendente{activeItems.length !== 1 ? 's' : ''} para você assinar</p></div>
              </div>
              <p className="public-signature-pending-hint">Confira cada documento. Você pode assinar um por vez ou todos juntos, sem entrar na sua conta.</p>
              <nav className="public-signature-report-list" aria-label="Relatórios do projeto">
                {reportItems.map(item => <button type="button" key={item.signatureId}
                  className={`public-signature-report-option${selectedItem?.signatureId === item.signatureId ? ' is-selected' : ''}`}
                  aria-current={selectedItem?.signatureId === item.signatureId ? 'true' : undefined}
                  onClick={() => setViewedSignatureId(item.signatureId)}>
                  <FileText size={20} aria-hidden="true" />
                  <span><strong>{reportLabel(item)}</strong><small>{formatDateOnlyPtBr(item.report.reportDate || '')}{item.signatureId === signer?.signatureId ? ' · RDO deste link' : ''}</small>
                    <span className={`public-signature-report-state${item.status === 'SIGNED' ? ' is-signed' : ''}`}>{item.status === 'ACTIVE' ? 'Aguardando sua assinatura' : statusText[item.status]}</span></span>
                  {item.status === 'SIGNED' ? <CheckCircle2 size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
                </button>)}
              </nav>
              {activeItems.length > 1 ? <div className="public-signature-batch-invite"><strong>Resolva todas as pendências de uma vez</strong><p>Uma única confirmação para assinar os {activeItems.length} RDOs listados.</p><a href="#public-signature-consent">Continuar para assinatura <ChevronRight size={16} aria-hidden="true" /></a></div> : null}
            </aside> : null}
            {selectedItem ? <section className="public-signature-document-pane" aria-label={`Documento ${reportLabel(selectedItem)}`}>
              {batchMode ? <div className="public-signature-document-heading"><div><span>Documento em visualização</span><h2>{reportLabel(selectedItem)}</h2><p>{formatDateOnlyPtBr(selectedItem.report.reportDate || '')}</p></div><StatusPill status={selectedItem.status} label={selectedItem.status === 'ACTIVE' ? 'Pendente' : statusText[selectedItem.status]} tone={statusTone[selectedItem.status]} /></div> : null}
              {selectedItem.status === 'ACTIVE' ? <>
                <PublicReportDocumentPreview key={selectedItem.signatureId} pdfUrl={selectedPdfUrl} title={reportLabel(selectedItem)} />
                <div className="public-signature-actions">
                  <a className="fv-button fv-button--secondary fv-button--sm" href={selectedPdfUrl} target="_blank" rel="noopener noreferrer">Abrir PDF</a>
                  <Button size="sm" variant="danger" type="button" disabled={confirmMutation.isPending} onClick={() => { setRejectedSignatureId(selectedItem.signatureId); setRejectionReason(''); setRejectOpen(true); }}>Reprovar RDO</Button>
                </div>
              </> : <Alert tone={selectedItem.status === 'SIGNED' ? 'success' : 'warning'}>{statusText[selectedItem.status]}</Alert>}
            </section> : null}
          </div> : null}

          {canSign ? <section id="public-signature-consent" className="public-signature-consent" aria-label="Confirmar assinatura">
            <PrivacyNotice variant="signatureRdo" checked={privacyAccepted} onCheckedChange={setPrivacyAccepted} disabled={confirmMutation.isPending} />
            <div className="public-signature-confirm-bar">
              <div><strong>{activeItems.length > 1 ? 'Como deseja assinar?' : 'Tudo pronto para assinar'}</strong><p>{activeItems.length > 1 ? 'Assine somente o documento em visualização ou todos os RDOs pendentes.' : 'Confira o documento e confirme sua assinatura.'}</p></div>
              <div className="public-signature-confirm-buttons">
                {selectedItem?.status === 'ACTIVE' && selectedItem.signatureId ? <Button variant={activeItems.length > 1 ? 'secondary' : 'primary'} type="button" disabled={!privacyAccepted || confirmMutation.isPending} onClick={() => openSignatureDialog([selectedItem.signatureId!])}><PenLine size={16} aria-hidden="true" /> Assinar {reportLabel(selectedItem)}</Button> : null}
                {activeItems.length > 1 ? <Button variant="primary" type="button" disabled={!privacyAccepted || confirmMutation.isPending} onClick={() => openSignatureDialog(activeItems.map(item => item.signatureId!))}><Files size={16} aria-hidden="true" /> Assinar todos ({activeItems.length})</Button> : null}
              </div>
            </div>
          </section> : null}

          {rejectOpen ? <form className="public-signature-reject" onSubmit={handleRejectSubmit}>
            <Field id="public-signature-reason" label={`Motivo da reprovação de ${reportLabel(rejectedItem)}`} required optionalText={null}>
              <Textarea rows={4} value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} required />
            </Field>
            <div className="public-signature-actions"><Button size="sm" variant="secondary" type="button" onClick={() => setRejectOpen(false)} disabled={rejectMutation.isPending}>Cancelar</Button><Button size="sm" variant="danger" type="submit" loading={rejectMutation.isPending}>Confirmar reprovação</Button></div>
          </form> : null}
        </> : null}
      </Card>
      <SignatureDialog open={signatureOpen}
        title={signingItems.length > 1 ? `Assinar ${signingItems.length} RDOs juntos` : `Assinar ${reportLabel(signingItems[0])}`}
        appearance="design-system" initialSignerName={initialSignerName} allowCachedSignerName={Boolean(initialSignerName)}
        cacheIdentity={`${signer?.email || token}:public-rdo`}
        isSubmitting={confirmMutation.isPending} loadingLabel={signingItems.length > 1 ? 'Assinando RDOs' : 'Assinando relatório'}
        submissionError={confirmMutation.error instanceof Error ? confirmMutation.error.message : ''}
        notice={signingItems.length > 1 ? <div className="public-signature-batch-confirmation"><strong>Sua assinatura será aplicada a estes documentos:</strong><ul>{signingItems.map(item => <li key={item.signatureId}>{reportLabel(item)} · {formatDateOnlyPtBr(item.report.reportDate || '')}</li>)}</ul><p>Ao confirmar, você declara que conferiu e aprova todos os RDOs listados.</p></div> : null}
        onCancel={() => { if (!confirmMutation.isPending) setSignatureOpen(false); }}
        onConfirm={confirmation => {
          if (preview) {
            setPreviewStatuses(current => ({ ...current, ...Object.fromEntries(signingSignatureIds.map(id => [id, 'SIGNED' as const])) }));
            setBatchResults(signingSignatureIds.map(signatureId => ({ signatureId, success: true })));
            setSignatureOpen(false); showToast('Assinatura simulada.', 'success'); return;
          }
          confirmMutation.mutate({ ...confirmation, signatureIds: signingSignatureIds, privacyNoticeAccepted: true, privacyNoticeVersion: SIGNATURE_RDO_NOTICE_VERSION });
        }} />
    </main>
  );
}
