import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { listProjectSystems, saveProjectSystemAlias, type ProjectSystem, type ProjectSystemAlias } from '../../api/projectSystems';
import { getProjectProgress } from '../../api/acompanhamentoComercial';
import { pendingMeasurementSystem, projectSystemAliasKey } from '../../utils/projectSystemAliases';
import { useToast } from '../ui/ToastContext';

const labels: Record<string, string> = { LIMPEZA_QUIMICA: 'Limpeza química', TESTE_PRESSAO: 'Teste de pressão', FILTRAGEM: 'Filtragem', FLUSHING: 'Flushing' };

// Associação revisável, restrita ao projeto + equipamento original + serviço. Não modifica PDFs.
export function ProjectSystemAliases({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const showToast = useToast();
  const systemsKey = ['project-systems', 'scope', projectId];
  const systems = useQuery({ queryKey: systemsKey, queryFn: () => listProjectSystems(projectId, 'scope') });
  const progress = useQuery({ queryKey: ['project-progress', projectId], queryFn: () => getProjectProgress(projectId) });
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [confirmedOpen, setConfirmedOpen] = useState(false);
  const measurements = (progress.data?.pendingMeasurements ?? []).map(item => ({ item, match: pendingMeasurementSystem(systems.data ?? [], item) }));
  const pending = [...new Map(measurements.filter(({ match }) => !match).map(({ item }) => [projectSystemAliasKey(item), item])).entries()];
  const withoutScope = measurements.filter(({ match }) => match);
  const loading = systems.isLoading || progress.isLoading;
  const unavailable = systems.isError || progress.isError;

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['project-systems'] }, { throwOnError: true }),
      client.invalidateQueries({ predicate: query => /progress|project-detail|project-cards|commercial-dashboard/.test(String(query.queryKey[0])) }, { throwOnError: true })
    ]);
  }

  async function save(target: ProjectSystem, alias: ProjectSystemAlias, remove = false) {
    if (busy) return;
    const key = projectSystemAliasKey(alias);
    setError(''); setFeedback(''); setBusy(`${remove ? 'remove' : 'save'}:${target.id}:${key}`);
    try {
      const updated = await saveProjectSystemAlias(projectId, target, alias, remove);
      await client.cancelQueries({ queryKey: systemsKey, exact: true });
      // Usa a resposta confirmada pelo servidor, inclusive a nova revisão para a próxima ação.
      client.setQueryData<ProjectSystem[]>(systemsKey, previous => (previous ?? []).map(system => system.id === updated.id ? updated : system));
      setSelected(previous => { const next = { ...previous }; delete next[key]; return next; });
      const message = `${remove ? 'Equivalência removida' : 'Equivalência confirmada'}: ${alias.equipment} · ${alias.system} → ${target.equipment} · ${target.name}.`;
      setFeedback(message);
      showToast(message);
      if (!remove) setConfirmedOpen(true);
      try { await refresh(); }
      catch { setError('A alteração foi salva, mas não foi possível atualizar todas as pendências. Tente atualizar a lista.'); }
    } catch (cause) {
      const message = (axios.isAxiosError<{ error?: string }>(cause) ? cause.response?.data?.error : null)
        || (cause instanceof Error ? cause.message : 'Não foi possível salvar a correspondência.');
      setError(message);
      showToast(message, 'error');
      if (axios.isAxiosError(cause) && cause.response?.status === 409) {
        await client.invalidateQueries({ queryKey: systemsKey });
      }
    } finally { setBusy(null); }
  }

  async function retryRefresh() {
    setError(''); setBusy('refresh');
    try { await refresh(); }
    catch { setError('Não foi possível atualizar a lista. Tente novamente.'); }
    finally { setBusy(null); }
  }
  return <details style={{ marginTop: 16 }}>
    <summary>Correspondência de nomes antigos por UG e sistema</summary>
    <p>Salve o escopo primeiro. Confirme apenas nomes equivalentes: a associação vale para esse nome, equipamento e serviço neste projeto. Um nome que reúne dois sistemas não deve ser associado integralmente a um deles. Para uma linha específica, use Serviços históricos.</p>
    <p role="status" aria-live="polite">{busy ? (busy === 'refresh' ? 'Atualizando a lista…' : 'Salvando equivalência e atualizando as pendências…') : feedback}</p>
    {error || unavailable ? <div>
      <p role="alert">{error || 'Não foi possível carregar as correspondências.'}</p>
      <button type="button" className="mini-btn alt" disabled={Boolean(busy)} onClick={() => void retryRefresh()}>Atualizar lista</button>
    </div> : null}
    {loading ? <p>Carregando correspondências…</p> : pending.length === 0 ? (!unavailable && !busy && <p>Nenhuma correspondência de nome pendente no escopo salvo.</p>) : pending.map(([key, item]) => <div key={key} className="field-group" style={{ margin: '12px 0' }}>
      <label>{item.equipment} · {item.system} · {labels[item.serviceType] || item.serviceType}</label>
      <select aria-label={`Sistema correspondente a ${item.equipment} · ${item.system}`} disabled={Boolean(busy) || unavailable} value={selected[key] || ''} onChange={event => setSelected(previous => ({ ...previous, [key]: event.target.value }))}>
        <option value="">Manter pendente — selecionar após conferência</option>
        {systems.data?.map(system => <option key={system.id} value={system.id}>{system.equipment} · {system.name}</option>)}
      </select>
      <button type="button" className="mini-btn" disabled={Boolean(busy) || unavailable || !selected[key]} onClick={() => {
        const target = systems.data?.find(system => system.id === selected[key]);
        if (target) void save(target, { equipment: item.equipment, system: item.system, serviceType: item.serviceType });
      }}>{busy === `save:${selected[key]}:${key}` ? 'Confirmando…' : 'Confirmar equivalência de nome'}</button>
    </div>)}
    {!loading && !busy && !unavailable && withoutScope.length > 0 ? <div>
      <p>Medições com nome identificado, mas sem meta compatível no escopo salvo:</p>
      <p className="placeholder-copy">Não é necessário confirmar o nome novamente. Confira o equipamento/sistema, serviço, tipo de medição e diâmetro cadastrados no escopo. Essas quantidades ainda não entram no avanço.</p>
      <ul>{withoutScope.map(({ item, match }, index) => <li key={index}>
        {item.equipment} · {item.system} → {match?.equipment} · {match?.name} — {labels[item.serviceType] || item.serviceType}: {item.quantity.toLocaleString('pt-BR')} {item.unit}
        {item.diameter ? ` (diâmetro ${item.diameter} ${item.diameterUnit || 'pol'})` : ''}
      </li>)}</ul>
    </div> : null}
    {systems.data?.some(system => system.aliases?.length) ? <details open={confirmedOpen} onToggle={event => setConfirmedOpen(event.currentTarget.open)}>
      <summary>Equivalências confirmadas</summary>
      {systems.data.flatMap(system => (system.aliases ?? []).map((alias, index) => <p key={`${system.id}-${index}`}>
        {alias.equipment} · {alias.system} ({labels[alias.serviceType] || alias.serviceType}) → {system.equipment} · {system.name}{' '}
        <button type="button" className="mini-btn alt" disabled={Boolean(busy) || unavailable} onClick={() => void save(system, alias, true)}>
          {busy === `remove:${system.id}:${projectSystemAliasKey(alias)}` ? 'Removendo…' : 'Remover equivalência'}
        </button>
      </p>))}
    </details> : null}
  </details>;
}
