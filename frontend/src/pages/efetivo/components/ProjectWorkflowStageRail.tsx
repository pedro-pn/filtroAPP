import { Fragment, useEffect, useState, type RefObject } from 'react';

import type { StageSectionEntry } from '../../../utils/projectWorkflowStageSections';
import { ProjectWorkflowIcon } from './ProjectWorkflowIcon';

const RING_RADIUS = 7;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

// Posição da seção dentro da área rolável, independente de quem é o offsetParent no DOM.
function sectionOffset(container: HTMLElement, node: HTMLElement) {
  return node.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

function ProgressRing({ ratio }: { ratio: number }) {
  const clamped = Math.min(1, Math.max(0, ratio));
  return (
    <svg className="project-workflow-stage-rail-ring" viewBox="0 0 20 20" aria-hidden="true">
      <circle className="is-track" cx="10" cy="10" r={RING_RADIUS} />
      <circle className="is-value" cx="10" cy="10" r={RING_RADIUS} strokeDasharray={RING_LENGTH} strokeDashoffset={RING_LENGTH * (1 - clamped)} />
    </svg>
  );
}

// Índice lateral da etapa: leva direto à seção, abre a que estiver recolhida e acompanha a rolagem.
export function ProjectWorkflowStageRail({ sections, scrollRef, blockers, defaultGroup }: {
  sections: StageSectionEntry[];
  defaultGroup: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  blockers: { title: string; items: string[] } | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !sections.length) return;
    const sync = () => {
      const limit = container.scrollTop + 28;
      let current = sections[0].id;
      for (const section of sections) {
        if (sectionOffset(container, section.node) <= limit) current = section.id;
      }
      setActiveId(current);
    };
    sync();
    container.addEventListener('scroll', sync, { passive: true });
    return () => container.removeEventListener('scroll', sync);
  }, [sections, scrollRef]);

  if (!sections.length) return null;

  const goTo = (section: StageSectionEntry) => {
    section.open();
    setActiveId(section.id);
    const container = scrollRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTo({ top: Math.max(0, sectionOffset(container, section.node) - 12), behavior: 'smooth' });
    });
  };

  return (
    <nav className="project-workflow-stage-rail" aria-label="Seções desta etapa">
      {sections.map((section, index) => (
        <Fragment key={section.id}>
          {index === 0 || sections[index - 1].group !== section.group
            ? <p className="project-workflow-stage-rail-title">{section.group || defaultGroup}</p>
            : null}
          <button
            className={`project-workflow-stage-rail-item is-${section.tone}${activeId === section.id ? ' is-active' : ''}`}
            type="button"
            aria-current={activeId === section.id ? 'true' : undefined}
            onClick={() => goTo(section)}
          >
            <ProgressRing ratio={section.ratio} />
            <span>{section.label}</span>
            {section.count ? <b>{section.count}</b> : null}
          </button>
        </Fragment>
      ))}
      {blockers ? <div className="project-workflow-stage-rail-gate">
        <strong><ProjectWorkflowIcon name="lock" />{blockers.title}</strong>
        <ul>{blockers.items.map(item => <li key={item}>{item}</li>)}</ul>
      </div> : null}
    </nav>
  );
}
