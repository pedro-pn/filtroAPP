import { apiClient } from './client';

export interface UploadItem {
  label: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export async function uploadFiles(items: UploadItem[]) {
  const response = await apiClient.post('/uploads', { items });
  return response.data;
}
