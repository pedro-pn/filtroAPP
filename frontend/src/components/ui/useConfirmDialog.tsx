import { useCallback, useRef, useState } from 'react';

import { ConfirmDialog } from './ConfirmDialog';

export interface ConfirmRequest {
  title: string;
  description?: string;
  highlight?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

// Confirmação no padrão visual do app (ConfirmDialog) com a ergonomia do window.confirm:
// `if (!(await confirm({ ... }))) return;`. Evita ter que espalhar um par de estados por
// ação destrutiva em telas que já têm várias. O componente que usa o hook precisa render
// `confirmDialog` uma vez no seu JSX.
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  const confirm = useCallback((next: ConfirmRequest) => {
    // Uma confirmação por vez: se outra ainda estiver aberta, ela é descartada como cancelada.
    resolverRef.current?.(false);
    setRequest(next);
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve;
    });
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      open={Boolean(request)}
      title={request?.title || ''}
      description={request?.description}
      highlight={request?.highlight}
      confirmLabel={request?.confirmLabel}
      cancelLabel={request?.cancelLabel}
      danger={request?.danger ?? true}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}
