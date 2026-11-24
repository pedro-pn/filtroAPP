import { useState } from 'react';

import type { AllocationReviewKind, ReviewProject } from '../../../api/allocationReview';
import { Alert, Button, Select } from '../../../components/ui/ds';

interface Props {
  count: number;
  daysWithPointCount: number;
  projects: ReviewProject[];
  saving: boolean;
  onApply: (kind: AllocationReviewKind, projectIds: string[]) => void;
  onClear: () => void;
}

// Barra de ações para os dias selecionados (Shift/Ctrl + clique no desktop, modo de seleção no celular).
export function AllocationReviewBulkBar({ count, daysWithPointCount, projects, saving, onApply, onClear }: Props) {
  const [projectId, setProjectId] = useState('');
  if (!count) return null;
  return (
    <div className="allocation-review-bulk" role="region" aria-label="Ações para os dias selecionados">
      <span className="allocation-review-bulk__count">{count} dia{count > 1 ? 's' : ''} selecionado{count > 1 ? 's' : ''}</span>
      <div className="allocation-review-bulk__actions">
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => onApply('SEDE', [])}>Sede</Button>
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => onApply('FOLGA', [])}>Folga</Button>
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => onApply('FALTA', [])}>Falta</Button>
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => onApply('FERIAS', [])}>Férias</Button>
        <Select
          size="sm"
          aria-label="Definir projeto para os dias selecionados"
          value={projectId}
          disabled={saving}
          onChange={event => {
            const value = event.target.value;
            setProjectId('');
            if (value) onApply('PROJECT', [value]);
          }}
        >
          <option value="">Projeto…</option>
          {projects.filter(project => project.isActive).map(project => (
            <option key={project.id} value={project.id}>{project.code} · {project.clientName || project.name}</option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onClear}>Limpar seleção</Button>
      </div>
      {daysWithPointCount ? <Alert tone="warning" className="allocation-review-bulk__warning">
        Ao marcar Falta, revise: há ponto batido em {daysWithPointCount} dia{daysWithPointCount > 1 ? 's' : ''} da seleção.
      </Alert> : null}
    </div>
  );
}
