import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { defaultWorkforceVisibilityRules, WORKFORCE_VISIBILITY_TARGETS, type WorkforceVisibilityRules, type WorkforceVisibilityTarget } from '../../../../shared/modules/workforce-visibility.js';
import { classificationLabels, getClassificationHistory, getWorkforceVisibility, saveWorkforceVisibility, type ClassificationEvent, type WorkforceClassification } from '../../api/workforceClassification';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, Skeleton, Textarea, type DataTableColumn } from '../../components/ui/ds';

const classifications = Object.keys(classificationLabels) as WorkforceClassification[];
const configurableTargets = WORKFORCE_VISIBILITY_TARGETS.filter(item => item.key !== 'ALLOCATION_REVIEW');
type VisibilityRow = typeof WORKFORCE_VISIBILITY_TARGETS[number];
const labelsFor = (values: readonly WorkforceClassification[]) => values.length ? values.map(value => classificationLabels[value]).join(', ') : 'Nenhuma classificação';

function historyRules(event: ClassificationEvent, side: 'before' | 'after') {
  const rules = event[side].rules;
  return rules && typeof rules === 'object' ? rules as Partial<WorkforceVisibilityRules> : {};
}

export function WorkforceVisibilityTab() {
  const client = useQueryClient();
  const configuration = useQuery({ queryKey: ['workforce-visibility'], queryFn: getWorkforceVisibility });
  const history = useQuery({ queryKey: ['workforce-visibility-history'], queryFn: () => getClassificationHistory('VISIBILITY', 'global') });
  const [draft, setDraft] = useState<WorkforceVisibilityRules | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const rules = draft || configuration.data?.rules || defaultWorkforceVisibilityRules();
  const changedTargets = configurableTargets.filter(({ key }) =>
    JSON.stringify([...rules[key]].sort()) !== JSON.stringify([...(configuration.data?.rules[key] || [])].sort())
  );
  const outdated = baseVersion !== null && configuration.data?.version !== baseVersion;
  const save = useMutation({ mutationFn: () => saveWorkforceVisibility({ version: baseVersion ?? configuration.data!.version, rules, reason }),
    onSuccess: async result => {
      setDraft(null); setBaseVersion(null); setReason('');
      setNotice(`Regras salvas. Aplicação em todo o sistema em até ${result.refreshIntervalSeconds} segundos.${result.affectedMissionIds.length ? ` ${result.affectedMissionIds.length} missão(ões) sinalizada(s) para revisão.` : ''}`);
      await client.invalidateQueries();
    }
  });
  function changeRules(next: WorkforceVisibilityRules) {
    if (baseVersion === null) setBaseVersion(configuration.data!.version);
    setDraft(next); setNotice(''); save.reset();
  }
  function toggle(target: WorkforceVisibilityTarget, value: WorkforceClassification, checked: boolean) {
    const selected = new Set(rules[target]);
    if (checked) selected.add(value); else selected.delete(value);
    changeRules({ ...rules, [target]: classifications.filter(item => selected.has(item)) });
  }
  async function reload() {
    setDraft(null); setBaseVersion(null); setReason(''); save.reset();
    await configuration.refetch();
  }
  function checkbox(row: VisibilityRow, value: WorkforceClassification) {
    return <input type="checkbox" className="workforce-visibility-checkbox"
      aria-label={`Mostrar ${classificationLabels[value]} em ${row.label}`}
      checked={rules[row.key].includes(value)} disabled={save.isPending || configuration.isFetching}
      onChange={event => toggle(row.key, value, event.target.checked)} />;
  }
  const columns: DataTableColumn<VisibilityRow>[] = [
    { key: 'label', header: 'Módulo ou listagem', rowHeader: true, sortable: false, render: row => <><strong>{row.label}</strong><small>{row.description}</small>{!rules[row.key].length ? <Badge tone="warning">Sem colaboradores na listagem</Badge> : null}</> },
    ...classifications.map(value => ({ key: value, header: classificationLabels[value], sortable: false, align: 'center' as const, render: (row: VisibilityRow) => checkbox(row, value) }))
  ];
  if (configuration.isLoading) return <Skeleton variant="card" />;
  if (configuration.isError) return <EmptyState variant="error" title="Não foi possível carregar as regras de visibilidade." action={{ label: 'Tentar novamente', onClick: () => void configuration.refetch() }} />;
  return <section className="workforce-visibility-tab" aria-label="Visibilidade por módulo">
    <div><h2>Onde cada classificação aparece</h2><p>Marque as classificações disponíveis em cada módulo. A regra também vale para pesquisas, seletores e novas inclusões por API. Situação do vínculo e permissões de acesso continuam sendo verificadas.</p></div>
    <p>A participação na conferência é definida em <Link to="/efetivo?section=administracao&adminTab=conferencia">Efetivo → Administração → Conferência</Link>.</p>
    {notice ? <Alert tone="success">{notice}</Alert> : null}
    <Alert tone="info">O padrão mantém todos os setores no EPI e somente operacionais nas demais listagens. A administração do cadastro sempre permite revisar todas as pessoas. Documentos históricos e assinaturas existentes são preservados.</Alert>
    {outdated ? <Alert tone="warning">Outro administrador atualizou as regras. Recarregue a configuração antes de salvar.</Alert> : null}
    <DataTable rows={configurableTargets} columns={columns} getRowId={row => row.key}
      ariaLabel="Classificações visíveis por módulo" caption="Classificações visíveis por módulo"
      mobile={{ renderItem: row => ({ title: row.label, subtitle: row.description,
        details: <div className="workforce-visibility-mobile-options">{classifications.map(value => <label className="workforce-check" key={value}>{checkbox(row, value)}{classificationLabels[value]}</label>)}</div> }) }} />
    <Card padding="md"><div className="workforce-editor">
      <div className="workforce-actions"><Button size="sm" variant="secondary" disabled={save.isPending || configuration.isFetching} onClick={() => changeRules({ ...defaultWorkforceVisibilityRules(), ALLOCATION_REVIEW: rules.ALLOCATION_REVIEW })}>Restaurar padrão</Button><Button size="sm" variant="ghost" disabled={save.isPending || configuration.isFetching} onClick={() => void reload()}>Recarregar configuração</Button></div>
      {changedTargets.length ? <><strong>{changedTargets.length} módulo(s) ou listagem(ns) com alterações</strong><ul className="workforce-visibility-changes">{changedTargets.map(row => <li key={row.key}><strong>{row.label}</strong><p>Antes: {labelsFor(configuration.data!.rules[row.key])}</p><p>Depois: {labelsFor(rules[row.key])}</p></li>)}</ul></> : <p>Nenhuma alteração pendente.</p>}
      <Field id="workforce-visibility-reason" label="Motivo da alteração" required helperText="O motivo e o autor serão registrados no histórico."><Textarea value={reason} maxLength={1000} minLength={3} disabled={save.isPending} onChange={event => setReason(event.target.value)} /></Field>
      {save.isError ? <Alert tone="danger">{save.error.message}</Alert> : null}
      <div className="workforce-actions"><Button loading={save.isPending} disabled={!changedTargets.length || reason.trim().length < 3 || outdated || configuration.isFetching} onClick={() => save.mutate()}>Salvar regras de visibilidade</Button><span>Aplicação das regras em até {configuration.data?.refreshIntervalSeconds || 5} segundos.</span></div>
    </div></Card>
    <Card padding="md"><h3>Histórico das regras</h3>
      {history.isLoading ? <Skeleton variant="card" /> : history.isError ? <EmptyState variant="error" title="Não foi possível carregar o histórico." action={{ label: 'Tentar novamente', onClick: () => void history.refetch() }} /> : history.data?.length ? <ol className="workforce-history">{history.data.map(event => {
        const before = historyRules(event, 'before'), after = historyRules(event, 'after');
        const changes = WORKFORCE_VISIBILITY_TARGETS.filter(({ key }) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
        return <li key={event.id}><strong>{new Date(event.createdAt).toLocaleString('pt-BR')} · {event.actorName}</strong><p>{event.reason}</p>{changes.map(row => <p key={row.key}><strong>{row.label}:</strong> {labelsFor(before[row.key] || [])} → {labelsFor(after[row.key] || [])}</p>)}</li>;
      })}</ol> : <p>Nenhuma alteração nas regras registrada.</p>}
    </Card>
  </section>;
}
