import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjectSystems, saveProjectSystemAlias, type ProjectSystem, type ProjectSystemAlias } from '../../api/projectSystems';
import { getProjectProgress } from '../../api/acompanhamentoComercial';

const labels: Record<string, string> = { LIMPEZA_QUIMICA: 'Limpeza química', TESTE_PRESSAO: 'Teste de pressão', FILTRAGEM: 'Filtragem', FLUSHING: 'Flushing' };

// Associação revisável, restrita ao projeto + equipamento original + serviço. Não modifica PDFs.
export function ProjectSystemAliases({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const systems = useQuery({ queryKey: ['project-systems', 'scope', projectId], queryFn: () => listProjectSystems(projectId, 'scope') });
  const progress = useQuery({ queryKey: ['project-progress', projectId], queryFn: () => getProjectProgress(projectId) });
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = [...new Map((progress.data?.pendingMeasurements ?? []).map(item => [JSON.stringify([item.equipment, item.system, item.serviceType]), item])).entries()];
  async function save(target: ProjectSystem, alias: ProjectSystemAlias, remove = false) {
    setError(''); setBusy(true);
    try {
      await saveProjectSystemAlias(projectId, target, alias, remove);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project-systems'] }),
        client.invalidateQueries({ predicate: query => /progress|project-detail|project-cards|commercial-dashboard/.test(String(query.queryKey[0])) })
      ]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a correspondência.'); }
    finally { setBusy(false); }
  }
  return <details style={{ marginTop: 16 }}>
    <summary>Correspondência de nomes antigos por UG e sistema</summary>
    <p>Salve o escopo primeiro. Confirme apenas nomes equivalentes: a associação vale para esse nome, equipamento e serviço neste projeto. Um nome que reúne dois sistemas não deve ser associado integralmente a um deles. Para uma linha específica, use Serviços históricos.</p>
    {error || systems.isError || progress.isError ? <p role="alert">{error || 'Não foi possível carregar as correspondências.'}</p> : null}
    {pending.length === 0 ? <p>Nenhuma correspondência pendente no escopo salvo.</p> : pending.map(([key, item]) => <div key={key} className="field-group" style={{ margin: '12px 0' }}>
      <label>{item.equipment} · {item.system} · {labels[item.serviceType] || item.serviceType}</label>
      <select aria-label={`Sistema correspondente a ${item.equipment} · ${item.system}`} disabled={busy} value={selected[key] || ''} onChange={event => setSelected(previous => ({ ...previous, [key]: event.target.value }))}>
        <option value="">Manter pendente — selecionar após conferência</option>
        {systems.data?.map(system => <option key={system.id} value={system.id}>{system.equipment} · {system.name}</option>)}
      </select>
      <button type="button" className="mini-btn" disabled={busy || !selected[key]} onClick={() => {
        const target = systems.data?.find(system => system.id === selected[key]);
        if (target) void save(target, { equipment: item.equipment, system: item.system, serviceType: item.serviceType });
      }}>Confirmar equivalência de nome</button>
    </div>)}
    {systems.data?.some(system => system.aliases?.length) ? <details>
      <summary>Equivalências confirmadas</summary>
      {systems.data.flatMap(system => (system.aliases ?? []).map((alias, index) => <p key={`${system.id}-${index}`}>
        {alias.equipment} · {alias.system} ({labels[alias.serviceType] || alias.serviceType}) → {system.equipment} · {system.name}{' '}
        <button type="button" className="mini-btn alt" disabled={busy} onClick={() => void save(system, alias, true)}>Remover equivalência</button>
      </p>))}
    </details> : null}
  </details>;
}
