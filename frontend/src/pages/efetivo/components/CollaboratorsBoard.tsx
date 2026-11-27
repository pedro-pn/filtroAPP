import { useUsefulQueryContent } from '../../../observability/useUsefulContent';
import { SortableTable } from '../../../components/ui/SortableTable';
import { BrandLoading } from '../../../components/brand/BrandLoading';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  createPlanningAbsence,
  createPlanningCollaborator,
  listPlanningCollaborators,
  listPlanningJobRoles,
  planningErrorConflicts,
  updatePlanningCollaborator,
  updatePlanningCollaboratorSkills,
  type CollaboratorInput,
  type PlanningCollaborator
} from '../../../api/efetivoPlanning';
import type { EfetivoAbsencePayload } from '../../../api/efetivo';
import { Button, SearchInput } from '../../../components/ui/ds';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { ConectaCompliancePanel } from './ConectaCompliancePanel';
import { AbsenceFormModal } from './AbsenceFormModal';
import { OperationalCollaboratorModal } from './OperationalCollaboratorModal';
import { CollaboratorSkillTags } from '../../../components/efetivo/CollaboratorSkillTags';
import { CollaboratorSkillMatrix } from '../../../components/efetivo/CollaboratorSkillMatrix';
import { collaboratorSkillScore, withCollaboratorSkillLevel, type CollaboratorSkillLevels } from '../../../../../shared/modules/collaborator-skills.js';

const statusLabel = { ALLOCATED: 'Alocado', UNAVAILABLE: 'Indisponível', FREE: 'Livre', OUTSIDE_EMPLOYMENT: 'Fora do vínculo' } as const;

