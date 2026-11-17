import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { downloadQrDocument, getPublicQrPage, type PublicQrDocument } from '../api/equipmentQrPage';
import { useAuth } from '../auth/AuthContext';
import { BrandLoading } from '../components/brand/BrandLoading';
import { Alert, Button } from '../components/ui/ds';
import { formatTimestampDate } from '../utils/dateOnly';
import { PublicFlowShell } from './PublicFlowShell';
import './EquipmentQrPage.css';

function groupDocuments(documents: PublicQrDocument[]) {
  const groups: { title: string; items: PublicQrDocument[] }[] = [];
  for (const document of documents) {
    const group = groups.find(entry => entry.title === document.group);
    if (group) group.items.push(document); else groups.push({ title: document.group, items: [document] });
  }
  return groups;
}

/**
 * Página pública aberta pelo QR code do equipamento (sem login). Lista os documentos conforme o acesso
 * definido pelo gestor; sem documentos, a página continua válida e aparece vazia.
 */
export function EquipmentQrPage() {
  const { token = '' } = useParams();
  const { isAuthenticated, user } = useAuth();
  const [busyKey, setBusyKey] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const query = useQuery({ queryKey: ['equipment-qr-page', token], queryFn: () => getPublicQrPage(token), retry: false, staleTime: 0 });
  const isEmployee = isAuthenticated && user?.accountType !== 'CLIENT';
  const loginHref = `/login?next=${encodeURIComponent(`/q/${token}`)}`;

  async function downloadRestricted(document: PublicQrDocument) {
    if (!document.downloadPath) return;
    setBusyKey(document.key);
    setDownloadError('');
    try {
      await downloadQrDocument(document.downloadPath, document.fileName);
    } catch {
      setDownloadError('Não foi possível baixar o documento. Entre novamente e tente de novo.');
    } finally {
      setBusyKey('');
    }
  }

  if (query.isLoading) return <BrandLoading fullscreen />;

  if (query.isError || !query.data) {
    return <PublicFlowShell title="QR code não reconhecido" description="Este link não corresponde a nenhum equipamento ativo.">
      <Alert tone="warning">Confira se a etiqueta está legível ou fale com a equipe responsável pelo cadastro dos equipamentos.</Alert>
    </PublicFlowShell>;
  }

  const page = query.data;
  const groups = groupDocuments(page.documents);
  const subtitle = [page.code, page.categoryName].filter(Boolean).join(' · ');

  return <PublicFlowShell wide title={page.name} description={subtitle || undefined}>
    <div className="equipment-qr-page">
      {groups.length === 0 ? (
        <div className="equipment-qr-empty" data-equipment-qr-empty>
          <strong>Nenhum documento disponível por enquanto.</strong>
          <p>Este link continua válido: quando houver manual, dados técnicos, certificado ou arquivos para {page.isEquipment ? 'este equipamento' : 'este item'}, eles aparecerão aqui.</p>
        </div>
      ) : groups.map(group => (
        <section className="equipment-qr-group" key={group.title} aria-label={group.title}>
          <h2>{group.title}</h2>
          <ul>
            {group.items.map(document => (
              <li key={document.key} className="equipment-qr-doc" data-equipment-qr-doc>
                <div className="equipment-qr-doc__info">
                  <strong>{document.fileName}</strong>
                  <span>Atualizado em {formatTimestampDate(document.createdAt)}{document.requiresLogin ? ' · requer login' : ''}</span>
                </div>
                {document.url ? (
                  <a className="fv-button fv-button--primary fv-button--sm" href={document.url} download target="_blank" rel="noreferrer">Baixar</a>
                ) : isEmployee ? (
                  <Button size="sm" variant="primary" loading={busyKey === document.key} onClick={() => void downloadRestricted(document)}>Baixar</Button>
                ) : isAuthenticated ? (
                  <span className="equipment-qr-doc__note">Restrito a colaboradores</span>
                ) : (
                  <Link className="fv-button fv-button--secondary fv-button--sm" to={loginHref}>Entrar para baixar</Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {downloadError ? <Alert tone="danger">{downloadError}</Alert> : null}
    </div>
  </PublicFlowShell>;
}
