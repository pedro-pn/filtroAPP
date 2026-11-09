import { apiClient, rdoApiPath } from './client';

export interface UploadItem {
  label: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  projectId?: string | null;
}

export interface UploadedFile {
  label: string;
  fileName: string;
  mimeType: string;
  url: string;
}

export async function uploadFile(item: UploadItem) {
  const response = await apiClient.post<UploadedFile>(rdoApiPath('/uploads'), item);
  return response.data;
}

export async function uploadFiles(items: UploadItem[], onProgress?: (completed: number, total: number) => void) {
  let completed = 0;
  let reporting = true;
  onProgress?.(0, items.length);
  try {
    return await Promise.all(items.map(async item => {
      const uploaded = await uploadFile(item);
      if (reporting) onProgress?.(++completed, items.length);
      return uploaded;
    }));
  } finally {
    // Other requests may finish after this batch has failed.
    reporting = false;
  }
}

export interface DeleteUploadResult {
  storagePath: string;
  affected: { reports: number; services: number; drafts: number };
  fileDeleted: boolean;
}

// Exclusão GLOBAL: remove a imagem de todos os relatórios em que aparece e do servidor.
export async function deleteUploadFile(storagePath: string) {
  const response = await apiClient.delete<DeleteUploadResult>(rdoApiPath('/uploads/file'), {
    data: { storagePath }
  });
  return response.data;
}
