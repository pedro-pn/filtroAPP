import type { ReactNode } from 'react';

type Option = { id: string; code: string; name?: string };

export function RomaneioEquipmentOptions<T extends Option>({ options, suggested = [], label = item => [item.code, item.name].filter(Boolean).join(' - ') }: {
  options: T[];
  suggested?: Option[];
  label?: (item: T) => ReactNode;
}) {
  const suggestedIds = new Set(suggested.map(item => item.id));
  const renderOptions = (items: T[]) => items.map(item => <option key={item.id} value={item.id}>{label(item)}</option>);
  if (!suggestedIds.size) return <>{renderOptions(options)}</>;
  return <>
    <optgroup label="Sugeridos pelo romaneio de saída">{renderOptions(options.filter(item => suggestedIds.has(item.id)))}</optgroup>
    <optgroup label="Outros equipamentos">{renderOptions(options.filter(item => !suggestedIds.has(item.id)))}</optgroup>
  </>;
}

export function RomaneioEquipmentHint({ suggested = [] }: { suggested?: Option[] }) {
  return suggested.length ? <small className="muted">Sugestão do romaneio de saída: {suggested.map(item => item.code).join(', ')}.</small> : null;
}
