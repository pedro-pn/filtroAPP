import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Modal } from '../../components/ui/Modal';
import type { Project } from '../../types/domain';
import { HistoricalServicesContent } from './HistoricalServicesModal';

const tabs = [{ id: 'pdf', label: 'PDFs antigos' }, { id: 'services', label: 'Serviços históricos' }] as const;
type UploadTab = typeof tabs[number]['id'];

export function LegacyReportsUploadModal({ replacing, submitting, projects, projectId, onProjectChange, onClose, footer, children }: {
  replacing: boolean;
  submitting: boolean;
  projects: Project[];
  projectId: string;
  onProjectChange: (projectId: string) => void;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<UploadTab>('pdf');
  const [historicalBusy, setHistoricalBusy] = useState(false);
  const busy = submitting || historicalBusy;

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (busy) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
    if (next === null) return;
    event.preventDefault();
    setActiveTab(tabs[next].id);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#legacy-upload-tab-${tabs[next].id}`)?.focus();
  }

  return <Modal open onClose={() => { if (!busy) onClose(); }} closeOnEscape={!busy}
    appearance="design-system" size="lg" fullscreenOnMobile={false}
    backdropClassName="rdo-manager-manual-report-dialog-backdrop"
    panelClassName="rdo-manager-manual-report-dialog legacy-reports-modal"
    title={replacing ? 'Editar relatório manual' : 'Upload de relatórios antigos'} footer={activeTab === 'pdf' || replacing ? footer : undefined}>
    {!replacing && <div className="legacy-upload-tabs" role="tablist" aria-label="Tipo de importação">
      {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab"
        id={`legacy-upload-tab-${tab.id}`} aria-controls={`legacy-upload-panel-${tab.id}`}
        aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} disabled={busy}
        onClick={() => setActiveTab(tab.id)} onKeyDown={event => navigateTabs(event, index)}>{tab.label}</button>)}
    </div>}
    <div id="legacy-upload-panel-pdf" role={replacing ? undefined : 'tabpanel'}
      aria-labelledby={replacing ? undefined : 'legacy-upload-tab-pdf'} hidden={!replacing && activeTab !== 'pdf'} inert={!replacing && activeTab !== 'pdf'}>
      {!replacing && <p className="historical-help legacy-upload-description">Adicione PDFs emitidos antes do app, com seus dados e informações de assinatura.</p>}
      {children}
    </div>
    {!replacing && <div id="legacy-upload-panel-services" role="tabpanel" aria-labelledby="legacy-upload-tab-services"
      hidden={activeTab !== 'services'} inert={activeTab !== 'services'}>
      <HistoricalServicesContent key={projectId} projects={projects} projectId={projectId}
        onProjectChange={onProjectChange} onBusyChange={setHistoricalBusy} />
    </div>}
  </Modal>;
}
