import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { Button } from '../../../components/ui/Button';
import { sequentialSignaturePageLoader, type SignaturePageLoader } from '../utils/preview';

type PageContent = { imageUrl: string; pageNumber: number; onImageError: () => void };
type PageDimension = { page: number; widthPt: number; heightPt: number; rotation: number };

function PreviewPage({ pageNumber, pageCount, loadPage, renderPage, scrollRef, dimension }: {
  pageNumber: number;
  pageCount: number;
  loadPage: SignaturePageLoader;
  renderPage: (page: PageContent) => ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  dimension?: PageDimension;
}) {
  const pageRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { root: scrollRef.current, rootMargin: '25% 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRef]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let url = '';
    setImageUrl('');
    setError(false);
    void loadPage(pageNumber, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setImageUrl(url);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [loadPage, pageNumber, visible, attempt]);
  const rotated = dimension && dimension.rotation % 180 !== 0;
  const aspectRatio = dimension
    ? `${rotated ? dimension.heightPt : dimension.widthPt} / ${rotated ? dimension.widthPt : dimension.heightPt}`
    : '210 / 297';

  return (
    <section ref={pageRef} className="signature-preview-page" data-page-number={pageNumber} aria-label={`Página ${pageNumber} de ${pageCount}`}>
      <div className="signature-preview-page-label">Página {pageNumber} de {pageCount}</div>
      {imageUrl && !error ? renderPage({ imageUrl, pageNumber, onImageError: () => setError(true) }) : (
        <div className="signature-preview-placeholder" style={{ aspectRatio }}>
          {error ? <div className="signature-preview-error" role="alert">
            <p>Não foi possível exibir a página {pageNumber}.</p>
            <Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>Tentar novamente</Button>
          </div> : <p role="status">{visible ? `Carregando página ${pageNumber}…` : `Página ${pageNumber}`}</p>}
        </div>
      )}
    </section>
  );
}

export function SignatureDocumentPreview({ pageCount, initialPage = 1, dimensions = [], loadPage, renderPage }: {
  pageCount: number;
  initialPage?: number;
  dimensions?: PageDimension[];
  loadPage: SignaturePageLoader;
  renderPage: (page: PageContent) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const queuedLoadPage = useMemo(() => sequentialSignaturePageLoader(loadPage), [loadPage]);
  useEffect(() => {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-page-number="${Math.max(1, Math.min(pageCount, initialPage))}"]`);
    if (container && target) container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  }, [initialPage, pageCount]);
  return (
    <div className="signature-pdf-scroll" ref={scrollRef} role="region" aria-label="Documento completo" tabIndex={0}>
      <div className="signature-document-pages">
        {Array.from({ length: pageCount }, (_, index) => <PreviewPage
          key={index + 1}
          pageNumber={index + 1}
          pageCount={pageCount}
          scrollRef={scrollRef}
          dimension={dimensions.find(dimension => dimension.page === index + 1)}
          loadPage={queuedLoadPage}
          renderPage={renderPage}
        />)}
      </div>
    </div>
  );
}
