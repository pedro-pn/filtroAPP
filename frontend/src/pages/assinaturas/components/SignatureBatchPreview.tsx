import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { downloadSignaturePage, type SignatureDocument, type SignatureField, type SignatureSigner } from '../../../api/assinaturas';
import { AppIcon } from '../../../components/icons/AppIcon';
import { Button, Select } from '../../../components/ui/ds';
import { DS_ICONS } from '../../../components/ui/ds/icons';
import { sequentialSignaturePageLoader, type SignaturePageLoader } from '../utils/preview';
import { PdfPageCanvas } from './PdfPageCanvas';
import { PreviewPage, type PageContent } from './SignatureDocumentPreview';
import './SignatureBatchPreview.css';

type PreviewDocument = Pick<SignatureDocument, 'id' | 'title' | 'originalFileName' | 'pageCount' | 'pageDimensions'>;
type DocumentPageRenderer = (document: PreviewDocument, content: PageContent) => ReactNode;

function BatchPreviewDocument({ document, index, total, offset, scrollRef, loadPage, signers, fields, disabled, onFieldsChange, renderPage, revision }: {
  document: PreviewDocument; index: number; total: number; offset: number;
  scrollRef: RefObject<HTMLDivElement | null>; loadPage: SignaturePageLoader;
  signers: SignatureSigner[]; fields: SignatureField[]; disabled: boolean;
  onFieldsChange: (id: string, fields: SignatureField[]) => void;
  renderPage?: DocumentPageRenderer;
  revision?: string | number;
}) {
  const loadDocumentPage = useCallback((page: number, signal: AbortSignal) => loadPage(offset + page, signal), [loadPage, offset]);
  return <section className="signature-batch-document" data-document-id={document.id} aria-label={`Documento ${index + 1}: ${document.title}`}>
    <header className="signature-batch-document__header">
      <span>Documento {index + 1} de {total}</span>
      <h3>{document.title}</h3>
      <p>{document.originalFileName} · {document.pageCount} página(s) · {fields.length} campo(s)</p>
    </header>
    <div className="signature-document-pages">{Array.from({ length: document.pageCount }, (_, page) => <PreviewPage
      key={page + 1} pageNumber={page + 1} pageCount={document.pageCount} scrollRef={scrollRef}
      dimension={document.pageDimensions.find(dimension => dimension.page === page + 1)} loadPage={loadDocumentPage}
      revision={revision}
      renderPage={content => renderPage ? renderPage(document, content) : <PdfPageCanvas {...content} embedded signers={disabled ? [] : signers} fields={fields}
        onFieldsChange={next => { if (!disabled) onFieldsChange(document.id, next); }} />}
    />)}</div>
  </section>;
}

export function SignatureBatchPreview({ documents, signers, fieldsByDocument, disabled, onFieldsChange, loadDocumentPage = downloadSignaturePage, renderPage, revision }: {
  documents: PreviewDocument[]; signers: SignatureSigner[];
  fieldsByDocument: Array<{ id: string; fields: SignatureField[] }>;
  disabled: boolean;
  onFieldsChange: (id: string, fields: SignatureField[]) => void;
  loadDocumentPage?: (documentId: string, pageNumber: number, signal: AbortSignal) => Promise<Blob>;
  renderPage?: DocumentPageRenderer;
  revision?: string | number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const [activeDocumentId, setActiveDocumentId] = useState(documents[0]?.id || '');
  const activeIndex = Math.max(0, documents.findIndex(document => document.id === activeDocumentId));
  const activeDocument = documents[activeIndex];
  useEffect(() => () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
  }, []);

  function updateActiveDocument() {
    const container = scrollRef.current;
    if (!container) return;
    const sections = Array.from(container.children) as HTMLElement[];
    const readingTop = container.getBoundingClientRect().top + 48;
    const atEnd = container.scrollTop > 0 && container.scrollHeight - container.scrollTop - container.clientHeight <= 1;
    const active = atEnd ? sections.at(-1) : sections.find(section => section.getBoundingClientRect().bottom > readingTop);
    if (active?.dataset.documentId) setActiveDocumentId(active.dataset.documentId);
  }

  function trackScroll() {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      updateActiveDocument();
    });
  }

  function goToDocument(index: number) {
    const container = scrollRef.current;
    const target = container?.children.item(index);
    if (!container || !target || !documents[index]) return;
    // Move somente a prévia, preservando a posição dos controles na tela.
    container.scrollTo({ top: container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop });
    setActiveDocumentId(documents[index].id);
  }
  const { queuedLoadPage, offsets } = useMemo(() => {
    const pages: Array<{ documentId: string; pageNumber: number }> = [];
    const offsets = documents.map(document => {
      const offset = pages.length;
      for (let page = 1; page <= document.pageCount; page++) pages.push({ documentId: document.id, pageNumber: page });
      return offset;
    });
    return {
      offsets,
      queuedLoadPage: sequentialSignaturePageLoader((page, signal) => {
        const target = pages[page - 1];
        return loadDocumentPage(target.documentId, target.pageNumber, signal);
      })
    };
  }, [documents, loadDocumentPage]);
  return <div className="signature-batch-preview">
    {activeDocument ? <nav className="signature-batch-navigation" aria-label="Navegação entre documentos">
      <div className="signature-batch-navigation__identity" aria-live="polite" aria-atomic="true">
        <span>Documento {activeIndex + 1} de {documents.length}</span>
        <strong>{activeDocument.title}</strong>
        <p>{activeDocument.originalFileName} · {activeDocument.pageCount} página(s) · {fieldsByDocument.find(item => item.id === activeDocument.id)?.fields.length || 0} campo(s)</p>
      </div>
      <div className="signature-batch-navigation__controls">
        <Button variant="secondary" size="sm" aria-label="Documento anterior" disabled={activeIndex === 0}
          iconLeft={<AppIcon icon={DS_ICONS.previous} size="sm" />} onClick={() => goToDocument(activeIndex - 1)}>Anterior</Button>
        <Select size="sm" aria-label="Ir para documento" value={activeDocument.id} onChange={event => goToDocument(documents.findIndex(document => document.id === event.target.value))}>
          {documents.map((document, index) => <option key={document.id} value={document.id}>{index + 1}. {document.title}</option>)}
        </Select>
        <Button variant="secondary" size="sm" aria-label="Próximo documento" disabled={activeIndex === documents.length - 1}
          iconRight={<AppIcon icon={DS_ICONS.next} size="sm" />} onClick={() => goToDocument(activeIndex + 1)}>Próximo</Button>
      </div>
    </nav> : null}
    <div className="signature-pdf-scroll signature-batch-scroll" ref={scrollRef} role="region" aria-label="Documentos do lote" tabIndex={0} onScroll={trackScroll}>
      {documents.map((document, index) => <BatchPreviewDocument key={document.id} document={document} index={index} total={documents.length}
        offset={offsets[index]} scrollRef={scrollRef} loadPage={queuedLoadPage} signers={signers}
        fields={fieldsByDocument.find(item => item.id === document.id)?.fields || []} disabled={disabled} onFieldsChange={onFieldsChange} renderPage={renderPage} revision={revision} />)}
    </div>
  </div>;
}
