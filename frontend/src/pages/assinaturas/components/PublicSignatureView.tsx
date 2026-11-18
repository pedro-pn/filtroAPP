import { useState, type ReactNode } from 'react';

import type { PublicSignatureInvite } from '../../../api/assinaturas';
import { BrandLogo } from '../../../components/brand/BrandLogo';
import { Alert, Badge, Button, Card, EmptyState, Skeleton, StatusPill } from '../../../components/ui/ds';
import { ThemeToggle } from '../../../theme/ThemeToggle';
import { normalizedToPercent } from '../utils/coordinates';
import { formatSignatureDateTime } from '../utils/datetime';
import '../AssinaturasPublicSignPage.ds.css';

export function PublicSignatureShell({ children }: { children: ReactNode }) {
  return (
    <main className="fv-ds assinaturas-public" data-fv-ds>
      <div className="assinaturas-public__container">
        <header className="assinaturas-public__brand">
          <BrandLogo className="assinaturas-public__logo" />
          <ThemeToggle />
        </header>
        {children}
        <p className="assinaturas-public__footnote">Assinatura eletrônica de documento · Filtrovali</p>
      </div>
    </main>
  );
}

export function PublicSignatureState({ loading, title, description, onRetry, retrying }: {
  loading?: boolean;
  title: string;
  description?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Card className="assinaturas-public__state" padding="lg">
      <h1>{title}</h1>
      {loading ? <Skeleton variant="card" label="Carregando convite" /> : (
        <EmptyState variant="error" title="Não é possível acessar o documento agora" description={description}
          action={onRetry ? <Button size="sm" variant="secondary" onClick={onRetry} loading={retrying}>Tentar novamente</Button> : undefined} />
      )}
    </Card>
  );
}

export function PublicSignatureView({ invite, pageNumber, imageUrl, imageError, downloading, feedback,
  onPageChange, onImageError, onRetryImage, onSign, onDownload }: {
  invite: PublicSignatureInvite;
  pageNumber: number;
  imageUrl: string;
  imageError: boolean;
  downloading: boolean;
  feedback?: ReactNode;
  onPageChange: (page: number) => void;
  onImageError: () => void;
  onRetryImage: () => void;
  onSign: () => void;
  onDownload: () => void;
}) {
  const [loadedUrl, setLoadedUrl] = useState('');
  const imageReady = Boolean(imageUrl && loadedUrl === imageUrl && !imageError);
  const signed = invite.signer.status === 'ASSINADO';
  const pageFields = invite.fields.filter(field => field.pageNumber === pageNumber);

  return (
    <>
      <Card className="assinaturas-public__summary" padding="md">
        <div className="assinaturas-public__heading">
          <div>
            <p className="assinaturas-public__eyebrow">Assinatura de documento</p>
            <h1 id="assinaturas-public-title" tabIndex={-1}>{invite.document.title}</h1>
          </div>
          <StatusPill status={signed ? 'Assinado' : 'Pendente'} dot={false} />
        </div>
        <p className="assinaturas-public__filename">{invite.document.originalFileName}</p>
        <dl className="assinaturas-public__metadata">
          <div><dt>Solicitado por</dt><dd>{invite.document.requestedBy}</dd></div>
          <div><dt>Assinante</dt><dd>{invite.signer.name}</dd></div>
          <div><dt>Link válido até</dt><dd>{formatSignatureDateTime(invite.expiresAt)}</dd></div>
        </dl>
        <div className="assinaturas-public__progress">
          <Badge tone="info">{invite.document.progress.signed} de {invite.document.progress.total} assinaturas</Badge>
          <span>{invite.document.pageCount} página(s)</span>
        </div>
      </Card>

      <Card className="assinaturas-public__reader" padding="md">
        <h2>Leia o documento</h2>
        <p className="assinaturas-public__hint">Confira o conteúdo antes de assinar. As marcações indicam onde sua assinatura será inserida.</p>
        <div id="assinaturas-public-preview" className="assinaturas-public__preview" aria-busy={!imageReady && !imageError}>
          {imageError ? (
            <EmptyState variant="error" title="Não foi possível carregar esta página" description="Tente novamente para visualizar o documento."
              action={<Button variant="secondary" size="sm" onClick={onRetryImage}>Recarregar página</Button>} />
          ) : (
            <>
              {!imageReady ? <Skeleton className="assinaturas-public__page-loading" height="24rem" label={`Carregando página ${pageNumber}`} /> : null}
              {imageUrl ? (
                <div className="assinaturas-public__paper" hidden={!imageReady}>
                  <img src={imageUrl} alt={`Página ${pageNumber} de ${invite.document.pageCount} do documento ${invite.document.title}`}
                    onLoad={() => setLoadedUrl(imageUrl)} onError={onImageError} />
                  {imageReady ? pageFields.map((field, index) => (
                    <div className="assinaturas-public__field" key={index} style={normalizedToPercent(field)} aria-hidden="true"><span>Sua assinatura</span></div>
                  )) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
        {imageReady ? <p className="assinaturas-public__hint">{pageFields.length ? `${pageFields.length} campo(s) da sua assinatura nesta página.` : 'Esta página não possui campos da sua assinatura.'}</p> : null}
        <div className="assinaturas-public__navigation" role="group" aria-label="Paginação do documento">
          <Button variant="secondary" size="sm" disabled={pageNumber <= 1} onClick={() => onPageChange(pageNumber - 1)} aria-controls="assinaturas-public-preview">Anterior</Button>
          <span aria-live="polite" aria-atomic="true">{pageNumber} / {invite.document.pageCount}</span>
          <Button variant="secondary" size="sm" disabled={pageNumber >= invite.document.pageCount} onClick={() => onPageChange(pageNumber + 1)} aria-controls="assinaturas-public-preview">Próxima</Button>
        </div>
      </Card>

      <Card className="assinaturas-public__sign" padding="md">
        {feedback}
        {invite.document.status === 'FINALIZANDO' ? <Alert tone="info" title="Finalizando o PDF assinado">A assinatura foi recebida. Esta tela atualiza automaticamente.</Alert>
          : invite.document.status === 'CONCLUIDO' ? <Alert tone="success" title="Documento concluído">Todas as assinaturas foram registradas.</Alert>
            : signed ? <Alert tone="info" title="Sua assinatura foi registrada">Aguardando as demais assinaturas para concluir o documento.</Alert>
              : <div><h2>Pronto para assinar?</h2><p className="assinaturas-public__hint">Confirme seu nome, registre a assinatura e leia o aviso de privacidade.</p></div>}
        {signed && invite.signer.signedAt ? <p className="assinaturas-public__hint">Assinado em {formatSignatureDateTime(invite.signer.signedAt)}</p> : null}
        {invite.downloadAvailable || !signed ? (
          <div className="assinaturas-public__actions">
            {invite.downloadAvailable ? <Button variant="primary" size="sm" onClick={onDownload} loading={downloading} loadingLabel="Baixando PDF assinado">Baixar PDF assinado</Button> : null}
            {!signed ? <Button variant="primary" size="sm" onClick={onSign}>Assinar documento</Button> : null}
          </div>
        ) : null}
      </Card>
    </>
  );
}
