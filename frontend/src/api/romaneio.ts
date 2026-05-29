import { apiClient, romaneioApiPath } from './client';
import type { Project, ReportDraft } from '../types/domain';

export type RomaneioItemKind = 'EQUIPMENT' | 'CONNECTION';
export type RomaneioMeasureType = 'UNIT' | 'LENGTH' | 'WEIGHT';
export type RomaneioCatalogSource = 'FILE' | 'MANUAL' | 'UNIT' | 'PARTICLE_COUNTER';

export interface RomaneioCatalogItem {
  id: string;
  sourceType: RomaneioCatalogSource;
  sourceId?: string | null;
  code?: string | null;
  name: string;
  categoryName: string;
  kind: RomaneioItemKind;
  measureType: RomaneioMeasureType;
  defaultUnitLabel: string;
  isSerialized: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RomaneioItem {
  id: string;
  catalogItemId?: string | null;
  itemName: string;
  itemCode?: string | null;
  categoryName: string;
  kind: RomaneioItemKind;
  measureType: RomaneioMeasureType;
  quantity: string | number;
  unitLabel: string;
  isCustom: boolean;
  sortOrder: number;
  catalogItem?: RomaneioCatalogItem | null;
}

export interface Romaneio {
  id: string;
  projectId: string;
  createdByUserId?: string | null;
  romaneioDate: string;
  driverName: string;
  vehiclePlate: string;
  docxUrl?: string | null;
  pdfUrl?: string | null;
  emailStatus?: string | null;
  emailError?: string | null;
  createdAt: string;
  updatedAt: string;
  project: Project;
  items: RomaneioItem[];
  createdBy?: { id: string; name: string; email?: string | null } | null;
}

export interface RomaneioRecipient {
  id: string;
  name?: string | null;
  email: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RomaneioCreatePayload {
  projectId: string;
  romaneioDate: string;
  driverName: string;
  vehiclePlate: string;
  items: Array<{
    catalogItemId?: string | null;
    itemName?: string;
    itemCode?: string | null;
    categoryName?: string;
    kind?: RomaneioItemKind;
    measureType?: RomaneioMeasureType;
    quantity: number;
    unitLabel?: string;
    isCustom?: boolean;
  }>;
}

export interface RomaneioCatalogPayload {
  code?: string | null;
  name: string;
  categoryName: string;
  kind: RomaneioItemKind;
  measureType: RomaneioMeasureType;
  defaultUnitLabel: string;
  isSerialized: boolean;
  isActive: boolean;
}

export interface RomaneioDraftPayload {
  id?: string;
  projectId?: string | null;
  title?: string | null;
  reportDate?: string | null;
  payload: Record<string, unknown>;
}

export async function listRomaneioProjects(active = true) {
  const { data } = await apiClient.get<Project[]>(romaneioApiPath('/projects'), { params: { active } });
  return data;
}

export async function listRomaneios(filters: { search?: string; projectId?: string } = {}) {
  const { data } = await apiClient.get<Romaneio[]>(romaneioApiPath('/'), { params: filters });
  return data;
}

export async function createRomaneio(payload: RomaneioCreatePayload) {
  const { data } = await apiClient.post<Romaneio>(romaneioApiPath('/'), payload);
  return data;
}

export async function listRomaneioDrafts() {
  const { data } = await apiClient.get<ReportDraft[]>(romaneioApiPath('/drafts'));
  return data;
}

export async function createRomaneioDraft(payload: RomaneioDraftPayload) {
  const { data } = await apiClient.post<ReportDraft>(romaneioApiPath('/drafts'), payload);
  return data;
}

export async function updateRomaneioDraft(id: string, payload: Omit<RomaneioDraftPayload, 'id'>) {
  const { data } = await apiClient.put<ReportDraft>(romaneioApiPath(`/drafts/${id}`), payload);
  return data;
}

export async function removeRomaneioDraft(id: string) {
  await apiClient.delete(romaneioApiPath(`/drafts/${id}`));
}

export async function listRomaneioCatalog() {
  const { data } = await apiClient.get<RomaneioCatalogItem[]>(romaneioApiPath('/catalog'));
  return data;
}

export async function downloadRomaneioCatalogPdf() {
  const { data } = await apiClient.get<Blob>(romaneioApiPath('/catalog/pdf'), { responseType: 'blob' });
  return data;
}

export async function createRomaneioCatalogItem(payload: RomaneioCatalogPayload) {
  const { data } = await apiClient.post<RomaneioCatalogItem>(romaneioApiPath('/catalog'), payload);
  return data;
}

export async function updateRomaneioCatalogItem(id: string, payload: Partial<RomaneioCatalogPayload>) {
  const { data } = await apiClient.put<RomaneioCatalogItem>(romaneioApiPath(`/catalog/${id}`), payload);
  return data;
}

export async function renameRomaneioCatalogCategory(payload: { currentName: string; newName: string }) {
  const { data } = await apiClient.put<{ categoryName: string; updatedCount: number }>(romaneioApiPath('/catalog/categories'), payload);
  return data;
}

export async function removeRomaneioCatalogItem(id: string) {
  await apiClient.delete(romaneioApiPath(`/catalog/${id}`));
}

export async function listRomaneioRecipients() {
  const { data } = await apiClient.get<RomaneioRecipient[]>(romaneioApiPath('/notifications'));
  return data;
}

export async function saveRomaneioRecipient(payload: { name?: string | null; email: string; isActive?: boolean }) {
  const { data } = await apiClient.post<RomaneioRecipient>(romaneioApiPath('/notifications'), payload);
  return data;
}

export async function removeRomaneioRecipient(id: string) {
  await apiClient.delete(romaneioApiPath(`/notifications/${id}`));
}

export async function downloadRomaneioFile(id: string, format: 'pdf' | 'docx') {
  const { data } = await apiClient.get<Blob>(romaneioApiPath(`/${id}/${format}`), { responseType: 'blob' });
  return data;
}
