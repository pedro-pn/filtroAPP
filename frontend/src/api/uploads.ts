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

export async function uploadFiles(items: UploadItem[]) {
  return Promise.all(items.map(item => uploadFile(item)));
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
