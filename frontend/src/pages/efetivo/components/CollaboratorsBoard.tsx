import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  createPlanningAbsence,
  createPlanningCollaborator,
  listPlanningCollaborators,
  listPlanningJobRoles,
  planningErrorConflicts,
  updatePlanningCollaborator,
  type CollaboratorInput,
  type PlanningCollaborator
} from '../../../api/efetivoPlanning';
import type { EfetivoAbsencePayload } from '../../../api/efetivo';
import { Button } from '../../../components/ui/Button';
import { SearchBar } from '../../../components/ui/SearchBar';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { AbsenceFormModal } from './AbsenceFormModal';
import { OperationalCollaboratorModal } from './OperationalCollaboratorModal';

const statusLabel = { ALLOCATED: 'Alocado', UNAVAILABLE: 'Indisponível', FREE: 'Livre', OUTSIDE_EMPLOYMENT: 'Fora do vínculo' } as const;

export function CollaboratorsBoard({ date, jobRoleId, search, canManage, selectedCollaboratorId, onSearchChange, onCollaboratorSelect }: {
  date: string;
  jobRoleId?: string;
  search: string;
  canManage: boolean;
  selectedCollaboratorId?: string;
  onSearchChange: (value: string) => void;
  onCollaboratorSelect?: (value?: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<PlanningCollaborator | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [absencePerson, setAbsencePerson] = useState<PlanningCollaborator | null>(null);
  const collaborators = useQuery({ queryKey: ['efetivo-planning-collaborators', date, jobRoleId || 'all', search], queryFn: () => listPlanningCollaborators({ date, jobRoleId, search: search || undefined }) });
  const roles = useQuery({ queryKey: ['efetivo-planning-job-roles'], queryFn: listPlanningJobRoles });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['efetivo-planning-collaborators'] }), queryClient.invalidateQueries({ queryKey: ['efetivo-planning-overview'] }), queryClient.invalidateQueries({ queryKey: ['efetivo-planning-calendar'] })]);
  const save = useMutation({
    mutationFn: (payload: CollaboratorInput) => editing ? updatePlanningCollaborator(editing.id, payload) : createPlanningCollaborator(payload),
    onSuccess: async () => { await refresh(); setFormOpen(false); setEditing(null); toast('Colaborador salvo.', 'success'); },
    onError: (error: Error) => toast(error.message || 'Não foi possível salvar.', 'error')
  });
  const absence = useMutation({
    mutationFn: (payload: EfetivoAbsencePayload) => createPlanningAbsence({ collaboratorId: payload.collaboratorId, type: payload.type || 'FERIAS', startDate: payload.startDate, endDate: payload.endDate, note: payload.note || null }),
    onSuccess: async () => { await refresh(); setAbsencePerson(null); toast('Indisponibilidade programada.', 'success'); },
    onError: (error: Error) => {
      const conflict = planningErrorConflicts(error)?.[0];
      toast(conflict ? `${error.message} ${conflict.collaboratorName || ''}: ${displayDateOnly(conflict.startDate)} a ${displayDateOnly(conflict.endDate)}.` : error.message, 'error');
    }
  });
  const rows = collaborators.data || [];
  // Os links da visão geral e do calendário chegam com ?colaborador=…; a linha correspondente
  // é destacada e trazida para a tela (FR-039).
  useEffect(() => {
    if (!selectedCollaboratorId || !rows.length) return;
    document.querySelector(`[data-collaborator-id="${CSS.escape(selectedCollaboratorId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [rows.length, selectedCollaboratorId]);
  return (
    <div className="efetivo-board" data-efetivo-collaborators>
      <section className="page-card efetivo-list-toolbar"><SearchBar value={search} onChange={onSearchChange} placeholder="Buscar colaborador" count={{ shown: rows.length, total: rows.length }} /><span className="efetivo-toolbar-copy">Situação em {displayDateOnly(date)}</span>{canManage ? <Button onClick={() => { setEditing(null); setFormOpen(true); }}>Novo colaborador</Button> : null}</section>
      <section className="page-card">
        {collaborators.isLoading ? <p className="placeholder-copy">Carregando colaboradores…</p> : collaborators.isError ? <p className="placeholder-copy">Não foi possível carregar o efetivo.</p> : !rows.length ? <p className="placeholder-copy">Nenhum colaborador neste recorte.</p> : (
          <div className="efetivo-table-wrap"><table className="efetivo-table efetivo-planning-table"><thead><tr><th>Colaborador</th><th>Função</th><th>Situação</th><th>Alocação 90d</th><th>Admissão</th><th>Alerta</th><th>Ações</th></tr></thead><tbody>{rows.map(row => <tr className={selectedCollaboratorId === row.id ? 'selected' : ''} data-collaborator-id={row.id} aria-current={selectedCollaboratorId === row.id ? 'true' : undefined} onClick={() => onCollaboratorSelect?.(row.id)} key={row.id}><td data-label="Colaborador"><strong>{row.name}</strong></td><td data-label="Função">{row.role}</td><td data-label="Situação"><span className={`efetivo-status status-${row.status.toLocaleLowerCase('pt-BR')}`}>{statusLabel[row.status]}</span></td><td data-label="Alocação 90d">{row.plannedUtilization90d == null ? 'Indisponível' : `${row.plannedUtilization90d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</td><td data-label="Admissão">{row.admissionDate ? displayDateOnly(row.admissionDate) : 'Não informada'}</td><td data-label="Alerta">{row.vacationAlert ? <span className="efetivo-badge warning" title="Alerta operacional; valide também com folha/jurídico.">{row.vacationAlert.label} · {displayDateOnly(row.vacationAlert.concessionDeadline)}</span> : '—'}</td><td data-label="Ações"><div className="efetivo-action-row">{canManage ? <><Button variant="mini" onClick={() => { setEditing(row); setFormOpen(true); }}>Editar</Button><Button variant="mini" onClick={() => setAbsencePerson(row)}>Indisponibilidade</Button></> : <span>Somente leitura</span>}</div></td></tr>)}</tbody></table></div>
        )}
        {rows.some(row => row.vacationAlert) ? <p className="efetivo-operational-disclaimer">Alertas de férias são operacionais e devem ser validados com folha e jurídico.</p> : null}
      </section>
      {canManage ? <OperationalCollaboratorModal open={formOpen} collaborator={editing} jobRoles={roles.data || []} saving={save.isPending} onClose={() => { setFormOpen(false); setEditing(null); }} onSubmit={payload => save.mutate(payload)} /> : null}
      {canManage ? <AbsenceFormModal open={Boolean(absencePerson)} absence={null} initialCollaboratorId={absencePerson?.id} collaborators={rows.map(row => ({ id: row.id, name: row.name, role: row.role, isActive: row.isActive }))} saving={absence.isPending} onClose={() => setAbsencePerson(null)} onSubmit={payload => absence.mutate(payload)} /> : null}
    </div>
  );
}
