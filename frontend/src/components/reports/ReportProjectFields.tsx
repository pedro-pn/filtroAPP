import { Select } from '../ui/ds';
import type { RdoScopeOption } from '../../../../shared/modules/rdo-project-context.js';

export function ReportWorkLocationField({
  locations,
  value,
  onChange,
  disabled,
  invalid
}: {
  locations: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  if (locations.length <= 1) return null;
  return (
    <div
      className={`field-group ${invalid ? 'field-invalid' : ''}`}
      data-invalid-target="header:workLocation"
    >
      <label htmlFor="rdo-work-location">
        Local da obra <span style={{ color: 'var(--rd)' }}>*</span>
      </label>
      <Select
        id="rdo-work-location"
        value={locations.includes(value) ? value : ''}
        disabled={disabled}
        invalid={invalid}
        required
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Selecione o local da obra...</option>
        {locations.map((location) => (
          <option key={location} value={location}>
            {location}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function ReportServiceScopeField({
  options,
  serviceId,
  value,
  onChange,
  disabled,
  invalid
}: {
  options: RdoScopeOption[];
  serviceId: string;
  value: string;
  onChange: (update: Record<string, unknown>) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  if (options.length <= 1) return null;
  return (
    <div
      className={`field-group ${invalid ? 'field-invalid' : ''}`}
      data-invalid-target={`${serviceId}:__scopeKey`}
    >
      <label htmlFor={`service-scope-${serviceId}`}>
        Escopo <span style={{ color: 'var(--rd)' }}>*</span>
      </label>
      <Select
        id={`service-scope-${serviceId}`}
        value={options.some((option) => option.value === value) ? value : ''}
        disabled={disabled}
        invalid={invalid}
        required
        onChange={(event) =>
          onChange({
            __scopeKey: event.target.value,
            __scopeName:
              options.find((option) => option.value === event.target.value)
                ?.name ?? null
          })
        }
      >
        <option value="">Selecione o escopo...</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
