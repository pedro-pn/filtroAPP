import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { deletePlanningHoliday, listPlanningHolidays, savePlanningHoliday, type Holiday } from '../../../api/efetivoPlanning';
import { Button, Card, EmptyState, Field, Input, Skeleton } from '../../../components/ui/ds';
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

  return <Card className="efetivo-administration-section efetivo-holidays-ds">
    <div className="efetivo-section-heading"><div><h2>Feriados globais</h2><p>Saem da capacidade útil e continuam visíveis no calendário.</p></div>{canManage ? <Button variant="primary" size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>Cadastrar feriado</Button> : null}</div>
    {query.isLoading ? <Skeleton variant="card" /> : query.isError ? <EmptyState variant="error" title="Não foi possível carregar os feriados." action={{ label: 'Tentar novamente', onClick: () => void query.refetch() }} /> : query.data?.length ? <div className="efetivo-compact-list">{query.data.map(item => <article key={item.id}><div><strong>{item.name}</strong><span>{displayDateOnly(item.holidayDate)}</span></div>{canManage ? <div className="efetivo-action-row"><Button variant="secondary" size="sm" onClick={() => { setEditing(item); setFormOpen(true); }}>Editar</Button><Button variant="danger" size="sm" onClick={() => setDeleting(item)}>Remover</Button></div> : null}</article>)}</div> : <EmptyState title="Nenhum feriado global cadastrado." />}
    <Modal open={formOpen} onClose={() => { if (!save.isPending) setFormOpen(false); }} closeOnEscape={!save.isPending} showCloseButton={!save.isPending}
      appearance="design-system" title={editing ? 'Editar feriado' : 'Novo feriado'} size="md" fullscreenOnMobile={false}
      panelClassName="efetivo-dialog" ariaDescribedBy="holiday-form-description"
      footer={<><Button variant="secondary" size="sm" onClick={() => setFormOpen(false)} disabled={save.isPending}>Cancelar</Button><Button variant="primary" size="sm" type="submit" form="efetivo-holiday-form" loading={save.isPending}>Salvar feriado</Button></>}>
      <form id="efetivo-holiday-form" className="efetivo-dialog-form" noValidate onSubmit={handleSubmit(values => save.mutate(values))}>
        <p id="holiday-form-description" className="efetivo-dialog-description">A data será aplicada à capacidade de todas as funções.</p>
        <div className="efetivo-dialog-fields">
          <Field id="holiday-date" label="Data" required errorText={errors.holidayDate?.message}><Input size="sm" type="date" disabled={save.isPending} {...register('holidayDate')} /></Field>
          <Field id="holiday-name" label="Nome" required errorText={errors.name?.message}><Input size="sm" disabled={save.isPending} {...register('name')} /></Field>
        </div>
      </form>
    </Modal>
    <ConfirmDialog appearance="design-system" open={Boolean(deleting)} title="Remover feriado?" description="A data voltará a compor a capacidade útil." highlight={deleting?.name} confirmLabel={remove.isPending ? 'Removendo…' : 'Remover'} onConfirm={() => { if (deleting && !remove.isPending) remove.mutate(deleting.id); }} onCancel={() => setDeleting(null)} />
  </Card>;
}
