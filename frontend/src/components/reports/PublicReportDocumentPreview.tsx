import { useCallback, useEffect, useId, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { SignatureDocumentPreview } from '../../pages/assinaturas/components/SignatureDocumentPreview';
import { BrandLoading } from '../brand/BrandLoading';
import { Alert } from '../ui/ds';

export function PublicReportDocumentPreview({ pdfUrl, title }: { pdfUrl: string; title: string }) {
  const titleId = useId();
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let loadingTask: PDFDocumentLoadingTask | undefined;
    setPdf(null);
    setError(false);

    void (async () => {
      const [pdfjs, response] = await Promise.all([
        import('pdfjs-dist'),
        fetch(pdfUrl, { signal: controller.signal, cache: 'no-store' })
      ]);
      if (!response.ok) throw new Error('PDF indisponível.');
      const data = await response.arrayBuffer();
      controller.signal.throwIfAborted();
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      loadingTask = pdfjs.getDocument({ data });
      const document = await loadingTask.promise;
      if (!controller.signal.aborted) setPdf(document);
    })().catch(() => {
      if (!controller.signal.aborted) setError(true);
    });

    return () => {
      controller.abort();
      void loadingTask?.destroy().catch(() => {});
    };
  }, [pdfUrl, attempt]);

  const loadPage = useCallback(async (pageNumber: number, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!pdf) throw new Error('Documento indisponível.');
    const page = await pdf.getPage(pageNumber);
    const canvas = document.createElement('canvas');
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1400 / base.width, Math.sqrt(8_000_000 / (base.width * base.height)));
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const render = page.render({ canvas, viewport });
    const cancel = () => render.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) render.cancel();
      await render.promise;
      signal.throwIfAborted();
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('Página indisponível.')), 'image/png');
      });
      signal.throwIfAborted();
      return blob;
    } finally {
      signal.removeEventListener('abort', cancel);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  }, [pdf]);

  return (
    <section className="public-report-document" aria-labelledby={titleId}>
      <div className="public-report-document__heading">
        <h2 id={titleId}>Prévia do documento</h2>
        {pdf ? <span>{pdf.numPages} página{pdf.numPages !== 1 ? 's' : ''}</span> : null}
      </div>
      <p className="public-report-document__hint">Role para conferir todas as páginas do documento.</p>
      {error ? (
        <Alert tone="warning" title="Não foi possível carregar a prévia." action={{ label: 'Tentar novamente', onClick: () => setAttempt(value => value + 1) }}>
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer">Abrir PDF em outra aba</a>
        </Alert>
      ) : pdf ? (
        <SignatureDocumentPreview pageCount={pdf.numPages} loadPage={loadPage}
          renderPage={({ imageUrl, pageNumber, onImageError }) => (
            <div className="public-report-document__paper">
              <img src={imageUrl} alt={`Página ${pageNumber} de ${pdf.numPages} do ${title}`} onError={onImageError} />
            </div>
          )} />
      ) : <div className="public-report-document__loading"><BrandLoading size="md" label="Carregando documento" /></div>}
    </section>
  );
}
