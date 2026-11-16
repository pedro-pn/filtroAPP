import { apiClient } from './client';

export interface PublicQrDocument {
  key: string;
  group: string;
  label: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
  requiresLogin: boolean;
  /** Link de download direto (documentos públicos). */
  url: string | null;
  /** Caminho autenticado (documentos que exigem login). */
  downloadPath: string | null;
}

export interface PublicQrPage {
  name: string;
  code: string | null;
  categoryName: string | null;
  isEquipment: boolean;
  documents: PublicQrDocument[];
}

export async function getPublicQrPage(token: string) {
  const response = await apiClient.get<PublicQrPage>(`/equipamentos-qr/${encodeURIComponent(token)}`);
  return response.data;
}

// Documento que exige login: baixa com a sessão do colaborador e entrega o arquivo ao navegador.
export async function downloadQrDocument(downloadPath: string, fileName: string) {
  const path = downloadPath.replace(/^\/api/, '');
  const response = await apiClient.get<Blob>(path, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
