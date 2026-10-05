import { useState, type DragEvent } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { getEpiSignatureValidation, getSignatureValidation, getStandaloneSignatureValidation } from '../api/signatureValidation';
import { BrandLogo } from '../components/brand/BrandLogo';
import { Alert, Card, Skeleton, StatusPill, type SemanticTone } from '../components/ui/ds';
import { useToast } from '../components/ui/ToastContext';
import { formatSignatureDateTime } from './assinaturas/utils/datetime';
import { formatDateOnlyPtBr } from '../utils/dateOnly';

import './RdoPublicPage.css';

const statusLabels: Record<string, string> = {
  VALID: 'Documento válido',
  SUPERSEDED: 'Documento substituído',
  REJECTED: 'Assinatura reprovada',
  UNAVAILABLE: 'Validação indisponível',
  INVALID: 'Código não encontrado'
};

const statusTones: Record<string, SemanticTone> = {
  VALID: 'success',
  SUPERSEDED: 'warning',
  REJECTED: 'danger',
  UNAVAILABLE: 'neutral',
  INVALID: 'danger'
};

const signerStatusLabels: Record<string, string> = {
  SIGNED: 'Assinado',
  REJECTED: 'Reprovado',
  PENDING: 'Pendente'
};

async function sha256File(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function SignatureValidationPage({ source = 'report' }: { source?: 'report' | 'standalone' | 'epi' }) {
  const { validationCode = '' } = useParams();
  const showToast = useToast();
  const [fileHash, setFileHash] = useState('');
  const [fileName, setFileName] = useState('');
  const [hashing, setHashing] = useState(false);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);

  const validationQuery = useQuery({
    queryKey: ['signature-validation', source, validationCode],
    queryFn: () => {
      if (source === 'epi') return getEpiSignatureValidation(validationCode);
      return source === 'standalone' ? getStandaloneSignatureValidation(validationCode) : getSignatureValidation(validationCode);
    },
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
    <main className="fv-ds rdo-public-shell signature-validation-page" data-fv-ds>
      <header className="rdo-public-header">
        <BrandLogo className="rdo-public-logo" />
      </header>
      <Card className="rdo-public-card signature-validation-card" padding="lg" title="Validação de assinatura">
        {validationQuery.isLoading ? <Skeleton variant="text" lines={6} label="Carregando validação" /> : null}
        {validationQuery.isError ? (
          <Alert tone="danger" title="Não foi possível carregar a validação">
            {validationQuery.error instanceof Error ? validationQuery.error.message : 'Não foi possível carregar a validação.'}
          </Alert>
        ) : null}
        {payload ? (
          <>
            <StatusPill className="rdo-public-status" status={payload.status} label={statusLabels[payload.status] || payload.status} tone={statusTones[payload.status] || 'neutral'} />
            {payload.report ? (
              <dl className="rdo-public-details">
                <div><dt>Código</dt><dd>{payload.validationCode}</dd></div>
                <div><dt>Projeto</dt><dd>{payload.report.project.code} - {payload.report.project.name}</dd></div>
                <div><dt>Relatório</dt><dd>{payload.report.reportType} {payload.report.sequenceNumber || ''}</dd></div>
                <div><dt>Data</dt><dd>{formatDateOnlyPtBr(payload.report.reportDate || '')}</dd></div>
              </dl>
            ) : null}
            {payload.document ? (
              <dl className="rdo-public-details">
                <div><dt>Código</dt><dd>{payload.validationCode}</dd></div>
                <div><dt>Documento</dt><dd>{payload.document.title}</dd></div>
                <div><dt>Arquivo original</dt><dd>{payload.document.originalFileName}</dd></div>
                <div><dt>Solicitante</dt><dd>{payload.document.requesterNameSnapshot}</dd></div>
                <div><dt>Concluído em</dt><dd>{formatSignatureDateTime(payload.completedAt)}</dd></div>
              </dl>
            ) : null}
            {payload.epi ? (
              <>
                <dl className="rdo-public-details">
                  <div><dt>Código</dt><dd>{payload.validationCode}</dd></div>
                  <div><dt>Documento</dt><dd>Ficha de Controle de EPIs</dd></div>
                  <div><dt>Colaborador</dt><dd>{payload.epi.collaboratorName}</dd></div>
                  <div><dt>Assinado em</dt><dd>{formatSignatureDateTime(payload.completedAt)}</dd></div>
                </dl>
                <div className="signature-validation-signers">
                  <div className="section-subtitle">EPIs abrangidos por esta assinatura</div>
                  {payload.epi.records.map((record, index) => (
                    <div className="det-row" key={index}>
                      <span className="det-label">{record.epiName} · CA {record.ca || '-'} · Qtd. {record.quantity}</span>
                      <span className="det-val">
                        Fornecimento: {formatDateOnlyPtBr(record.lendDate)}
                        {record.devolutionDate ? ` · Devolução: ${formatDateOnlyPtBr(record.devolutionDate)}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="rdo-public-footnote">
                  A comparação abaixo verifica o PDF preservado desta solicitação de assinatura.
                  Uma ficha consolidada emitida depois, com outros EPIs ou assinaturas, possui um hash diferente.
                </p>
              </>
            ) : null}
            {expectedHash ? (
              <div className="signature-validation-hashes">
                <div><span className="detail-label">Hash PDF final esperado</span><span className="detail-value">{expectedHash}</span></div>
                <div><span className="detail-label">Hash PDF-base</span><span className="detail-value">{payload.sourceDocumentHash || '-'}</span></div>
                {payload.signatureImageHash ? <div><span className="detail-label">Hash da assinatura visual</span><span className="detail-value">{payload.signatureImageHash}</span></div> : null}
              </div>
            ) : null}
            {payload.signers?.length ? (
              <div className="signature-validation-signers">
                <div className="section-subtitle">Signatários</div>
                {payload.signers.map(signer => (
                  <div className="det-row" key={`${signer.email || signer.name}-${signer.status}`}>
                    <span className="det-label">{signerStatusLabels[signer.status] || signer.status}</span>
                    <span className="det-val">
                      {signer.name}{signer.email ? ` (${signer.email})` : ''}
                      {signer.declaredName ? ` - nome informado: ${signer.declaredName}` : ''}
                      {' - '}
                      {formatSignatureDateTime(signer.signedAt || signer.rejectedAt)}
                    </span>
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
            <p className="rdo-public-footnote">
              {source === 'epi'
                ? 'O anexo do PDF assinado contém os dados de auditoria registrados para esta assinatura.'
                : 'Dados técnicos completos, como IP e user-agent integrais, ficam disponíveis apenas no painel autenticado do gestor.'}
            </p>
          </>
        ) : null}
      </Card>
    </main>
  );
}
