import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjectSystems } from '../../api/projectSystems';
import { MECHANICAL_MEASURES } from '../../../../shared/modules/mechanical-measurement.js';
import { systemNameKey } from '../../utils/projectSystemSelection';

export function MechanicalMeasurementFields({ projectId, data, onChange, disabled, groupKey }: {
  projectId?: string | null; data: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void;
  disabled?: boolean; groupKey?: string;
}) {
  const query = useQuery({ queryKey: ['project-systems', 'reports', projectId],
    queryFn: () => listProjectSystems(projectId!), enabled: Boolean(projectId) && !disabled, staleTime: 30_000 });
  const selected = query.data?.find(system => data.__projectSystemId ? system.id === data.__projectSystemId
    : systemNameKey(system.equipment) === systemNameKey(data.equipmentId)
      && systemNameKey(system.name) === systemNameKey(data.system));
  const measures = selected?.measurements?.filter(row => ['LIMPEZA_MECANICA', 'MECANICA', 'mecanica'].includes(row.serviceType)) ?? [];
  const units = [...new Set(measures.map(row => MECHANICAL_MEASURES[row.systemType]?.unit).filter(Boolean))];
  const unit = typeof data.unidadeMecanica === 'string' ? data.unidadeMecanica : '';
  const onlyUnit = units.length === 1 ? units[0] : null;
  useEffect(() => {
    if (!disabled && onlyUnit && unit !== onlyUnit) onChange({ unidadeMecanica: onlyUnit, quantidadeMecanica: '' });
  }, [disabled, onlyUnit, unit, onChange]);
  const options = Object.values(MECHANICAL_MEASURES).filter(measure => !units.length || units.includes(measure.unit));
  return <div className="fg-r2 service-measurements-block service-options-full">
    <div className="field-group">
      <label htmlFor={`${groupKey}-mechanical-unit`}>Unidade de medida</label>
      <select id={`${groupKey}-mechanical-unit`} value={unit} disabled={disabled || Boolean(onlyUnit)}
        onChange={event => onChange({ unidadeMecanica: event.target.value, quantidadeMecanica: '' })}>
        <option value="">Selecionar...</option>
        {options.map(option => <option key={option.unit} value={option.unit}>{option.label}</option>)}
      </select>
      {units.length ? <small>Unidade definida no escopo do equipamento/sistema.</small> : null}
    </div>
    <div className="field-group">
      <label htmlFor={`${groupKey}-mechanical-quantity`}>Quantidade executada{unit ? ` (${unit === 'UN' ? 'un' : unit.toLowerCase()})` : ''}</label>
      <input id={`${groupKey}-mechanical-quantity`} type="number" min={unit === 'UN' ? '1' : '0.01'}
        step={unit === 'UN' ? '1' : '0.01'} max="999999999999.99" disabled={disabled || !unit}
        value={String(data.quantidadeMecanica ?? '')} onChange={event => onChange({ quantidadeMecanica: event.target.value })} />
    </div>
  </div>;
}
