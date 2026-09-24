import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjectSystems, type ProjectSystem } from '../../api/projectSystems';
import { projectSystemSelectionPatch, projectSystemSuggestionOptions, systemNameKey as nameKey } from '../../utils/projectSystemSelection';
import { SearchCombobox } from '../ui/SearchCombobox';

// Os campos continuam sendo texto do cliente. Nunca consultam o cadastro dos nossos equipamentos.
export function ProjectSystemInput({ projectId, data, field, onChange, disabled, className, id, serviceType, source = 'reports', suggestions = [] }: {
  projectId?: string | null;
  data: Record<string, unknown>;
  field: 'equipmentId' | 'system';
  onChange: (patch: Record<string, unknown>) => void;
  disabled?: boolean; className?: string; id?: string;
  source?: 'reports' | 'scope';
  suggestions?: ProjectSystem[];
  serviceType?: string;
}) {
  const query = useQuery({ queryKey: ['project-systems', source, projectId], queryFn: () => listProjectSystems(projectId!, source), enabled: Boolean(projectId) && !disabled, staleTime: 30_000 });
  const systems = [...(query.data ?? []), ...suggestions];
  const options = projectSystemSuggestionOptions(query.data ?? [], field, data.equipmentId,
    source === 'scope' ? suggestions : undefined);
  const emptyText = query.isError ? 'Não foi possível carregar as sugestões. Você pode digitar livremente.'
    : !projectId ? 'Selecione um projeto para carregar as sugestões.'
      : field === 'system' && !nameKey(data.equipmentId) ? 'Selecione ou informe o equipamento do cliente primeiro.'
        : options.length ? 'Nenhuma sugestão com esse nome. Você pode digitar livremente.'
          : field === 'system' && nameKey(data.equipmentId) ? 'Nenhum sistema no escopo atual para esse equipamento. Confira o equipamento ou digite livremente.'
            : 'Nenhuma sugestão no escopo atual. Salve equipamento do cliente e sistema no escopo do cronograma ou digite livremente.';
  useEffect(() => {
    if (source === 'reports' && !disabled && data.__projectSystemId && query.data && !query.data.some(item => item.id === data.__projectSystemId)) {
      onChange({ __projectSystemId: null });
    }
  }, [source, disabled, data.__projectSystemId, query.data, onChange]);
  return <>
    <SearchCombobox id={id} inputClassName={className} disabled={disabled} maxLength={180} allowCustomValue hideLabel variant="select"
      label={field === 'equipmentId' ? 'Equipamento do cliente' : 'Sistema'}
      toggleLabel={field === 'equipmentId' ? 'Mostrar sugestões de equipamentos do cliente' : 'Mostrar sugestões de sistemas'}
      options={options.map(value => ({ value, label: value }))} loading={query.isFetching && !query.data} emptyText={emptyText}
      value={typeof data[field] === 'string' ? data[field] as string : ''}
      placeholder={field === 'equipmentId' ? 'Equipamento do cliente' : 'Selecione ou digite um sistema'}
      onChange={value => {
        onChange(projectSystemSelectionPatch(systems, data, field, value, source === 'reports' ? serviceType : undefined));
      }} />
    {field === 'system' && !disabled ? <small className="muted">
      {query.isError ? 'Não foi possível carregar as sugestões. Você pode digitar livremente.'
        : data.__projectSystemId ? 'Sistema padronizado do projeto selecionado.'
          : 'Sugestões do escopo atual por equipamento. Se não encontrar, digite; o vínculo poderá ser conferido depois.'}
    </small> : null}
  </>;
}
