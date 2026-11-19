import { Alert } from '../ui/ds/Alert';
import { reportDateWarningId, reportDateWarningMessage } from '../../utils/reportDateWarning';

/**
 * Aviso inline e não bloqueante para a data do relatório (ano diferente do atual
 * ou dia no futuro). A região viva fica sempre no DOM para o leitor de tela
 * anunciar quando o aviso aparece; nunca impede salvar ou enviar.
 */
export function ReportDateWarning({ inputId, value }: { inputId: string; value: string | null | undefined }) {
  const message = reportDateWarningMessage(value);
  return (
    <div className="report-date-warning" role="status" aria-live="polite" data-testid="report-date-warning">
      {message ? (
        <Alert id={reportDateWarningId(inputId)} tone="warning" role="none">
          {message}
        </Alert>
      ) : null}
    </div>
  );
}
