import { useEffect, useRef, useState } from 'react';
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function PdfCanvasViewer({ blob }: { blob: Blob }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => setContainerWidth(container.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    setLoading(true);
    setError(null);
    setDocumentProxy(null);
    setPageNumber(1);
    setZoom(1);

    void blob.arrayBuffer()
      .then(data => {
        if (cancelled) return null;
        loadingTask = getDocument({ data });
        return loadingTask.promise;
      })
      .then(pdf => {
        if (!pdf || cancelled) return;
        setDocumentProxy(pdf);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Não foi possível exibir este PDF. Use a opção Baixar PDF.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [blob]);

  useEffect(() => {
    if (!documentProxy || !containerWidth) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    setRendering(true);
    setError(null);

    void documentProxy.getPage(pageNumber)
      .then(page => {
        if (cancelled) return null;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.max(0.25, (containerWidth - 32) / baseViewport.width);
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
        });
        return renderTask.promise;
      })
      .then(() => {
        if (!cancelled) setRendering(false);
      })
      .catch(renderError => {
        if (cancelled || renderError?.name === 'RenderingCancelledException') return;
        setError('Não foi possível renderizar esta página. Use a opção Baixar PDF.');
        setRendering(false);
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [containerWidth, documentProxy, pageNumber, zoom]);

  const pageCount = documentProxy?.numPages ?? 0;

  return (
    <div className="acp-pdf-canvas-viewer">
      <div className="acp-pdf-canvas-toolbar" aria-label="Controles do visualizador de PDF">
        <div className="acp-pdf-canvas-control-group">
          <button
            type="button"
            className="mini-btn alt"
            disabled={!documentProxy || pageNumber <= 1}
            onClick={() => setPageNumber(current => Math.max(1, current - 1))}
          >
            ← Anterior
          </button>
          <span>Página {pageNumber} de {pageCount || '—'}</span>
          <button
            type="button"
            className="mini-btn alt"
            disabled={!documentProxy || pageNumber >= pageCount}
            onClick={() => setPageNumber(current => Math.min(pageCount, current + 1))}
          >
            Próxima →
          </button>
        </div>
        <div className="acp-pdf-canvas-control-group">
          <button
            type="button"
            className="mini-btn alt"
            aria-label="Diminuir zoom"
            disabled={!documentProxy || zoom <= 0.5}
            onClick={() => setZoom(current => Math.max(0.5, current - 0.25))}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="mini-btn alt"
            aria-label="Aumentar zoom"
            disabled={!documentProxy || zoom >= 2}
            onClick={() => setZoom(current => Math.min(2, current + 0.25))}
          >
            +
          </button>
        </div>
      </div>
      <div ref={containerRef} className="acp-pdf-canvas-stage">
        {loading ? <div className="acp-pdf-viewer-loading">Carregando PDF...</div> : null}
        {error ? <div className="acp-pdf-viewer-error">{error}</div> : null}
        {rendering && !error ? <div className="acp-pdf-rendering">Renderizando página...</div> : null}
        <canvas ref={canvasRef} className="acp-pdf-canvas" aria-label={`Página ${pageNumber} do PDF`} />
      </div>
    </div>
  );
}
