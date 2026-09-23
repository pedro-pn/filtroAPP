import { useCallback, useMemo, useState, type DetailsHTMLAttributes, type ReactNode } from 'react';

import { PortalTip } from '../../../components/ui/PortalTip';
import { useStageSectionEntry, type StageSectionTone } from '../../../utils/projectWorkflowStageSections';
import { PROJECT_WORKFLOW_AREA_ICONS } from '../../../utils/projectWorkflowPresentation';
import { ProjectWorkflowIcon, type ProjectWorkflowIconName } from './ProjectWorkflowIcon';

function sectionSlug(title: string) {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'secao';
}

export function ProjectWorkflowCategory({
  title,
  description,
  status,
  area,
  icon,
  group,
  progress,
  tone,
  complete = false,
  initiallyOpen,
  className = '',
  children,
  ...detailsProps
}: Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'title' | 'open' | 'onToggle'> & {
  title: string;
  description?: string;
  status?: ReactNode;
  /** Área responsável pela frente, exibida como sobrelinha do título. */
  area?: string;
  /** Ícone do cabeçalho; sem ele, vale o ícone padrão da área. */
  icon?: ProjectWorkflowIconName;
  /** Grupo em que a seção aparece no índice da etapa. */
  group?: string;
  /** Alimenta o medidor do cabeçalho e o anel de progresso no índice da etapa. */
  progress?: { completed: number; total: number };
  /** Sobrepõe a cor derivada de `complete`/`progress` — use 'crit' para o que bloqueia o avanço. */
  tone?: StageSectionTone;
  complete?: boolean;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen ?? !complete);
  const sectionTone: StageSectionTone = tone
    ?? (complete ? 'ok' : progress && progress.completed > 0 ? 'warn' : 'idle');
  const completed = progress?.completed ?? null;
  const total = progress?.total ?? null;
  const percentage = total ? Math.round(((completed ?? 0) / total) * 100) : null;
  const meta = useMemo(() => ({
    id: `project-workflow-section-${sectionSlug(title)}`,
    label: title,
    tone: sectionTone,
    count: completed === null || total === null ? '' : `${completed}/${total}`,
    ratio: total ? (completed ?? 0) / total : sectionTone === 'ok' ? 1 : 0,
    group: group || ''
  }), [title, sectionTone, completed, total, group]);
  const nodeRef = useStageSectionEntry(meta, useCallback(() => setOpen(true), []));
  const iconName = icon || (area ? PROJECT_WORKFLOW_AREA_ICONS[area.split(' · ')[0]] : undefined) || 'clipboard';

  return (
    <details
      {...detailsProps}
      ref={nodeRef}
      id={meta.id}
      className={['project-workflow-category', `is-${sectionTone}`, complete ? 'is-complete' : '', className].filter(Boolean).join(' ')}
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="project-workflow-category-icon"><ProjectWorkflowIcon name={iconName} /></span>
        <div className="project-workflow-category-title">
          {area ? <p className="project-workflow-category-area">{area}</p> : null}
          <h4>
            {title}
            {description ? <PortalTip
              triggerClassName="project-workflow-category-help"
              ariaLabel={`Sobre ${title}`}
              balloonClassName="project-workflow-category-help-balloon"
              content={description}
            >
              <span onClick={event => { event.preventDefault(); event.stopPropagation(); }}><ProjectWorkflowIcon name="help" /></span>
            </PortalTip> : null}
          </h4>
        </div>
        {status ? <span className="project-workflow-category-status">{sectionTone === 'ok' ? <ProjectWorkflowIcon name="check" /> : null}{status}</span> : null}
        {percentage === null ? null : <span className="project-workflow-category-meter" aria-label={`${completed} de ${total} concluídos`}>
          <span aria-hidden="true"><i style={{ width: `${percentage}%` }} /></span>
          <b>{completed}/{total}</b>
        </span>}
        <ProjectWorkflowIcon name="chevron" className="project-workflow-category-toggle" />
      </summary>
      <div className="project-workflow-category-content">{children}</div>
    </details>
  );
}
