import type { ReportSummary } from '../../types/domain';
import { reportSignatureProgress, signedSignerNames } from '../../utils/signatureProgress';

export function SignatureProgress({ report }: { report: ReportSummary }) {
  const progress = reportSignatureProgress(report);
  if (!progress) return null;

  const signedNames = signedSignerNames(progress);
  return (
    <div className="signature-progress">
      <div className="signature-progress-head">
        <span>Assinaturas {progress.signed}/{progress.total}</span>
        {progress.pending ? <span>{progress.pending} pendente{progress.pending !== 1 ? 's' : ''}</span> : <span>Concluído</span>}
      </div>
      {signedNames.length ? (
        <div className="signature-progress-names">
          Assinado por: {signedNames.join(', ')}
        </div>
      ) : null}
    </div>
  );
}
