import { Download } from 'lucide-react';
import { useState } from 'react';

import { downloadBlob } from '../../utils/download';
import { useToast } from './ToastContext';
import { IconButton } from './ds/Button';
import './UploadDownloadButton.css';

export function UploadDownloadButton({ href, fileName }: { href: string; fileName: string }) {
  const [downloading, setDownloading] = useState(false);
  const showToast = useToast();
  const name = fileName || 'foto';

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      // Usa a imagem já carregada, inclusive o blob dos uploads protegidos.
      const response = await fetch(href, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Falha ao baixar imagem.');
      downloadBlob(await response.blob(), name);
    } catch {
      showToast('Não foi possível baixar a imagem. Tente novamente.', 'error');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <IconButton
      className="upload-download-button"
      icon={Download}
      label={`Baixar ${name}`}
      title="Baixar imagem"
      variant="secondary"
      size="sm"
      loading={downloading}
      onClick={handleDownload}
    />
  );
}
