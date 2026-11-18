import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { classificationLabels, classifyWorkforce, classifyWorkforceRole, getClassificationHistory, getWorkforce, getWorkforceRoles, type WorkforceClassification, type WorkforcePerson, type WorkforceRole } from '../../api/workforceClassification';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, Input, SearchInput, Select, Skeleton, Textarea, type DataTableColumn } from '../../components/ui/ds';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../layout/PageHeader';
import { AdminModuleAppShell } from './AdminModuleAppShell';
import { WorkforceVisibilityTab } from './WorkforceVisibilityTab';
import './AdminWorkforcePage.css';

const classifications = Object.entries(classificationLabels) as Array<[WorkforceClassification, string]>;
const sourceLabel = (value: boolean | null) => value === true ? 'Operacional' : value === false ? 'Não operacional' : 'Não informado';
const roleValue = (role: WorkforceRole): WorkforceClassification => role.workforceClassification || (role.isOperational ? 'OPERATIONAL' : 'NON_OPERATIONAL');
function ClassificationBadge({ value }: { value: WorkforceClassification }) {
  return <Badge tone={value === 'OPERATIONAL' ? 'success' : value === 'PENDING' ? 'warning' : 'neutral'}>{classificationLabels[value]}</Badge>;
}

export function AdminWorkforcePage() {
  const client = useQueryClient();
  const [tab, setTab] = useState<'people' | 'roles' | 'visibility'>('people');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [classification, setClassification] = useState('');
  const [jobRoleId, setJobRoleId] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [active, setActive] = useState('');
  const [divergence, setDivergence] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [edit, setEdit] = useState<{ kind: 'people'; people: WorkforcePerson[] } | { kind: 'role'; role: WorkforceRole } | null>(null);
  const [nextClassification, setNextClassification] = useState<WorkforceClassification | ''>('');
  const [reason, setReason] = useState('');
  const [sector, setSector] = useState('');
  const [changeSector, setChangeSector] = useState(false);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<{ type: 'COLLABORATOR' | 'JOB_ROLE'; id: string; name: string } | null>(null);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setPage(1); setSelected([]); }, [query, classification, jobRoleId, sectorFilter, active, divergence]);
  const people = useQuery({ queryKey: ['workforce-classification', query, classification, jobRoleId, sectorFilter, active, divergence, page], queryFn: () => getWorkforce({
    q: query || undefined, classification: classification || undefined, jobRoleId: jobRoleId || undefined,
    sector: sectorFilter || undefined, active: active || undefined, divergence: divergence ? 'true' : undefined, page, limit: 100
  }) });
  const roles = useQuery({ queryKey: ['workforce-classification-roles'], queryFn: getWorkforceRoles });
  const events = useQuery({ queryKey: ['workforce-classification-history', history?.type, history?.id],
    queryFn: () => getClassificationHistory(history!.type, history!.id), enabled: Boolean(history) });
  const save = useMutation({ mutationFn: async () => {
    if (!edit) throw new Error('Selecione uma classificação.');
    if (edit.kind === 'role') return classifyWorkforceRole(edit.role.id, { classification: nextClassification || 'PENDING', version: edit.role.classificationVersion, reason });
    return classifyWorkforce({ items: edit.people.map(item => ({ id: item.id, version: item.classificationVersion })),
      classification: nextClassification || null, reason, ...(changeSector ? { sector: sector.trim() || null } : {}) });
  }, onSuccess: async result => {
    setNotice(`Classificação salva.${result.affectedMissionIds.length ? ` ${result.affectedMissionIds.length} missão(ões) sinalizada(s) para revisão.` : ''}`);
    setEdit(null); setSelected([]);
    await client.invalidateQueries();
  } });
  function openEdit(value: NonNullable<typeof edit>) {
    save.reset(); setEdit(value); setReason(''); setChangeSector(false); setSector('');
    setNextClassification(value.kind === 'role' ? roleValue(value.role) : value.people.length === 1 ? value.people[0].workforceClassificationOverride || '' : '');
    if (value.kind === 'people' && value.people.length === 1) setSector(value.people[0].workforceSector || '');
  }
  const personColumns: DataTableColumn<WorkforcePerson>[] = [
    { key: 'name', header: 'Colaborador', rowHeader: true, render: item => <><strong>{item.name}</strong><small>{item.code}{item.registrationNumber ? ` · Matrícula ${item.registrationNumber}` : ''}</small></> },
    { key: 'jobRole', header: 'Cargo / setor', render: item => <>{item.jobRole.name}<small>{item.workforceSector || 'Setor não informado'}</small></> },
    { key: 'status', header: 'Vínculo', render: item => item.rhStatus === 'PRE_ADMISSION' ? 'Pré-admitido' : item.isActive ? 'Ativo' : 'Inativo' },
    { key: 'source', header: 'Conecta', render: item => sourceLabel(item.sourceIsOperational) },
    { key: 'classification', header: 'Aplicada no filtroAPP', render: item => <><ClassificationBadge value={item.classification} /><small>{item.classificationSource === 'COLLABORATOR' ? 'Classificação individual' : 'Padrão do cargo'}</small>{item.classificationDiverges ? <Badge tone="warning">Diverge do Conecta</Badge> : null}</> },
    { key: 'actions', header: 'Ações', render: item => <div className="workforce-actions"><Button size="sm" variant="secondary" onClick={() => openEdit({ kind: 'people', people: [item] })}>Classificar</Button><Button size="sm" variant="ghost" onClick={() => setHistory({ type: 'COLLABORATOR', id: item.id, name: item.name })}>Histórico</Button></div> }
  ];
  const roleColumns: DataTableColumn<WorkforceRole>[] = [
    { key: 'name', header: 'Cargo', rowHeader: true, render: item => <>{item.name}{!item.isActive ? <small>Inativo</small> : null}</> },
    { key: 'people', header: 'Colaboradores', render: item => item._count.collaborators },
    { key: 'source', header: 'Conecta', render: item => sourceLabel(item.sourceIsOperational) },
    { key: 'classification', header: 'Padrão no filtroAPP', render: item => <ClassificationBadge value={roleValue(item)} /> },
    { key: 'actions', header: 'Ações', render: item => <div className="workforce-actions"><Button size="sm" variant="secondary" onClick={() => openEdit({ kind: 'role', role: item })}>Definir padrão</Button><Button size="sm" variant="ghost" onClick={() => setHistory({ type: 'JOB_ROLE', id: item.id, name: item.name })}>Histórico</Button></div> }
  ];
  return <AdminModuleAppShell sectionLabel="Colaboradores e classificação"><main className="fv-ds admin-workforce-page">
    <PageHeader title="Colaboradores e classificação" description="Classifique as pessoas e configure onde cada classificação aparece. A situação do vínculo é tratada separadamente." />
    {notice ? <Alert tone="success">{notice}</Alert> : null}
    <div className="workforce-actions" role="group" aria-label="Visão da classificação"><Button variant={tab === 'people' ? 'primary' : 'secondary'} aria-pressed={tab === 'people'} onClick={() => setTab('people')}>Colaboradores</Button><Button variant={tab === 'roles' ? 'primary' : 'secondary'} aria-pressed={tab === 'roles'} onClick={() => setTab('roles')}>Padrões por cargo</Button><Button variant={tab === 'visibility' ? 'primary' : 'secondary'} aria-pressed={tab === 'visibility'} onClick={() => setTab('visibility')}>Visibilidade por módulo</Button></div>
    <Alert tone="info">As classificações locais são preservadas nas sincronizações. A participação em cada módulo segue as regras da aba Visibilidade por módulo. Documentos e valores históricos são mantidos.</Alert>
    {tab === 'visibility' ? <WorkforceVisibilityTab /> : tab === 'people' ? <>
      <Card padding="md"><div className="workforce-filters">
        <Field id="workforce-search" label="Buscar colaborador"><SearchInput value={search} onChange={setSearch} placeholder="Nome, código ou matrícula" /></Field>
        <Field id="workforce-filter" label="Classificação"><Select value={classification} onChange={event => setClassification(event.target.value)}><option value="">Todas</option>{classifications.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field>
        <Field id="workforce-role" label="Cargo"><Select value={jobRoleId} onChange={event => setJobRoleId(event.target.value)}><option value="">Todos</option>{roles.data?.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</Select></Field>
        <Field id="workforce-sector" label="Setor"><Input value={sectorFilter} onChange={event => setSectorFilter(event.target.value)} placeholder="Todos os setores" /></Field>
        <Field id="workforce-active" label="Situação"><Select value={active} onChange={event => setActive(event.target.value)}><option value="">Todas</option><option value="true">Ativo / pré-admitido</option><option value="false">Inativo</option></Select></Field>
        <label className="workforce-check"><input type="checkbox" checked={divergence} onChange={event => setDivergence(event.target.checked)} />Somente divergências com o Conecta</label>
      </div></Card>
      <div className="workforce-actions"><span>{people.data?.total ?? 0} colaborador(es) · {selected.length} selecionado(s)</span><Button size="sm" disabled={!selected.length || people.isFetching} onClick={() => openEdit({ kind: 'people', people: (people.data?.items || []).filter(item => selected.includes(item.id)) })}>Classificar selecionados</Button></div>
      {people.isLoading ? <Skeleton variant="card" /> : people.isError ? <EmptyState variant="error" title="Não foi possível carregar os colaboradores." action={{ label: 'Tentar novamente', onClick: () => void people.refetch() }} /> : <DataTable columns={personColumns} rows={people.data?.items || []} getRowId={item => item.id} caption="Classificação dos colaboradores" ariaLabel="Classificação dos colaboradores" mobile={{ renderItem: item => ({ title: item.name, subtitle: `${item.code} · ${item.jobRole.name}`, status: <ClassificationBadge value={item.classification} />, metadata: [{ label: 'Conecta', value: sourceLabel(item.sourceIsOperational) }, { label: 'Origem', value: item.classificationSource === 'COLLABORATOR' ? 'Classificação individual' : 'Padrão do cargo' }], actions: personColumns.at(-1)!.render!(item, 0) }) }} selection={{ selectedRowIds: selected, onSelectionChange: ids => setSelected(ids.map(String)), getRowLabel: item => item.name }} />}
      <div className="workforce-pagination"><Button variant="secondary" size="sm" disabled={page === 1 || people.isFetching} onClick={() => { setPage(page - 1); setSelected([]); }}>Anterior</Button><span>Página {page}</span><Button variant="secondary" size="sm" disabled={!people.data || page * people.data.limit >= people.data.total || people.isFetching} onClick={() => { setPage(page + 1); setSelected([]); }}>Próxima</Button></div>
    </> : roles.isLoading ? <Skeleton variant="card" /> : roles.isError ? <EmptyState variant="error" title="Não foi possível carregar os cargos." action={{ label: 'Tentar novamente', onClick: () => void roles.refetch() }} /> : <DataTable columns={roleColumns} rows={roles.data || []} getRowId={item => item.id} caption="Classificação padrão por cargo" ariaLabel="Classificação padrão por cargo" mobile={{ renderItem: item => ({ title: item.name, subtitle: `${item._count.collaborators} colaborador(es)`, status: <ClassificationBadge value={roleValue(item)} />, actions: roleColumns.at(-1)!.render!(item, 0) }) }} />}
    <Modal open={Boolean(edit)} onClose={() => { if (!save.isPending) setEdit(null); }} appearance="design-system" title={edit?.kind === 'role' ? `Padrão de ${edit.role.name}` : 'Classificar colaboradores'} size="md" footer={<><Button variant="secondary" disabled={save.isPending} onClick={() => setEdit(null)}>Cancelar</Button><Button loading={save.isPending} disabled={reason.trim().length < 3} onClick={() => save.mutate()}>Salvar classificação</Button></>}>
      <div className="workforce-editor">
        {edit?.kind === 'people' ? <p>{edit.people.length} colaborador(es): {edit.people.map(item => item.name).join(', ')}.</p> : <p>O padrão será aplicado a quem herda a classificação do cargo. Exceções individuais serão mantidas.</p>}
        <Field id="workforce-new-classification" label="Classificação"><Select value={nextClassification} onChange={event => setNextClassification(event.target.value as WorkforceClassification | '')}>{edit?.kind === 'people' ? <option value="">Herdar padrão do cargo</option> : null}{classifications.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field>
        {edit?.kind === 'people' ? <><label className="workforce-check"><input type="checkbox" checked={changeSector} onChange={event => setChangeSector(event.target.checked)} />Atualizar setor das pessoas selecionadas</label>{changeSector ? <Field id="workforce-new-sector" label="Setor"><Input value={sector} maxLength={100} onChange={event => setSector(event.target.value)} placeholder="Ex.: Administrativo, Engenharia, Operacional" /></Field> : null}</> : null}
        <Field id="workforce-reason" label="Motivo da alteração" required helperText="Descreva o motivo com pelo menos 3 caracteres."><Textarea value={reason} minLength={3} maxLength={1000} onChange={event => setReason(event.target.value)} /></Field>
        <p>A classificação será aplicada conforme as regras de visibilidade de cada módulo. Missões futuras ou em andamento serão sinalizadas para revisão.</p>
        {save.isError ? <Alert tone="danger">{save.error.message}</Alert> : null}
      </div>
    </Modal>
    <Modal open={Boolean(history)} onClose={() => setHistory(null)} appearance="design-system" title={`Histórico · ${history?.name || ''}`} size="md">
      {events.isLoading ? <Skeleton variant="card" /> : events.isError ? <Alert tone="danger">Não foi possível carregar o histórico.</Alert> : events.data?.length ? <ol className="workforce-history">{events.data.map(event => <li key={event.id}><strong>{new Date(event.createdAt).toLocaleString('pt-BR')}</strong><p>{event.reason}</p><small>{event.actorName}</small><p>Antes: {String(event.before.classification == null ? 'Herdar cargo / sem classificação local' : classificationLabels[event.before.classification as WorkforceClassification] || event.before.classification)}</p><p>Depois: {String(event.after.classification == null ? event.after.override || 'Herdar cargo' : classificationLabels[event.after.classification as WorkforceClassification] || event.after.classification)}</p>{event.after.sector !== undefined ? <p>Setor: {String(event.after.sector || 'Não informado')}</p> : null}</li>)}</ol> : <p>Nenhuma alteração individual registrada. Consulte também o histórico do cargo.</p>}
    </Modal>
  </main></AdminModuleAppShell>;
}
