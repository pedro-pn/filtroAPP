import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useToast } from '../../../components/ui/ToastContext';

export function useAdministrationAutosave<T>({ savedValue, canManage, validate, save }: {
  savedValue: T;
  canManage: boolean;
  validate: (value: T) => boolean;
  save: (value: T) => Promise<unknown>;
}) {
  const toast = useToast();
  // Keep unfinished edits when another field's save refreshes the query.
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  const saving = useRef(false);
  const value = draft ? draft.value : savedValue;
  const mutation = useMutation({
    mutationFn: save,
    onSuccess: (_result, submitted) => {
      setDraft(current => current && Object.is(current.value, submitted) ? null : current);
    },
    onError: (error: Error) => toast(error.message || 'Não foi possível salvar a alteração.', 'error'),
    onSettled: () => { saving.current = false; }
  });

  function change(next: T) {
    setDraft(Object.is(next, savedValue) ? null : { value: next });
    if (!saving.current) mutation.reset();
  }

  function commit(next: T = value) {
    if (!canManage || saving.current || !validate(next) || Object.is(next, savedValue)) return;
    saving.current = true;
    mutation.mutate(next);
  }

  return { value, change, commit, isPending: mutation.isPending, isError: mutation.isError,
    isSuccess: mutation.isSuccess, canManage };
}
