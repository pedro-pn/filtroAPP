import { useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../../../api/client';
import { downloadSignaturePage, type SignatureDocument, type SignatureField } from '../../../api/assinaturas';
import { useAuth } from '../../../auth/AuthContext';
import { DraftSaveStatus, type DraftSaveStatusValue } from '../../../components/reports/DraftSaveStatus';
import { Button } from '../../../components/ui/Button';
import { useAssinaturaMutations } from '../../../hooks/useAssinaturas';
import { PdfPageCanvas } from './PdfPageCanvas';
import { PublishDialog } from './PublishDialog';
import { SignerList } from './SignerList';

export function DocumentSetupView({
  document,
  pageNumber,
  onPageChange
}: {
  document: SignatureDocument;
  pageNumber: number;
  onPageChange: (page: number) => void;
}) {
  const { user } = useAuth();
  const mutations = useAssinaturaMutations();
  const [fields, setFields] = useState<SignatureField[]>(document.fields || []);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishIssues, setPublishIssues] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatusValue>('idle');

  useEffect(() => {
    setFields(document.fields || []);
    setFieldsDirty(false);
  }, [document.fields]);
  useEffect(() => {
    if (pageNumber > document.pageCount) onPageChange(document.pageCount);
  }, [document.pageCount, onPageChange, pageNumber]);
  useEffect(() => {
    let disposed = false;
    let currentUrl = '';
    setImageUrl('');
    downloadSignaturePage(document.id, pageNumber).then(blob => {
      if (disposed) return;
      currentUrl = URL.createObjectURL(blob);
      setImageUrl(currentUrl);
    }).catch(() => {});
    return () => {
      disposed = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [document.id, pageNumber]);

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
    <div className="signature-setup-layout">
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
      <section className="signature-editor-panel">
        <div className="signature-editor-toolbar">
          <Button variant="secondary" disabled={pageNumber <= 1} onClick={() => onPageChange(pageNumber - 1)}>Anterior</Button>
          <span>Página {pageNumber} de {document.pageCount}</span>
          <Button variant="secondary" disabled={pageNumber >= document.pageCount} onClick={() => onPageChange(pageNumber + 1)}>Próxima</Button>
        </div>
        {!document.signers.length
          ? <p className="signature-inline-warning">Adicione um assinante para posicionar o campo.</p>
          : <p className="signature-editor-hint">{document.signers.length === 1
            ? `Clique no documento para posicionar o campo de ${document.signers[0].name}.`
            : 'Clique no documento e escolha o assinante para posicionar o campo.'}</p>}
        {missingFields.length ? <p className="signature-inline-warning">{missingFields.length} assinante(s) ainda sem campo.</p> : null}
        <PdfPageCanvas
          imageUrl={imageUrl}
          pageNumber={pageNumber}
          signers={document.signers}
          fields={fields}
          onFieldsChange={next => { setFields(next); setFieldsDirty(true); setSaveStatus('idle'); }}
        />
        <div className="signature-editor-actions">
          <DraftSaveStatus status={saveStatus} visible={saveStatus !== 'idle'} />
          <Button variant="secondary" disabled={mutations.replaceFields.isPending || !fieldsDirty} onClick={saveFields}>{fieldsDirty ? 'Salvar campos' : 'Campos salvos'}</Button>
          <span data-signature-publish><Button disabled={!document.signers.length || mutations.replaceFields.isPending} onClick={() => setPublishOpen(true)}>Publicar</Button></span>
        </div>
      </section>
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
