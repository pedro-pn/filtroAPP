import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AppIcon } from '../src/components/icons/AppIcon';
import { Button } from '../src/components/ui/ds';

export function PreviewDisclosure({ label, compact = false, children }: { label: string; compact?: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
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
  }, []);
  return <div className={`preview-disclosure${compact ? ' is-compact' : ''}`}>
    <Button size="sm" variant="secondary" aria-expanded={expanded} aria-controls={id}
      iconRight={<AppIcon icon={expanded ? ChevronUp : ChevronDown} size="sm" />}
      onClick={() => setExpanded(value => !value)}>{label}</Button>
    <div ref={content} id={id} className="preview-disclosure-content" hidden={!expanded}>{children}</div>
  </div>;
}
