import { ConfirmDialog } from '../ui/ConfirmDialog';

export function ReportReissueDialog({ count, submitting, progress, onConfirm, onCancel }: {
  count: number;
  submitting: boolean;
  progress?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return <ConfirmDialog
    open={count > 0}
    appearance="design-system"
    title={count === 1 ? 'Reemitir relatório?' : 'Reemitir relatórios selecionados?'}
    description="Os relatórios serão gerados com os dados atuais do projeto. As rodadas de assinatura pendentes serão canceladas e geradas novamente. Os links anteriores de assinatura deixarão de funcionar. Relatórios já assinados ou enviados manualmente serão preservados."
    highlight={count === 1 ? '1 relatório selecionado' : `${count} relatórios selecionados`}
    confirmLabel={submitting ? `Reemitindo${progress ? ` ${progress}` : ''}…` : 'Reemitir'}
    danger={false}
    confirmDisabled={submitting}
    onCancel={() => { if (!submitting) onCancel(); }}
    onConfirm={onConfirm}
  />;
}
