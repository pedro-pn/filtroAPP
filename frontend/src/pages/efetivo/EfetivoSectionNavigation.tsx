import type { KeyboardEvent } from 'react';

import { Field, Select } from '../../components/ui/ds';
import type { EfetivoPlanningSection } from '../../utils/planningNavigation';
import type { EfetivoSectionDefinition } from './EfetivoAppShell';

interface EfetivoSectionNavigationProps {
  current: EfetivoPlanningSection;
  sections: readonly EfetivoSectionDefinition[];
  pendingMissions: number;
  onNavigate: (section: EfetivoPlanningSection) => void;
}

export function EfetivoSectionNavigation({
  current,
  sections,
  pendingMissions,
  onNavigate
}: EfetivoSectionNavigationProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      return;
    }

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '.efetivo-section-nav__item'
      )
    );
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : activeIndex < 0
            ? 0
            : (activeIndex +
                (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) +
                items.length) %
              items.length;

    event.preventDefault();
    items[nextIndex]?.focus();
  }

  return (
    <nav
      className="efetivo-section-nav"
      aria-label="Áreas de Efetivo Operacional"
      data-efetivo-nav
    >
      <div
        className="efetivo-section-nav__items"
        role="group"
        aria-label="Áreas de Efetivo Operacional"
        onKeyDown={handleKeyDown}
      >
        {sections.map(section => {
          const active = section.id === current;
          return (
            <button
              className={`efetivo-section-nav__item${active ? ' is-active' : ''}`}
              type="button"
              key={section.id}
              aria-current={active ? 'page' : undefined}
              aria-pressed={active}
              title={section.description}
              onClick={() => {
                if (!active) onNavigate(section.id);
              }}
            >
              <span>{section.label}</span>
              {section.id === 'missoes' && pendingMissions ? (
                <strong aria-label={`${pendingMissions} missões com pendências`}>
                  {pendingMissions}
                </strong>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="efetivo-section-nav__mobile">
        <Field id="efetivo-section" label="Seção do módulo" optionalText="">
          <Select
            size="sm"
            value={current}
            onChange={event => onNavigate(event.target.value as EfetivoPlanningSection)}
          >
            {sections.map(section => (
              <option value={section.id} key={section.id}>
                {section.label}
                {section.id === 'missoes' && pendingMissions
                  ? ` (${pendingMissions} pendências)`
                  : ''}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </nav>
  );
}
