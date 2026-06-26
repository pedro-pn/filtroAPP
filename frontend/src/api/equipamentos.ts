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

// === Dados Técnicos (datasheet configurável) ===

export type TechnicalFieldType =
  | 'text' | 'textarea' | 'number' | 'measure'
  | 'select' | 'multiselect' | 'boolean' | 'date' | 'group';

export interface TechnicalFieldDefinition {
  key: string;
  label: string;
  type: TechnicalFieldType;
  order?: number;
  required?: boolean;
  optionalPerEquipment?: boolean;
  showInDoc?: boolean;
  group?: string;
  options?: string[];
  unit?: { dimension: string | null; default: string | null };
  rawTextAllowed?: boolean;
  repeatable?: boolean;
  minItems?: number;
  maxItems?: number;
  itemLabel?: string;
  itemSchema?: TechnicalFieldDefinition[];
}

export interface MeasurementDimension {
  key: string;
  label: string;
  units: string[];
  default: string;
}

export interface EquipmentCategory {
  id: string;
  systemKey: string;
  name: string;
  order: number;
  fieldSchema: EquipmentFieldDefinition[];
  technicalSchema: TechnicalFieldDefinition[];
  technicalDocEnabled: boolean;
  technicalTemplateId?: string | null;
  supportsCalibration: boolean;
  supportsTechnicalDoc: boolean;
  syncToRomaneio: boolean;
  isSystemManaged: boolean;
  isActive: boolean;
  importedFromRomaneio?: number;
}

export interface EquipmentAttachment {
  id: string;
  kind: 'CALIBRATION_CERTIFICATE' | 'TECHNICAL_DOC' | 'TECHNICAL_TEMPLATE' | 'TECHNICAL_DOC_GENERATED' | 'TECHNICAL_PHOTO';
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
  technicalData: Record<string, unknown>;
  technicalFieldOverrides: Record<string, boolean>;
  technicalRevision: number;
  technicalUpdatedAt: string | null;
  hasCalibration: boolean;
  calibratedAt: string | null;
  expiresAt: string | null;
  hasTechnicalDoc: boolean;
  isActive: boolean;
  calibrationCertificate?: EquipmentAttachment | null;
  calibrationCertificateArchive?: EquipmentAttachment[];
  technicalDoc?: EquipmentAttachment | null;
  technicalDocGenerated?: EquipmentAttachment | null;
  technicalDocGeneratedOutdated?: boolean;
  technicalDocArchive?: EquipmentAttachment[];
  technicalPhotos?: EquipmentAttachment[];
}

export interface PdfUpload {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface ImageUpload {
  fileName?: string;
  mimeType?: string;
  dataUrl: string;
}

export interface EquipmentCategoryPayload {
  name: string;
  order?: number;
  fieldSchema?: EquipmentFieldDefinition[];
  technicalSchema?: TechnicalFieldDefinition[];
  technicalDocEnabled?: boolean;
  supportsCalibration?: boolean;
  supportsTechnicalDoc?: boolean;
  syncToRomaneio?: boolean;
}

export interface EquipmentPayload {
  code: string;
  name: string;
  categoryId: string;
  attributes?: Record<string, unknown>;
  technicalData?: Record<string, unknown>;
  technicalFieldOverrides?: Record<string, boolean>;
  bumpRevision?: boolean;
  hasCalibration?: boolean;
  calibratedAt?: string | null;
  expiresAt?: string | null;
  hasTechnicalDoc?: boolean;
  calibrationCertificate?: PdfUpload | null;
  technicalDoc?: PdfUpload | null;
  technicalPhotos?: ImageUpload[];
  removeTechnicalPhotoIds?: string[];
  removeCalibrationCertificate?: boolean;
  removeTechnicalDoc?: boolean;
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

export async function listUnitsCatalog() {
  const response = await apiClient.get<MeasurementDimension[]>(equipamentosApiPath('/units-catalog'));
  return response.data;
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

// Gera (ou regenera) o datasheet em PDF a partir dos Dados Técnicos preenchidos.
export async function generateTechnicalDoc(id: string) {
  const response = await apiClient.post<EquipmentAttachment>(equipamentosApiPath(`/${id}/technical-doc`));
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
  categoryIds: string[];
}

export async function listRdoSlots() {
  const response = await apiClient.get<RdoEquipmentSlot[]>(equipamentosApiPath('/rdo-slots'));
  return response.data;
}

export async function updateRdoSlot(slotKey: string, categoryIds: string[]) {
  const response = await apiClient.put<RdoEquipmentSlot>(equipamentosApiPath(`/rdo-slots/${slotKey}`), { categoryIds });
  return response.data;
}

// === Notificações de calibração ===

export interface NotificationConfig {
  enabled: boolean;
  milestoneDays: number[];
  notifyOnDueDay: boolean;
  repeatExpired: boolean;
  repeatGapDays: number;
}

export interface NotificationRecipient {
  id: string;
  userId: string | null;
  email: string;
  isActive: boolean;
}

export interface NotificationAccount {
  id: string;
  name: string;
  email: string;
}

export async function getNotificationConfig() {
  const response = await apiClient.get<NotificationConfig>(equipamentosApiPath('/notifications/config'));
  return response.data;
}

export async function updateNotificationConfig(payload: Partial<NotificationConfig>) {
  const response = await apiClient.put<NotificationConfig>(equipamentosApiPath('/notifications/config'), payload);
  return response.data;
}

export async function listNotificationAccounts() {
  const response = await apiClient.get<NotificationAccount[]>(equipamentosApiPath('/notifications/accounts'));
  return response.data;
}

export async function listNotificationRecipients() {
  const response = await apiClient.get<NotificationRecipient[]>(equipamentosApiPath('/notifications/recipients'));
  return response.data;
}

export async function addNotificationRecipient(payload: { userId?: string; email?: string }) {
  const response = await apiClient.post<NotificationRecipient>(equipamentosApiPath('/notifications/recipients'), payload);
  return response.data;
}

export async function setNotificationRecipientActive(id: string, isActive: boolean) {
  const response = await apiClient.put<NotificationRecipient>(equipamentosApiPath(`/notifications/recipients/${id}`), { isActive });
  return response.data;
}

export async function removeNotificationRecipient(id: string) {
  await apiClient.delete(equipamentosApiPath(`/notifications/recipients/${id}`));
}
