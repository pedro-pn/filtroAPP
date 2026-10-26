import { useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask, type RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { AppIcon } from '../icons/AppIcon';
import { Spinner } from './ds/Spinner';
import { DS_ICONS } from './ds/icons';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Limita a memória usada quando há vários PDFs grandes na mesma lista.
let thumbnailQueue: Promise<void> = Promise.resolve();

export function PdfThumbnail({ href }: { href: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let renderTask: RenderTask | null = null;
    setStatus('loading');

    async function destroyDocument() {
      const task = loadingTask;
      loadingTask = null;
      await task?.destroy().catch(() => undefined);
    }

    const job = thumbnailQueue.then(async () => {
      if (cancelled) return;
      try {
        // Usa o mesmo blob autenticado do link, sem baixar o anexo novamente.
        loadingTask = getDocument({ url: href, verbosity: 0 });
        const document = await loadingTask.promise;
        if (cancelled) return;
        const page = await document.getPage(1);
        if (cancelled) return;
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(88 / original.width, 128 / original.height) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTask = page.render({ canvas, viewport, background: '#ffffff' });
        await renderTask.promise;
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      } finally {
        await destroyDocument();
      }
    });
    thumbnailQueue = job.catch(() => undefined);

    return () => {
      cancelled = true;
      renderTask?.cancel();
      void destroyDocument();
    };
  }, [href]);

  return <span
    className="upload-list-thumb upload-list-thumb--pdf"
    data-pdf-preview-state={status}
    title={status === 'error' ? 'Prévia indisponível. Clique para abrir o PDF.' : 'Primeira página do PDF'}
  >
    <canvas ref={canvasRef} hidden={status !== 'ready'} role="img" aria-label="Prévia da primeira página do PDF" />
    {status === 'loading' ? <Spinner size="sm" decorative /> : null}
    {status === 'error' ? <AppIcon icon={DS_ICONS.fileText} size="md" /> : null}
  </span>;
}
