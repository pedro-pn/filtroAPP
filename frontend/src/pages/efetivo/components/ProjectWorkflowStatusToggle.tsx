import type { ReactNode } from 'react';

import { Button } from '../../../components/ui/Button';
import { ProjectWorkflowIcon } from './ProjectWorkflowIcon';

/**
 * Botão de status com dois estados (ex.: "Agendado"/"Realizado", "Solicitado"/"Concluído"), em vez do checkbox
 * com moldura em pílula usado antes (`.project-workflow-release-toggle`). Mesmo padrão do botão "Concluído" do
 * item crítico de cadastro no cliente: neutro (cinza) antes de marcado, preenchimento sólido com ícone quando
 * ativo — cor de destaque antes do clique passaria a impressão de já concluído.
 */
export function ProjectWorkflowStatusToggle({ id, checked, disabled, label, onChange }: {
  id?: string;
  checked: boolean;
  disabled?: boolean;
  label: ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Button
      type="button"
      id={id}
      variant="secondary"
      className={`project-workflow-status-toggle${checked ? ' is-active' : ''}`}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      {checked ? <ProjectWorkflowIcon name="check" /> : null}
      {label}
    </Button>
  );
}
