import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { saveEfetivoReferenceSetting } from '../../../api/efetivo';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/ToastContext';

const referenceSchema = z.object({
  referenciaMensalHH: z.coerce
    .number({ error: 'Informe a referência mensal.' })
    .positive('A referência deve ser maior que zero.')
    .max(744, 'Informe uma referência mensal plausível.')
});

type ReferenceFormValues = z.infer<typeof referenceSchema>;
type ReferenceFormInput = z.input<typeof referenceSchema>;

interface Props {
  open: boolean;
  reference: number;
  onClose: () => void;
}

export function ReferenceSettingModal({ open, reference, onClose }: Props) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ReferenceFormInput, unknown, ReferenceFormValues>({
    resolver: zodResolver(referenceSchema),
    defaultValues: { referenciaMensalHH: reference }
  });
  const mutation = useMutation({
    mutationFn: (values: ReferenceFormValues) => saveEfetivoReferenceSetting(values.referenciaMensalHH),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['efetivo', 'produtividade'] });
      await queryClient.invalidateQueries({ queryKey: ['efetivo', 'parametros'] });
      showToast('Referência mensal atualizada.', 'success');
      onClose();
    },
    onError: () => showToast('Não foi possível atualizar a referência mensal.', 'error')
  });

  useEffect(() => {
    if (open) reset({ referenciaMensalHH: reference });
  }, [open, reference, reset]);

  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="efetivo-reference-title" panelClassName="modal-card efetivo-modal">
      <form className="efetivo-modal-layout" noValidate onSubmit={handleSubmit(values => mutation.mutate(values))}>
        <header className="efetivo-modal-header">
          <div>
            <h3 id="efetivo-reference-title">Editar referência mensal</h3>
            <p>O novo valor passa a valer na próxima consulta do indicador.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Fechar" onClick={onClose}>×</button>
        </header>
        <div className="efetivo-modal-body">
          <div className={errors.referenciaMensalHH ? 'field-group field-invalid' : 'field-group'}>
            <label htmlFor="efetivo-reference-value">HH produtivas por mês</label>
            <input
              id="efetivo-reference-value"
              type="number"
              min="0.01"
              max="744"
              step="0.01"
              aria-invalid={Boolean(errors.referenciaMensalHH)}
              {...register('referenciaMensalHH')}
            />
            {errors.referenciaMensalHH ? (
              <span className="field-error" role="alert">{errors.referenciaMensalHH.message}</span>
            ) : null}
          </div>
        </div>
        <footer className="efetivo-modal-footer">
          <Button variant="secondary" type="button" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : 'Salvar referência'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
