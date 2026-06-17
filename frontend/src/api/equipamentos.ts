import { apiClient, equipamentosApiPath } from './client';

export type EquipmentFieldType = 'text' | 'number' | 'date' | 'select' | 'textarea';

export interface EquipmentFieldDefinition {
  key: string;
  label: string;
  type: EquipmentFieldType;
  required?: boolean;
  options?: string[];
  order?: number;
  showInDashboard?: boolean;
}

export interface EquipmentCategory {
  id: string;
  systemKey: string;
  name: string;
  order: number;
  fieldSchema: EquipmentFieldDefinition[];
  supportsCalibration: boolean;
  supportsTechnicalDoc: boolean;
  syncToRomaneio: boolean;
  isSystemManaged: boolean;
  isActive: boolean;
  importedFromRomaneio?: number;
}

export interface EquipmentAttachment {
  id: string;
  kind: 'CALIBRATION_CERTIFICATE' | 'TECHNICAL_DOC';
  fileName: string;
  mimeType: string;
  publicToken: string;
  publicUrl: string;
  createdAt: string;
}

export interface CompanyEquipment {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  attributes: Record<string, unknown>;
  hasCalibration: boolean;
  calibratedAt: string | null;
  expiresAt: string | null;
  hasTechnicalDoc: boolean;
  isActive: boolean;
  calibrationCertificate?: EquipmentAttachment | null;
  technicalDoc?: EquipmentAttachment | null;
}

export interface PdfUpload {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface EquipmentCategoryPayload {
  name: string;
  order?: number;
  fieldSchema?: EquipmentFieldDefinition[];
  supportsCalibration?: boolean;
  supportsTechnicalDoc?: boolean;
  syncToRomaneio?: boolean;
}

export interface EquipmentPayload {
  code: string;
  name: string;
  categoryId: string;
  attributes?: Record<string, unknown>;
  hasCalibration?: boolean;
  calibratedAt?: string | null;
  expiresAt?: string | null;
  hasTechnicalDoc?: boolean;
  calibrationCertificate?: PdfUpload | null;
  technicalDoc?: PdfUpload | null;
}

// === Categorias ===

export async function listEquipmentCategories() {
  const response = await apiClient.get<EquipmentCategory[]>(equipamentosApiPath('/categories'));
  return response.data;
}

export async function createEquipmentCategory(payload: EquipmentCategoryPayload) {
  const response = await apiClient.post<EquipmentCategory>(equipamentosApiPath('/categories'), payload);
  return response.data;
}

export async function updateEquipmentCategory(id: string, payload: Partial<EquipmentCategoryPayload>) {
  const response = await apiClient.put<EquipmentCategory>(equipamentosApiPath(`/categories/${id}`), payload);
  return response.data;
}

export async function removeEquipmentCategory(id: string) {
  await apiClient.delete(equipamentosApiPath(`/categories/${id}`));
}

// === Equipamentos ===

export async function listEquipamentos(categoryId?: string) {
  const response = await apiClient.get<CompanyEquipment[]>(equipamentosApiPath('/'), {
    params: categoryId ? { categoryId } : undefined
  });
  return response.data;
}

export async function createEquipamento(payload: EquipmentPayload) {
  const response = await apiClient.post<CompanyEquipment>(equipamentosApiPath('/'), payload);
  return response.data;
}

export async function updateEquipamento(id: string, payload: Partial<EquipmentPayload>) {
  const response = await apiClient.put<CompanyEquipment>(equipamentosApiPath(`/${id}`), payload);
  return response.data;
}

export async function removeEquipamento(id: string) {
  await apiClient.delete(equipamentosApiPath(`/${id}`));
}

// === Slots de equipamento do RDO ===

export type RdoSlotKind = 'UNITS_MULTI' | 'UNIT_SINGLE' | 'MANOMETER_MULTI' | 'COUNTER_SINGLE';

export interface RdoEquipmentSlot {
  key: string;
  serviceType: string;
  fieldLabel: string;
  label: string;
  kind: RdoSlotKind;
  defaultSystemKey: string;
  categoryId: string | null;
}

export async function listRdoSlots() {
  const response = await apiClient.get<RdoEquipmentSlot[]>(equipamentosApiPath('/rdo-slots'));
  return response.data;
}

export async function updateRdoSlot(slotKey: string, categoryId: string | null) {
  const response = await apiClient.put<RdoEquipmentSlot>(equipamentosApiPath(`/rdo-slots/${slotKey}`), { categoryId });
  return response.data;
}
