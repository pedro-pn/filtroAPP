import { useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { FileImage, FileText } from 'lucide-react';
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';

interface Props {
  file?: File;
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
}

function fileKind(fileName: string, mimeType: string) {
  const type = mimeType.toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(fileName)) return 'image';
  if (type === 'application/pdf' || /\.pdf$/i.test(fileName)) return 'pdf';
  return 'other';
}

export function QualityEvidenceThumbnail({ file, url, fileName, mimeType }: Props) {
  const name = file?.name || fileName || 'anexo da evidência';
  const kind = fileKind(name, file?.type || mimeType || '');
  const [localUrl, setLocalUrl] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const tooltipId = useId();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewUrl = file ? localUrl : url || '';

  function showFileName(event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const above = window.innerHeight - bounds.bottom < 80 && bounds.top > 80;
    setTooltipPosition({
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - Math.min(320, window.innerWidth - 16) - 8)),
      top: above ? bounds.top - 6 : bounds.bottom + 6,
      above
    });
  }

  const tooltip = tooltipPosition ? createPortal(
    <span id={tooltipId} className={`quality-evidence-filename-tooltip${tooltipPosition.above ? ' quality-evidence-filename-tooltip--above' : ''}`} role="tooltip" style={{ left: tooltipPosition.left, top: tooltipPosition.top }}>{name}</span>,
    document.body
  ) : null;

  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setLocalUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    if (kind !== 'pdf' || !previewUrl) return;
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let renderTask: RenderTask | null = null;

    async function renderFirstPage() {
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ]);
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const response = file ? null : await fetch(previewUrl);
      if (response && !response.ok) throw new Error('PDF indisponível');
      const bytes = file ? await file.arrayBuffer() : await response!.arrayBuffer();
      if (cancelled) return;
      loadingTask = pdfjs.getDocument({ data: bytes });
      const document = await loadingTask.promise;
      const page = await document.getPage(1);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const pageSize = page.getViewport({ scale: 1 });
      const scale = Math.min(100 / pageSize.width, 72 / pageSize.height);
      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(viewport.width * pixelRatio);
      canvas.height = Math.round(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = page.render({
        canvas,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0]
      });
      await renderTask.promise;
      if (!cancelled) setPdfReady(true);
    }

    void renderFirstPage().catch(() => { if (!cancelled) setPdfReady(false); });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [file, kind, previewUrl]);

  const thumbnail = (
    <span className="quality-evidence-thumb__frame" aria-hidden="true">
      {kind === 'image' && previewUrl && !imageFailed
        ? <img src={previewUrl} alt="" loading="lazy" onError={() => setImageFailed(true)} />
        : null}
      {kind === 'pdf' ? <canvas ref={canvasRef} className={pdfReady ? 'is-ready' : ''} /> : null}
      {(kind === 'pdf' && !pdfReady) || (kind === 'image' && (!previewUrl || imageFailed)) || kind === 'other'
        ? kind === 'image' ? <FileImage size={26} /> : <FileText size={26} />
        : null}
      {kind === 'pdf' ? <span className="quality-evidence-thumb__type">PDF</span> : null}
    </span>
  );

  return previewUrl ? (
    <a className="quality-evidence-thumb" href={previewUrl} target="_blank" rel="noreferrer" aria-label={`Abrir ${name}`} aria-describedby={tooltipPosition ? tooltipId : undefined} onMouseEnter={showFileName} onMouseLeave={() => setTooltipPosition(null)} onFocus={showFileName} onBlur={() => setTooltipPosition(null)}>
      {thumbnail}
      {tooltip}
    </a>
  ) : (
    <span className="quality-evidence-thumb" role="img" aria-label={name} aria-describedby={tooltipPosition ? tooltipId : undefined} tabIndex={0} onMouseEnter={showFileName} onMouseLeave={() => setTooltipPosition(null)} onFocus={showFileName} onBlur={() => setTooltipPosition(null)}>{thumbnail}{tooltip}</span>
  );
}
