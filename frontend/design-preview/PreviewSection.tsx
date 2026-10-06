import { useRef, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { AppIcon } from '../src/components/icons/AppIcon';

export function PreviewSection({ label, header, children, defaultOpen = true }: {
  label: string;
  header: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  return <details ref={details} className="preview-section" data-preview-section open={defaultOpen}>
    <summary className="preview-section-summary" aria-label={label} onClickCapture={event => {
      // Ações do cabeçalho abrem o conteúdo antes de exibir seu formulário.
      if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) {
        if (details.current) details.current.open = true;
      }
    }}>
      <div className="preview-section-heading">{header}</div>
      <AppIcon className="preview-section-chevron" icon={ChevronRight} size="sm" />
    </summary>
    <div className="preview-section-content">{children}</div>
  </details>;
}
