import { useState } from 'react';
import { PROJECT_DISTRIBUTION_CHANNELS, type ProjectDistributionSettings } from '../../../../shared/modules/project-distribution.js';
import { Modal } from '../ui/Modal';
import { Button, Switch } from '../ui/ds';
import './ProjectDistributionFields.css';

export function ProjectDistributionFields({ value, onChange }: {
  value: ProjectDistributionSettings;
  onChange: (value: ProjectDistributionSettings) => void;
}) {
  const [draft, setDraft] = useState<ProjectDistributionSettings | null>(null);
  return <>
    <Button type="button" variant="secondary" size="sm" onClick={() => setDraft({ ...value })}>
      Onde o projeto aparece / sincroniza
    </Button>
    <Modal open={draft !== null} onClose={() => setDraft(null)} appearance="design-system"
      title="Visibilidade e sincronização do projeto" size="md"
      footer={<>
        <Button type="button" variant="secondary" onClick={() => setDraft(null)}>Cancelar</Button>
        <Button type="button" onClick={() => { if (draft) onChange(draft); setDraft(null); }}>Aplicar ao formulário</Button>
      </>}>
      <p>O projeto permanece restrito a contas admin no app. Ative somente os destinos que podem receber seus dados.</p>
      <div className="project-distribution-fields">
        {PROJECT_DISTRIBUTION_CHANNELS.map(channel => <Switch key={channel.key}
          label={channel.label} description={channel.description} checked={draft?.[channel.key] ?? false}
          onChange={event => setDraft(current => current && ({ ...current, [channel.key]: event.target.checked }))} />)}
      </div>
      <p>As opções serão salvas ao salvar o projeto.</p>
    </Modal>
  </>;
}
