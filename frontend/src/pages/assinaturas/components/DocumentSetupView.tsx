import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../../../api/client';
import { downloadSignaturePage, type SignatureDocument, type SignatureField } from '../../../api/assinaturas';
import { useAuth } from '../../../auth/AuthContext';
import { DraftSaveStatus, type DraftSaveStatusValue } from '../../../components/reports/DraftSaveStatus';
import { Alert, Badge, Button, Card } from '../../../components/ui/ds';
import { useAssinaturaMutations } from '../../../hooks/useAssinaturas';
import { PdfPageCanvas } from './PdfPageCanvas';
import { PublishDialog } from './PublishDialog';
import { SignerList } from './SignerList';
import { SignatureDocumentPreview } from './SignatureDocumentPreview';
import '../AssinaturasPreparation.ds.css';

export function DocumentSetupView({
  document,
  pageNumber
}: {
  document: SignatureDocument;
  pageNumber: number;
  onPageChange?: (page: number) => void;
}) {
  const { user } = useAuth();
  const mutations = useAssinaturaMutations();
  const [fields, setFields] = useState<SignatureField[]>(document.fields || []);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishIssues, setPublishIssues] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatusValue>('idle');

  useEffect(() => {
    setFields(document.fields || []);
    setFieldsDirty(false);
  }, [document.fields]);
  const loadPage = useCallback((page: number, signal: AbortSignal) => downloadSignaturePage(document.id, page, signal), [document.id]);

  const missingFields = useMemo(() => document.signers
    .filter(signer => !fields.some(field => field.signerId === signer.id))
    .map(signer => `${signer.name} não tem campo de assinatura.`), [document.signers, fields]);

  async function saveFields() {
    if (!fieldsDirty) return true;
    setSaveStatus('saving');
    try {
      await mutations.replaceFields.mutateAsync({ id: document.id, fields });
      setFieldsDirty(false);
      setSaveStatus('saved');
      return true;
    } catch {
      setSaveStatus('error');
      return false;
    }
  }

  async function publish(expiry: { expiresInDays: number } | { expiresAt: string }) {
    setPublishIssues([]);
    try {
      if (missingFields.length) {
        setPublishIssues(missingFields);
        return;
      }
      const fieldsSaved = await saveFields();
      if (!fieldsSaved) {
        setPublishIssues(['Não foi possível salvar os campos de assinatura antes de publicar.']);
        return;
      }
      await mutations.publish.mutateAsync({ id: document.id, expiry });
      setPublishOpen(false);
    } catch (error) {
      setPublishIssues(error instanceof ApiClientError && error.issues?.length ? error.issues : [error instanceof Error ? error.message : 'Não foi possível publicar.']);
    }
  }

  return (
    <div className="fv-ds signature-setup-layout assinaturas-setup">
      <SignerList
        signers={document.signers}
        account={user}
        saving={mutations.replaceSigners.isPending}
        onSave={async signers => {
          await mutations.replaceSigners.mutateAsync({ id: document.id, signers });
          setFields([]);
          setFieldsDirty(false);
        }}
      />
      <Card className="signature-editor-panel" padding="md" title={<h2>Campos de assinatura</h2>}>
        <div className="signature-editor-toolbar">
          <span>{document.pageCount} página(s) · Role para percorrer o documento completo.</span>
        </div>
        {!document.signers.length
          ? <Alert tone="info">Adicione um assinante para posicionar o campo.</Alert>
          : <p className="signature-editor-hint">{document.signers.length === 1
            ? `Clique no documento para posicionar o campo de ${document.signers[0].name}.`
            : 'Clique no documento e escolha o assinante para posicionar o campo.'}</p>}
        {missingFields.length ? <Badge tone="warning">{missingFields.length} assinante(s) ainda sem campo</Badge> : null}
        <SignatureDocumentPreview key={document.id} pageCount={document.pageCount} initialPage={pageNumber}
          dimensions={document.pageDimensions} loadPage={loadPage}
          renderPage={page => <PdfPageCanvas {...page} embedded signers={document.signers} fields={fields}
            onFieldsChange={next => { setFields(next); setFieldsDirty(true); setSaveStatus('idle'); }} />} />
        <div className="assinaturas-setup__save-status" aria-live="polite"><DraftSaveStatus status={saveStatus} visible={saveStatus !== 'idle'} /></div>
        <div className="signature-editor-actions">
          <Button variant="secondary" size="sm" loading={mutations.replaceFields.isPending} disabled={mutations.replaceFields.isPending || !fieldsDirty} onClick={saveFields}>{fieldsDirty ? 'Salvar campos' : 'Campos salvos'}</Button>
          <span data-signature-publish><Button variant="primary" size="sm" disabled={!document.signers.length || mutations.replaceFields.isPending} onClick={() => setPublishOpen(true)}>Publicar</Button></span>
        </div>
      </Card>
      <PublishDialog
        open={publishOpen}
        signers={document.signers}
        pending={mutations.publish.isPending}
        issues={publishIssues}
        onClose={() => setPublishOpen(false)}
        onPublish={publish}
      />
    </div>
  );
}
