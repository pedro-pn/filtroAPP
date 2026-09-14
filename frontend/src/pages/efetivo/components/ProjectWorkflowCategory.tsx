import { useState, type DetailsHTMLAttributes, type ReactNode } from 'react';

export function ProjectWorkflowCategory({
  title,
  description,
  status,
  complete = false,
  initiallyOpen,
  className = '',
  children,
  ...detailsProps
}: Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'title' | 'open' | 'onToggle'> & {
  title: string;
  description?: string;
  status?: ReactNode;
  complete?: boolean;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen ?? !complete);
  return (
    <details
      {...detailsProps}
      className={['project-workflow-category', complete ? 'is-complete' : '', className].filter(Boolean).join(' ')}
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary>
        <div>
          <h4>{title}</h4>
          {description ? <p>{description}</p> : null}
        </div>
        <span className="project-workflow-category-status">{status}</span>
        <span className="project-workflow-category-toggle" aria-hidden="true">⌄</span>
      </summary>
      <div className="project-workflow-category-content">{children}</div>
    </details>
  );
}
