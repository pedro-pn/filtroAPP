import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { saveEfetivoReferenceSetting } from '../../../api/efetivo';
import { Button, Field, Input } from '../../../components/ui/ds';
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
    <Modal open={open} onClose={onClose} closeOnEscape={!mutation.isPending} showCloseButton={!mutation.isPending}
      appearance="design-system" title="Editar referência mensal" size="sm" fullscreenOnMobile={false}
      panelClassName="efetivo-dialog" ariaDescribedBy="efetivo-reference-description"
      footer={<>
        <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
        <Button variant="primary" size="sm" type="submit" form="efetivo-reference-form" loading={mutation.isPending}>Salvar referência</Button>
      </>}
    >
      <form id="efetivo-reference-form" className="efetivo-dialog-form" noValidate onSubmit={handleSubmit(values => mutation.mutate(values))}>
        <p id="efetivo-reference-description" className="efetivo-dialog-description">O novo valor passa a valer na próxima consulta do indicador.</p>
        <Field id="efetivo-reference-value" label="HH produtivas por mês" required errorText={errors.referenciaMensalHH?.message}>
          <Input size="sm"
              type="number"
              min="0.01"
              max="744"
              step="0.01"
              disabled={mutation.isPending}
              {...register('referenciaMensalHH')}
            />
        </Field>
      </form>
    </Modal>
  );
}
