import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiClientError } from '../../../api/client';
import { getSignatureBatch, publishSignatureBatch, saveSignatureBatch, type SignatureBatch, type SignatureBatchConfiguration } from '../../../api/assinaturas';
import { useAuth } from '../../../auth/AuthContext';
import { useToast } from '../../../components/ui/ToastContext';
import { PageHeader } from '../../../layout/PageHeader';
import { Alert, Badge, Button, Card, EmptyState, Skeleton } from '../../../components/ui/ds';
import { batchConfiguration, batchPreviewSigners, batchPublicationIssues } from '../utils/batch';
import { PublishDialog } from './PublishDialog';
import { SignerList } from './SignerList';
import { BatchTrackingView } from './BatchTrackingView';
import { SignatureBatchPreview } from './SignatureBatchPreview';
import '../AssinaturasPreparation.ds.css';

function BatchEditor({ batch, onBack }: {
  batch: SignatureBatch; onBack: () => void;
}) {
  const { user } = useAuth();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [configuration, setConfiguration] = useState<SignatureBatchConfiguration>(() => batchConfiguration(batch));
  const [dirty, setDirty] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const saveMutation = useMutation({ mutationFn: (next: SignatureBatchConfiguration) => saveSignatureBatch(batch.id, next) });
  const publishMutation = useMutation({ mutationFn: (expiry: { expiresInDays: number } | { expiresAt: string }) => publishSignatureBatch(batch.id, expiry) });
  const busy = saveMutation.isPending || publishMutation.isPending;
  const previewSigners = batchPreviewSigners(configuration.signers);

  async function save(next = configuration) {
    const saved = await saveMutation.mutateAsync(next);
    setConfiguration(batchConfiguration(saved));
    setDirty(false);
    await queryClient.invalidateQueries({ queryKey: ['assinaturas', 'list'] });
    return saved;
  }

  async function publish(expiry: { expiresInDays: number } | { expiresAt: string }) {
    const pending = batchPublicationIssues(batch, configuration);
    setIssues(pending);
    if (pending.length) return;
    try {
      if (dirty) await save();
      await publishMutation.mutateAsync(expiry);
      await queryClient.invalidateQueries({ queryKey: ['assinaturas'] });
      setPublishOpen(false);
      showToast('Lote publicado. Cada assinante receberá um link único com seus documentos.', 'success');
    } catch (error) {
      setIssues(error instanceof ApiClientError && error.issues?.length ? error.issues : [error instanceof Error ? error.message : 'Não foi possível publicar o lote.']);
    }
  }

  return <section className="fv-ds assinaturas-detail">
    <div className="assinaturas-detail__topline"><Button variant="secondary" size="sm" disabled={busy} onClick={onBack}>Voltar</Button><Badge tone="neutral">{batch.documents.length} documento(s)</Badge></div>
    <PageHeader title="Preparar lote de assinaturas" />
    <div className="signature-setup-layout assinaturas-setup">
      <SignerList signers={previewSigners} account={user} saving={busy} onSave={async signers => {
        const nextSigners = signers.map(signer => ({ ...signer, id: signer.id || crypto.randomUUID() }));
        const next = { signers: nextSigners, documents: configuration.documents.map(document => ({ ...document, fields: document.fields.filter(field => nextSigners.some(signer => signer.id === field.signerId)) })) };
        await save(next);
      }} />
      <Card className="signature-editor-panel" padding="md" title={<h2>Campos de assinatura do lote</h2>}>
        <p className="signature-editor-hint">Role ou use a navegação para percorrer os documentos. Cada assinante receberá um único link com os documentos em que foi posicionado e assinará todos de uma vez. Os PDFs finais ficam separados.</p>
        {!configuration.signers.length ? <Alert tone="info">Adicione um assinante para posicionar os campos.</Alert> : null}
        <SignatureBatchPreview documents={batch.documents} signers={previewSigners} fieldsByDocument={configuration.documents} disabled={busy}
          onFieldsChange={(id, fields) => { setConfiguration(current => ({ ...current, documents: current.documents.map(document => document.id === id ? { ...document, fields } : document) })); setDirty(true); }} />
      </Card>
      <div className="signature-editor-actions">
        <span className="signature-batch-save-status" role="status">{dirty ? 'Há posições não salvas.' : 'Configuração salva.'}</span>
        <Button variant="secondary" size="sm" disabled={busy || !dirty} loading={saveMutation.isPending} onClick={async () => {
          try { await save(); showToast('Campos salvos.', 'success'); } catch (error) { showToast(error instanceof Error ? error.message : 'Não foi possível salvar os campos.', 'error'); }
        }}>Salvar campos</Button>
        <span data-signature-publish><Button variant="primary" size="sm" disabled={busy || !configuration.signers.length} onClick={() => { setIssues([]); setPublishOpen(true); }}>Publicar lote</Button></span>
      </div>
      <PublishDialog open={publishOpen} signers={previewSigners} pending={busy} issues={issues}
        onClose={() => { if (!busy) setPublishOpen(false); }} onPublish={publish} batchDocumentCount={batch.documents.length} />
    </div>
  </section>;
}

export function BatchSetupView({ batchId, onBack, onOpenDocument, onViewed }: { batchId: string; onBack: () => void; onOpenDocument: (id: string) => void; onViewed?: (id: string, signed: number) => void }) {
  const query = useQuery({ queryKey: ['assinaturas', 'batch', batchId], queryFn: () => getSignatureBatch(batchId), refetchOnWindowFocus: false, gcTime: 0, refetchInterval: query => query.state.data?.documents.some(document => document.status === 'FINALIZANDO') ? 2000 : query.state.data?.documents.some(document => document.status === 'AGUARDANDO_ASSINATURAS') ? 15000 : false });
  useEffect(() => {
    if (query.data) onViewed?.(batchId, query.data.documents.reduce((sum, document) => sum + document.progress.signed, 0));
  }, [batchId, query.data, onViewed]);
  if (query.isLoading) return <div className="fv-ds"><Skeleton variant="card" label="Carregando lote..." /></div>;
  if (!query.data || query.isError) return <div className="fv-ds"><Button variant="secondary" onClick={onBack}>Voltar</Button><EmptyState variant="error" title="Não foi possível carregar o lote." action={{ label: 'Tentar novamente', onClick: () => void query.refetch() }} /></div>;
  if (!query.data.documents.every(document => document.status === 'RASCUNHO' && !document.archivedAt)) return <BatchTrackingView batch={query.data} onBack={onBack} onOpenDocument={onOpenDocument} />;
  return <BatchEditor key={batchId} batch={query.data} onBack={onBack} />;
}
