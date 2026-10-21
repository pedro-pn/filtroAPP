export async function copyTextToClipboard(text: string, anchor?: HTMLElement | null): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* Tenta a cópia pelo comando do navegador se a permissão foi recusada. */ }
  }
  // Em HTTP, este caminho precisa executar durante o clique, sem aguardar outra tarefa.
  if (typeof document.execCommand !== 'function') return false;
  const previousFocus = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.tabIndex = -1;
  Object.assign(field.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0' });
  const host = (anchor ?? previousFocus)?.closest('[role="dialog"], [role="alertdialog"]') ?? document.body;
  try {
    host.appendChild(field);
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, field.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.value = '';
    field.remove();
    previousFocus?.focus?.({ preventScroll: true });
  }
}
