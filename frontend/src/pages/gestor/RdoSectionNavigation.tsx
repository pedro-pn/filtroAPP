import type { CSSProperties, KeyboardEvent } from 'react';

import {
  RDO_MANAGER_SECTIONS,
  type RdoManagerSection
} from './rdoSectionNavigationModel';

export interface RdoSectionNavigationItem<Section extends string = string> {
  id: Section;
  label: string;
}

interface RdoSectionNavigationProps<Section extends string = RdoManagerSection> {
  current: Section;
  onNavigate: (section: Section) => void;
  sections?: readonly RdoSectionNavigationItem<Section>[];
  ariaLabel?: string;
}

export function RdoSectionNavigation<Section extends string = RdoManagerSection>({
  current,
  onNavigate,
  sections,
  ariaLabel = 'Navegar nas áreas de Relatórios e Projetos'
}: RdoSectionNavigationProps<Section>) {
  const navigationSections = (sections || RDO_MANAGER_SECTIONS) as readonly RdoSectionNavigationItem<Section>[];
  const handleGroupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      ![
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End'
      ].includes(event.key)
    ) {
      return;
    }

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '.rdo-section-navigation__item'
      )
    );
    const activeIndex = items.indexOf(
      document.activeElement as HTMLButtonElement
    );
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : activeIndex < 0
            ? 0
            : (activeIndex +
                (event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                  ? -1
                  : 1) +
                items.length) %
              items.length;

    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return (
    <nav
      className="fv-ds rdo-section-navigation"
      aria-label={ariaLabel}
      style={{ '--rdo-section-count': navigationSections.length } as CSSProperties}
    >
      <div
        className="rdo-section-navigation__items"
        role="group"
        aria-label={ariaLabel}
        onKeyDown={handleGroupKeyDown}
      >
        {navigationSections.map((section) => {
          const active = section.id === current;
          return (
            <button
              className={`rdo-section-navigation__item${active ? ' is-active' : ''}`}
              key={section.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              aria-pressed={active}
              onClick={() => {
                if (!active) onNavigate(section.id);
              }}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
