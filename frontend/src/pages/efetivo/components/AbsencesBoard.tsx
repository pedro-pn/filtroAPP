import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  createEfetivoAbsence,
  listEfetivoCollaborators,
  listEfetivoAbsences,
  removeEfetivoAbsence,
  updateEfetivoAbsence,
  type EfetivoAbsence,
  type EfetivoAbsencePayload
} from '../../../api/efetivo';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/ToastContext';
import { defaultProductivityPeriod, productivityYearOptions } from '../utils/productivityPeriods';
import { AbsenceFormModal } from './AbsenceFormModal';

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function AbsencesBoard({ canManage, selectedAbsenceId }: { canManage: boolean; selectedAbsenceId?: string }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const fallbackYear = defaultProductivityPeriod().year;
  const requestedYear = Number(searchParams.get('ano'));
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 ? requestedYear : fallbackYear;
  const years = useMemo(() => productivityYearOptions(), []);
  const [editing, setEditing] = useState<EfetivoAbsence | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<EfetivoAbsence | null>(null);

  const absencesQuery = useQuery({
    queryKey: ['efetivo', 'ausencias', year],
    queryFn: () => listEfetivoAbsences({ ano: year })
  });
  const collaboratorsQuery = useQuery({
    queryKey: ['efetivo', 'collaborators'],
    queryFn: listEfetivoCollaborators,
    enabled: canManage
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['efetivo', 'ausencias'] }),
      queryClient.invalidateQueries({ queryKey: ['efetivo', 'produtividade'] }),
      queryClient.invalidateQueries({ queryKey: ['efetivo-planning-collaborators'] }),
      queryClient.invalidateQueries({ queryKey: ['efetivo-planning-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['efetivo-planning-calendar'] })
    ]);
  };
  const saveMutation = useMutation({
    mutationFn: (payload: EfetivoAbsencePayload) => editing
      ? updateEfetivoAbsence(editing.id, editing.version, {
        type: payload.type,
        startDate: payload.startDate,
        endDate: payload.endDate,
        note: payload.note
      })
      : createEfetivoAbsence(payload),
    onSuccess: async result => {
      await invalidate();
      const affected = result.affectedMissionIds.length;
      showToast(
        affected
          ? `Indisponibilidade salva. ${affected} missão(ões) ficaram pendentes de replanejamento.`
          : editing ? 'Indisponibilidade atualizada.' : 'Indisponibilidade cadastrada.',
        affected ? 'info' : 'success'
      );
      setEditing(null);
      setFormOpen(false);
    },
    onError: () => showToast('Não foi possível salvar. Verifique as datas e possíveis sobreposições.', 'error')
  });
  const deleteMutation = useMutation({
    mutationFn: (absence: EfetivoAbsence) => removeEfetivoAbsence(absence.id, absence.version),
    onSuccess: async () => {
      await invalidate();
      showToast('Indisponibilidade removida.', 'success');
      setDeleting(null);
    },
    onError: () => showToast('Não foi possível remover o período.', 'error')
  });

  function changeYear(nextYear: number) {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.set('ano', String(nextYear));
      return next;
    }, { replace: true });
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(absence: EfetivoAbsence) {
    setEditing(absence);
    setFormOpen(true);
  }

  const absences = absencesQuery.data || [];
  // Conflitos e eventos do calendário apontam para ?ausencia=… (FR-039/FR-040).
  useEffect(() => {
    if (!selectedAbsenceId || !absences.length) return;
    document.querySelector(`[data-absence-id="${CSS.escape(selectedAbsenceId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [absences.length, selectedAbsenceId]);
  return (
    <div className="efetivo-board" data-efetivo-absences>
      <section className="page-card efetivo-absence-toolbar">
        <div className="field-group">
          <label htmlFor="efetivo-absence-year">Ano</label>
          <select id="efetivo-absence-year" value={year} onChange={event => changeYear(Number(event.target.value))}>
            {years.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div>
          <strong>Férias e ausências</strong>
          <p>Os meses são sinalizados na Produtividade, sem alterar a taxa oficial.</p>
        </div>
        {canManage ? <Button onClick={openCreate}>Programar indisponibilidade</Button> : null}
      </section>

      <section className="page-card">
        {absencesQuery.isLoading ? <p className="placeholder-copy">Carregando indisponibilidades…</p>
          : absencesQuery.isError ? <p className="placeholder-copy">Não foi possível carregar os períodos.</p>
          : absences.length === 0 ? <p className="placeholder-copy">Nenhuma indisponibilidade cadastrada em {year}.</p>
          : (
            <div className="efetivo-absence-list">
              {absences.map(absence => (
                <article className={`efetivo-absence-card ${selectedAbsenceId === absence.id ? 'selected' : ''}`} data-absence-id={absence.id} aria-current={selectedAbsenceId === absence.id ? 'true' : undefined} key={absence.id}>
                  <div>
                    <strong>{absence.collaborator.name}</strong>
                    <span>{absence.collaborator.role}</span>
                  </div>
                  <div>
                    <span>{absence.type === 'FERIAS' ? 'Férias' : absence.type === 'FOLGA' ? 'Folga' : 'Afastamento'}</span>
                    <strong>{displayDate(absence.startDate)} a {displayDate(absence.endDate)}</strong>
                    {absence.note ? <small>{absence.note}</small> : null}
                  </div>
                  {canManage ? (
                    <div className="efetivo-absence-actions">
                      <Button variant="mini" onClick={() => openEdit(absence)}>Editar</Button>
                      <Button variant="danger" onClick={() => setDeleting(absence)}>Remover</Button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
      </section>

      {canManage ? (
        <AbsenceFormModal
          open={formOpen}
          absence={editing}
          collaborators={(collaboratorsQuery.data || []).filter(item => item.isActive || item.id === editing?.collaboratorId)}
          saving={saveMutation.isPending}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSubmit={payload => saveMutation.mutate(payload)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remover indisponibilidade?"
        description="O período deixa de aparecer na tela, mas a trilha é preservada."
        highlight={deleting ? `${deleting.collaborator.name} · ${displayDate(deleting.startDate)} a ${displayDate(deleting.endDate)}` : undefined}
        confirmLabel={deleteMutation.isPending ? 'Removendo…' : 'Remover'}
        onConfirm={() => { if (deleting && !deleteMutation.isPending) deleteMutation.mutate(deleting); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
