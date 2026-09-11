import { Button } from '../../../components/ui/Button';

export function ProjectWorkflowBooleanChoice({ value, disabled, label, onSelect }: {
  value: boolean | null;
  disabled: boolean;
  label: string;
  onSelect: (value: boolean) => void;
}) {
  return (
    <div className="project-workflow-documentation-choice" role="group" aria-label={label}>
      <Button
        type="button"
        variant="secondary"
        className={`project-workflow-choice-button is-yes${value === true ? ' is-selected' : ''}`}
        aria-pressed={value === true}
        disabled={disabled}
        onClick={() => onSelect(true)}
      >
        Sim
      </Button>
      <Button
        type="button"
        variant="secondary"
        className={`project-workflow-choice-button is-no${value === false ? ' is-selected' : ''}`}
        aria-pressed={value === false}
        disabled={disabled}
        onClick={() => onSelect(false)}
      >
        Não
      </Button>
    </div>
  );
}
