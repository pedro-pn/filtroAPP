import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { deletePlanningHoliday, listPlanningHolidays, savePlanningHoliday, type Holiday } from '../../../api/efetivoPlanning';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';

const schema = z.object({
  holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data válida.'),
  name: z.string().trim().min(1, 'Informe o nome.').max(160, 'Use no máximo 160 caracteres.')
});

type FormValues = z.infer<typeof schema>;

export function HolidayManager({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [deleting, setDeleting] = useState<Holiday | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const query = useQuery({ queryKey: ['efetivo-planning-holidays'], queryFn: listPlanningHolidays });
  const { register, reset, handleSubmit, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { holidayDate: '', name: '' } });
  useEffect(() => {
    if (formOpen) reset({ holidayDate: editing?.holidayDate.slice(0, 10) || '', name: editing?.name || '' });
  }, [editing, formOpen, reset]);
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['efetivo-planning-holidays'] }),
    queryClient.invalidateQueries({ queryKey: ['efetivo-planning-overview'] }),
    queryClient.invalidateQueries({ queryKey: ['efetivo-planning-calendar'] })
  ]);
  const save = useMutation({
    mutationFn: (values: FormValues) => savePlanningHoliday({ holidayDate: values.holidayDate, name: values.name.trim() }, editing?.id),
    onSuccess: async () => { await refresh(); setEditing(null); setFormOpen(false); toast('Feriado salvo.', 'success'); },
    onError: (error: Error) => toast(error.message, 'error')
  });
  const remove = useMutation({ mutationFn: (id: string) => deletePlanningHoliday(id), onSuccess: async () => { await refresh(); setDeleting(null); toast('Feriado removido.', 'success'); }, onError: (error: Error) => toast(error.message, 'error') });

  return <section className="page-card">
    <div className="efetivo-section-heading"><div><h2>Feriados globais</h2><p>Saem da capacidade útil e continuam visíveis no calendário.</p></div>{canManage ? <Button onClick={() => { setEditing(null); setFormOpen(true); }}>Cadastrar feriado</Button> : null}</div>
    {query.isLoading ? <p className="placeholder-copy">Carregando feriados…</p> : query.isError ? <p className="placeholder-copy">Não foi possível carregar os feriados.</p> : query.data?.length ? <div className="efetivo-compact-list">{query.data.map(item => <article key={item.id}><div><strong>{item.name}</strong><span>{displayDateOnly(item.holidayDate)}</span></div>{canManage ? <div className="efetivo-action-row"><Button variant="mini" onClick={() => { setEditing(item); setFormOpen(true); }}>Editar</Button><Button variant="danger" onClick={() => setDeleting(item)}>Remover</Button></div> : null}</article>)}</div> : <p className="placeholder-copy">Nenhum feriado global cadastrado.</p>}
    <Modal open={formOpen} onClose={() => setFormOpen(false)} ariaLabelledBy="holiday-form-title" panelClassName="modal-card efetivo-modal">
      <form className="efetivo-modal-layout" noValidate onSubmit={handleSubmit(values => save.mutate(values))}>
        <header className="efetivo-modal-header"><div><h3 id="holiday-form-title">{editing ? 'Editar feriado' : 'Novo feriado'}</h3><p>A data será aplicada à capacidade de todas as funções.</p></div><button className="icon-button" type="button" aria-label="Fechar" onClick={() => setFormOpen(false)}>×</button></header>
        <div className="efetivo-modal-body efetivo-form-grid">
          <div className={`field-group ${errors.holidayDate ? 'field-invalid' : ''}`}><label htmlFor="holiday-date">Data *</label><input id="holiday-date" type="date" disabled={save.isPending} aria-invalid={Boolean(errors.holidayDate)} {...register('holidayDate')} />{errors.holidayDate ? <span className="field-error" role="alert">{errors.holidayDate.message}</span> : null}</div>
          <div className={`field-group ${errors.name ? 'field-invalid' : ''}`}><label htmlFor="holiday-name">Nome *</label><input id="holiday-name" disabled={save.isPending} aria-invalid={Boolean(errors.name)} {...register('name')} />{errors.name ? <span className="field-error" role="alert">{errors.name.message}</span> : null}</div>
        </div>
        <footer className="efetivo-modal-footer"><Button variant="secondary" onClick={() => setFormOpen(false)} disabled={save.isPending}>Cancelar</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar feriado'}</Button></footer>
      </form>
    </Modal>
    <ConfirmDialog open={Boolean(deleting)} title="Remover feriado?" description="A data voltará a compor a capacidade útil." highlight={deleting?.name} confirmLabel={remove.isPending ? 'Removendo…' : 'Remover'} onConfirm={() => { if (deleting && !remove.isPending) remove.mutate(deleting.id); }} onCancel={() => setDeleting(null)} />
  </section>;
}