export function CollaboratorsBoard({ date, jobRoleId, search, canManage, selectedCollaboratorId, onSearchChange, onCollaboratorSelect, absencePrefill, onAbsencePrefillDone }: {
  date: string;
  jobRoleId?: string;
  search: string;
  canManage: boolean;
  selectedCollaboratorId?: string;
  onSearchChange: (value: string) => void;
  onCollaboratorSelect?: (value?: string) => void;
  // Link do aviso da conferência de alocação: abre o cadastro de ausência já preenchido.
  absencePrefill?: { type: string; startDate: string; endDate: string };
  onAbsencePrefillDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<PlanningCollaborator | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [absencePerson, setAbsencePerson] = useState<PlanningCollaborator | null>(null);
  const [view, setView] = useState<'lista' | 'habilidades'>('lista');
  const [editingSkills, setEditingSkills] = useState(false);
  const [savingSkillIds, setSavingSkillIds] = useState<ReadonlySet<string>>(() => new Set());
  const collaboratorsKey = ['efetivo-planning-collaborators', date, jobRoleId || 'all', search] as const;
  const collaborators = useQuery({ queryKey: collaboratorsKey, queryFn: () => listPlanningCollaborators({ date, jobRoleId, search: search || undefined }) });
  useUsefulQueryContent('efetivo:colaboradores', 'CollaboratorsBoard', [collaborators]);
  const roles = useQuery({ queryKey: ['efetivo-planning-job-roles'], queryFn: listPlanningJobRoles });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['efetivo-planning-collaborators'] }), queryClient.invalidateQueries({ queryKey: ['efetivo-planning-overview'] }), queryClient.invalidateQueries({ queryKey: ['efetivo-planning-calendar'] }), queryClient.invalidateQueries({ queryKey: ['efetivo-planning-availability'] }), queryClient.invalidateQueries({ queryKey: ['efetivo-mission-team-collaborators'] })]);
  const save = useMutation({
    mutationFn: (payload: CollaboratorInput) => editing ? updatePlanningCollaborator(editing.id, payload) : createPlanningCollaborator(payload),
    onSuccess: async () => { await refresh(); setFormOpen(false); setEditing(null); toast('Colaborador salvo.', 'success'); },
    onError: (error: Error) => toast(error.message || 'Não foi possível salvar.', 'error')
  });
  const absence = useMutation({
    mutationFn: (payload: EfetivoAbsencePayload) => createPlanningAbsence({ collaboratorId: payload.collaboratorId, type: payload.type || 'FERIAS', startDate: payload.startDate, endDate: payload.endDate, note: payload.note || null }),
    onSuccess: async () => { await refresh(); setAbsencePerson(null); if (absencePrefill) onAbsencePrefillDone?.(); toast('Indisponibilidade programada.', 'success'); },
    onError: (error: Error) => {
      const conflict = planningErrorConflicts(error)?.[0];
      toast(conflict ? `${error.message} ${conflict.collaboratorName || ''}: ${displayDateOnly(conflict.startDate)} a ${displayDateOnly(conflict.endDate)}.` : error.message, 'error');
    }
  });
  // Edição direta na visão por habilidades: atualiza a célula na hora e grava só a matriz.
  // As gravações ficam em fila (scope) para não chegarem ao servidor fora de ordem.
  const setRowSkills = (id: string, skillLevels: CollaboratorSkillLevels) => queryClient.setQueryData<PlanningCollaborator[]>(collaboratorsKey, current => current?.map(row => row.id === id ? { ...row, skillLevels } : row));
  const markSaving = (id: string, saving: boolean) => setSavingSkillIds(current => { const next = new Set(current); if (saving) next.add(id); else next.delete(id); return next; });
  const saveSkills = useMutation({
    scope: { id: 'efetivo-collaborator-skills' },
    mutationFn: ({ id, skillLevels }: { id: string; skillLevels: CollaboratorSkillLevels }) => updatePlanningCollaboratorSkills(id, skillLevels),
    onMutate: ({ id, skillLevels }) => { setRowSkills(id, skillLevels); markSaving(id, true); },
    // Em erro, recarrega a lista para voltar ao que está gravado (outros cliques podem estar na fila).
    onError: (error: Error) => { void queryClient.invalidateQueries({ queryKey: ['efetivo-planning-collaborators'] }); toast(error.message || 'Não foi possível salvar as habilidades.', 'error'); },
    onSettled: (_result, _error, { id }) => {
      markSaving(id, false);
      // As tags aparecem também nas telas de planejamento e na seleção de equipe.
      void Promise.all([queryClient.invalidateQueries({ queryKey: ['efetivo-mission-team-collaborators'] }), queryClient.invalidateQueries({ queryKey: ['efetivo-planning-availability'] })]);
    }
  });
  const rows = collaborators.data || [];
  const prefillPerson = absencePrefill && selectedCollaboratorId ? rows.find(row => row.id === selectedCollaboratorId) : undefined;
  useEffect(() => {
    if (!canManage || !prefillPerson) return;
    setAbsencePerson(current => current || prefillPerson);
  }, [canManage, prefillPerson]);
  // Os links da visão geral e do calendário chegam com ?colaborador=…; a linha correspondente
  // é destacada e trazida para a tela (FR-039).
  useEffect(() => {
    if (!selectedCollaboratorId || !rows.length) return;
    document.querySelector(`[data-collaborator-id="${CSS.escape(selectedCollaboratorId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [rows.length, selectedCollaboratorId]);
  return (
    <div className="efetivo-board" data-efetivo-collaborators>
      <section className="page-card efetivo-list-toolbar efetivo-people-toolbar"><SearchInput size="sm" value={search} onChange={onSearchChange} label="Buscar colaborador" placeholder="Buscar colaborador" resultCount={{ shown: rows.length, total: rows.length }} /><div className="efetivo-segmented" role="group" aria-label="Visão dos colaboradores">{([['lista', 'Lista'], ['habilidades', 'Por habilidades']] as const).map(([value, label]) => <button type="button" key={value} className={view === value ? 'active' : ''} aria-pressed={view === value} onClick={() => { setView(value); if (value === 'lista') setEditingSkills(false); }}>{label}</button>)}</div>{view === 'lista' ? <span className="efetivo-toolbar-copy">Situação em {displayDateOnly(date)}</span> : null}{canManage && view === 'habilidades' ? <Button variant={editingSkills ? 'primary' : 'secondary'} size="sm" aria-pressed={editingSkills} onClick={() => setEditingSkills(current => !current)}>{editingSkills ? 'Concluir edição' : 'Editar habilidades'}</Button> : null}{canManage ? <Button variant="primary" size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>Novo colaborador</Button> : null}</section>
      <section className="page-card">
        {collaborators.isLoading ? <p className="placeholder-copy"><BrandLoading label="Carregando colaboradores" inline size="sm" /></p> : collaborators.isError ? <p className="placeholder-copy">Não foi possível carregar o efetivo.</p> : !rows.length ? <p className="placeholder-copy">Nenhum colaborador neste recorte.</p> : view === 'habilidades' ? (
          <CollaboratorSkillMatrix rows={rows} selectedId={selectedCollaboratorId} onSelect={id => onCollaboratorSelect?.(id)} editing={canManage && editingSkills} savingIds={savingSkillIds} onLevelChange={(row, key, level) => saveSkills.mutate({ id: row.id, skillLevels: withCollaboratorSkillLevel(row.skillLevels, key, level) })} />
        ) : (
          <div className="efetivo-table-wrap"><SortableTable className="efetivo-table efetivo-planning-table"><thead><tr><th>Colaborador</th><th>Função</th><th>Habilidades</th><th>Situação</th><th>Alocação 90d</th><th>Admissão</th><th>Alerta</th><th>Ações</th></tr></thead><tbody>{rows.map(row => <tr className={selectedCollaboratorId === row.id ? 'selected' : ''} data-collaborator-id={row.id} aria-current={selectedCollaboratorId === row.id ? 'true' : undefined} onClick={() => onCollaboratorSelect?.(row.id)} key={row.id}><td data-label="Colaborador"><strong>{row.name}</strong>{row.rhStatus === 'PRE_ADMISSION' ? <span className="efetivo-badge warning">Pré-admissão · aguardando RH</span> : null}</td><td data-label="Função">{row.role}</td><td data-label="Habilidades" data-sort-value={collaboratorSkillScore(row.skillLevels)}><CollaboratorSkillTags skillLevels={row.skillLevels} emptyLabel="Não avaliado" /></td><td data-label="Situação"><span className={`efetivo-status status-${row.status.toLocaleLowerCase('pt-BR')}`}>{statusLabel[row.status]}</span></td><td data-label="Alocação 90d">{row.plannedUtilization90d == null ? 'Indisponível' : `${row.plannedUtilization90d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</td><td data-label="Admissão" data-sort-value={row.admissionDate}>{row.admissionDate ? displayDateOnly(row.admissionDate) : 'Não informada'}{row.admissionDateProvisional ? ' (provisória)' : ''}</td><td data-label="Alerta" data-sort-value={row.vacationAlert?.concessionDeadline}>{row.vacationAlert ? <span className="efetivo-badge warning" title="Alerta operacional; valide também com folha/jurídico.">{row.vacationAlert.label} · {displayDateOnly(row.vacationAlert.concessionDeadline)}</span> : '—'}</td><td data-label="Ações" className="efetivo-people-actions-cell"><div className="efetivo-action-row efetivo-people-actions" onClick={event => event.stopPropagation()}>{canManage ? <><Button variant="secondary" size="sm" onClick={() => { setEditing(row); setFormOpen(true); }}>Editar</Button><Button variant="secondary" size="sm" onClick={() => setAbsencePerson(row)}>Indisponibilidade</Button></> : <span>Somente leitura</span>}</div></td></tr>)}</tbody></SortableTable></div>
        )}
        {view === 'lista' && rows.some(row => row.vacationAlert) ? <p className="efetivo-operational-disclaimer">Alertas de férias são operacionais e devem ser validados com folha e jurídico.</p> : null}
      </section>
      {selectedCollaboratorId ? <ConectaCompliancePanel collaboratorId={selectedCollaboratorId} date={date} /> : null}
      {canManage ? <OperationalCollaboratorModal open={formOpen} collaborator={editing} jobRoles={roles.data || []} saving={save.isPending} onClose={() => { setFormOpen(false); setEditing(null); }} onSubmit={payload => save.mutate(payload)} /> : null}
      {canManage ? <AbsenceFormModal open={Boolean(absencePerson)} absence={null} initialCollaboratorId={absencePerson?.id} collaborators={rows.map(row => ({ id: row.id, name: row.name, role: row.role, isActive: row.isActive }))} saving={absence.isPending} initialPrefill={absencePrefill ? { ...absencePrefill, note: 'Cadastro pedido pela conferência de alocação.' } : undefined} onClose={() => { setAbsencePerson(null); if (absencePrefill) onAbsencePrefillDone?.(); }} onSubmit={payload => absence.mutate(payload)} /> : null}
    </div>
  );
}
