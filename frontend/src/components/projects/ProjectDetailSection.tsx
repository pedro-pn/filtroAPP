import { useRef, type ReactNode } from 'react';
import './ProjectDetailSection.css';
import { ChevronRight } from 'lucide-react';
import { AppIcon } from '../icons/AppIcon';

export function ProjectDetailSection({ label, header, children, defaultOpen = true, collapsible = true }: {
  label: string;
  header: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  if (!collapsible) return <>{header}{children}</>;
  return <details ref={details} className="acp-detail-collapsible" data-acp-detail-section open={defaultOpen}>
    <summary className="acp-detail-section-summary" aria-label={label} onClickCapture={event => {
      // Ações do cabeçalho abrem o conteúdo antes de exibir seu formulário.
      if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) {
        if (details.current) details.current.open = true;
      }
    }}>
      <div className="acp-detail-section-heading">{header}</div>
      <AppIcon className="acp-detail-section-chevron" icon={ChevronRight} size="sm" />
    </summary>
    <div className="acp-detail-section-content">{children}</div>
  </details>;
}
