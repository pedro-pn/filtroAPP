import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import type { ProjectDetailTab } from './projectDetailPreferences';
import './ProjectDetailTabs.css';

export interface ProjectDetailTabItem { key: ProjectDetailTab; label: string; count?: number | null; content: ReactNode }

/**
 * Painel do projeto (camada 3 do dashboard): equipe, financeiro, qualidade, recursos
 * e avanço diário em abas. Sem aba escolhida, mostra só a barra e uma orientação.
 */
export function ProjectDetailTabs({ tabs, selected, onSelect }: {
  tabs: ProjectDetailTabItem[];
  selected: ProjectDetailTab | null;
  onSelect: (tab: ProjectDetailTab) => void;
}) {
  const id = useId();
  const buttons = useRef(new Map<ProjectDetailTab, HTMLButtonElement>());
  const active = tabs.find(tab => tab.key === selected) ?? null;
  const focusable = active?.key ?? tabs[0]?.key;

  function selectByKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
    if (next == null) return;
    event.preventDefault();
    onSelect(tabs[next].key);
    buttons.current.get(tabs[next].key)?.focus();
  }

  if (!tabs.length) return null;
  return <section className="acp-detail-tabs" aria-label="Painel do projeto" data-acp-detail-tabs>
    <div className="acp-detail-tabs__list" role="tablist" aria-label="Painel do projeto">
      {tabs.map((tab, index) => <button key={tab.key} type="button" role="tab" id={`${id}-tab-${tab.key}`}
        ref={element => { if (element) buttons.current.set(tab.key, element); else buttons.current.delete(tab.key); }}
        className="acp-detail-tabs__tab" aria-selected={tab.key === active?.key} aria-controls={active ? `${id}-panel` : undefined}
        tabIndex={tab.key === focusable ? 0 : -1} data-acp-detail-tab={tab.key}
        onKeyDown={event => selectByKeyboard(event, index)} onClick={() => onSelect(tab.key)}>
        {tab.label}{tab.count != null ? <span className="acp-detail-tabs__count">{tab.count}</span> : null}
      </button>)}
    </div>
    {active ? <div className="acp-detail-tabs__panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${active.key}`}>
      {active.content}
    </div> : <p className="acp-detail-tabs__hint">Equipe, financeiro, qualidade, recursos e avanço diário do projeto. Escolha uma aba para abrir.</p>}
  </section>;
}
