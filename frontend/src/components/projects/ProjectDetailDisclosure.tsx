import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './ProjectDetailSection.css';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AppIcon } from '../icons/AppIcon';
import { Button } from '../ui/ds';

export function ProjectDetailDisclosure({ label, compact = false, disabled = false, children }: { label: string; compact?: boolean; disabled?: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (disabled) return;
    const followExistingShortcut = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest('a[href^="#"]');
      const targetId = anchor?.getAttribute('href')?.slice(1);
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target || !content.current?.contains(target)) return;
      event.preventDefault();
      setExpanded(true);
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
    };
    document.addEventListener('click', followExistingShortcut);
    return () => document.removeEventListener('click', followExistingShortcut);
  }, [disabled]);
  if (disabled) return <>{children}</>;
  return <div className={`acp-detail-disclosure${compact ? ' is-compact' : ''}`}>
    <Button size="sm" variant="secondary" aria-expanded={expanded} aria-controls={id}
      iconRight={<AppIcon icon={expanded ? ChevronUp : ChevronDown} size="sm" />}
      onClick={() => setExpanded(value => !value)}>{label}</Button>
    <div ref={content} id={id} className="acp-detail-disclosure-content" hidden={!expanded}>{children}</div>
  </div>;
}
