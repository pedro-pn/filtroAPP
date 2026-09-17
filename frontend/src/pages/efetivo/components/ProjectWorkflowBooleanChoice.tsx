import { Button } from '../../../components/ui/Button';

export function ProjectWorkflowBooleanChoice({ value, disabled, label, yesLabel = 'Sim', noLabel = 'Não', onSelect }: {
  value: boolean | null;
  disabled: boolean;
  label: string;
  yesLabel?: string;
  noLabel?: string;
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
        {yesLabel}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className={`project-workflow-choice-button is-no${value === false ? ' is-selected' : ''}`}
        aria-pressed={value === false}
        disabled={disabled}
        onClick={() => onSelect(false)}
      >
        {noLabel}
      </Button>
    </div>
  );
}
