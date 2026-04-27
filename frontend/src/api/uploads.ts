import { apiClient } from './client';

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
  const response = await apiClient.post<UploadedFile>('/uploads', item);
  return response.data;
}

export async function uploadFiles(items: UploadItem[]) {
  return Promise.all(items.map(item => uploadFile(item)));
}
