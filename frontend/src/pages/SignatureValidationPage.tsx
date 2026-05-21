import { useState, type DragEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { getSignatureValidation } from '../api/signatureValidation';
import { useToast } from '../components/ui/Toast';
import { formatDateOnlyPtBr } from '../utils/dateOnly';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const logoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_VERDE.png`;

const statusLabels: Record<string, string> = {
  VALID: 'Documento válido',
  SUPERSEDED: 'Documento substituído',
  REJECTED: 'Assinatura reprovada',
  UNAVAILABLE: 'Validação indisponível',
  INVALID: 'Código não encontrado'
};

async function sha256File(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

export function SignatureValidationPage() {
  const { validationCode = '' } = useParams();
  const showToast = useToast();
  const [fileHash, setFileHash] = useState('');
  const [fileName, setFileName] = useState('');
  const [hashing, setHashing] = useState(false);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);

  const validationQuery = useQuery({
    queryKey: ['signature-validation', validationCode],
    queryFn: () => getSignatureValidation(validationCode),
    enabled: !!validationCode
  });

  const payload = validationQuery.data;
  const expectedHash = payload?.finalDocumentHash || '';
  const hashMatches = Boolean(fileHash && expectedHash && fileHash === expectedHash);
  const hashCompared = Boolean(fileHash && expectedHash);

  async function handleFile(file?: File) {
    setFileHash('');
    setFileName('');
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      showToast('Envie um arquivo PDF.', 'error');
      return;
    }
    setHashing(true);
    try {
      setFileHash(await sha256File(file));
      setFileName(file.name);
    } catch {
      showToast('Não foi possível calcular o hash do arquivo.', 'error');
    } finally {
      setHashing(false);
    }
  }

  function handlePdfDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDraggingPdf(true);
  }

  function handlePdfDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDraggingPdf(false);
    void handleFile(event.dataTransfer.files?.[0]);
  }

  return (
    <main className="survey-page-shell signature-validation-page">
      <header className="survey-header">
        <img src={logoUrl} alt="Filtrovali" />
      </header>
      <section className="auth-card signature-validation-card">
        <div className="section-title">Validação de assinatura</div>
        {validationQuery.isLoading ? <p className="placeholder-copy">Carregando validação...</p> : null}
        {validationQuery.isError ? (
          <p className="inline-error">
            {validationQuery.error instanceof Error ? validationQuery.error.message : 'Não foi possível carregar a validação.'}
          </p>
        ) : null}
        {payload ? (
          <>
            <div className={`signature-validation-status status-${payload.status.toLowerCase()}`}>
              {statusLabels[payload.status] || payload.status}
            </div>
            {payload.report ? (
              <div className="det-section">
                <div className="det-row"><span className="det-label">Código</span><span className="det-val">{payload.validationCode}</span></div>
                <div className="det-row"><span className="det-label">Projeto</span><span className="det-val">{payload.report.project.code} - {payload.report.project.name}</span></div>
                <div className="det-row"><span className="det-label">Relatório</span><span className="det-val">{payload.report.reportType} {payload.report.sequenceNumber || ''}</span></div>
                <div className="det-row"><span className="det-label">Data</span><span className="det-val">{formatDateOnlyPtBr(payload.report.reportDate || '')}</span></div>
              </div>
            ) : null}
            {expectedHash ? (
              <div className="signature-validation-hashes">
                <div><span className="detail-label">Hash PDF final esperado</span><span className="detail-value">{expectedHash}</span></div>
                <div><span className="detail-label">Hash PDF-base</span><span className="detail-value">{payload.sourceDocumentHash || '-'}</span></div>
              </div>
            ) : null}
            {payload.signers?.length ? (
              <div className="signature-validation-signers">
                <div className="section-subtitle">Signatários</div>
                {payload.signers.map(signer => (
                  <div className="det-row" key={`${signer.email}-${signer.status}`}>
                    <span className="det-label">{signer.status}</span>
                    <span className="det-val">{signer.name} ({signer.email}) - {formatDateTime(signer.signedAt || signer.rejectedAt)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {expectedHash ? (
              <div className="signature-validation-upload">
                <label
                  className={`signature-validation-file ${isDraggingPdf ? 'is-dragging' : ''} ${fileName ? 'has-file' : ''}`}
                  onDragEnter={handlePdfDragOver}
                  onDragOver={handlePdfDragOver}
                  onDragLeave={() => setIsDraggingPdf(false)}
                  onDrop={handlePdfDrop}
                  aria-busy={hashing}
                >
                  <span className="signature-validation-file-icon">PDF</span>
                  <span className="signature-validation-file-copy">
                    <strong>{hashing ? 'Calculando hash...' : fileName || 'Adicionar PDF assinado'}</strong>
                    <small>{fileName ? 'Clique ou arraste outro PDF para trocar o arquivo.' : 'Clique para selecionar ou arraste o documento para esta área.'}</small>
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={event => {
                      void handleFile(event.target.files?.[0]);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                {hashCompared ? (
                  <div className={hashMatches ? 'inline-success' : 'inline-error'}>
                    {hashMatches ? 'O arquivo enviado corresponde ao PDF final registrado.' : 'O hash do arquivo enviado não corresponde ao registro.'}
                  </div>
                ) : null}
                {fileHash ? (
                  <div className="signature-validation-hashes">
                    <div><span className="detail-label">Hash calculado localmente</span><span className="detail-value">{fileHash}</span></div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="placeholder-copy">
              Dados técnicos completos, como IP e user-agent integrais, ficam disponíveis apenas no painel autenticado do gestor.
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
