import { apiClient, rdoApiPath } from './client';
import type { ReportEmissionPermission } from '../types/auth';

export type OperationalKind = 'MAINTENANCE' | 'PRODUCTION';
export type OperationalStatus = 'PENDING' | 'APPROVED' | 'RETURNED';
export type ChemicalMaterial =
  'CARBON_STEEL' | 'STAINLESS_STEEL' | 'CUNIFE' | 'OTHER';

export interface OperationalCollaborator {
  id: string;
  code: string;
  name: string;
  jobRole?: { name: string };
}

export interface MaintenanceProfileItem {
  id: string;
  label: string;
  order: number;
  isActive?: boolean;
}

export interface MaintenanceProfileSummary {
  id: string;
  key?: string;
  name: string;
  isActive?: boolean;
  order?: number;
  items: MaintenanceProfileItem[];
}

export interface MaintenanceEquipment {
  id: string;
  code: string;
  name: string;
  attributes: Record<string, unknown>;
  category?: {
    id: string;
    name: string;
    fieldSchema: Array<{
      key: string;
      label: string;
      type: 'text' | 'number' | 'date' | 'select' | 'textarea';
      order?: number;
    }>;
  } | null;
  maintenanceProfile: MaintenanceProfileSummary;
}

export interface OperationalContext {
  permissions: ReportEmissionPermission[];
  canReviewMaintenance: boolean;
  canReviewProduction: boolean;
  maintenanceSupervisor: {
    id: string | null;
    name: string | null;
    valid: boolean;
    reason: string | null;
  };
  projects: {
    maintenance: {
      id: string;
      code: string;
      name: string;
      isActive: boolean;
      workdayHours: string;
      weekendWorkdayHours: string;
      includesSaturday: boolean;
      includesSunday: boolean;
    } | null;
    production: {
      id: string;
      code: string;
      name: string;
      isActive: boolean;
      workdayHours: string;
      weekendWorkdayHours: string;
      includesSaturday: boolean;
      includesSunday: boolean;
    } | null;
  };
  collaborators: OperationalCollaborator[];
  equipment: MaintenanceEquipment[];
}

export interface MaintenancePhotoPayload {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface MaintenanceThirdPartyPayload {
  serviceDate: string;
  location: string;
  description: string;
}

export interface MaintenanceCardPayload {
  id?: string;
  equipmentId: string;
  selectedServiceIds: string[];
  observations?: string | null;
  thirdPartyServices: MaintenanceThirdPartyPayload[];
  photos: MaintenancePhotoPayload[];
  removePhotoIds?: string[];
}

export interface ChemicalCleaningPayload {
  description: string;
  material: ChemicalMaterial;
  otherMaterial?: string | null;
  quantityKg: number;
}

export interface OperationalReportPayload {
  kind: OperationalKind;
  reportDate: string;
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  collaboratorIds: string[];
  nightShift: {
    enabled: boolean;
    arrivalTime: string;
    departureTime: string;
    breakTime: string;
    collaboratorIds: string[];
  };
  overtimeReason?: string | null;
  dailyDescription?: string | null;
  maintenanceRecords: MaintenanceCardPayload[];
  chemicalCleanings: ChemicalCleaningPayload[];
}

export interface MaintenanceAttachment {
  id: string;
  kind: 'PHOTO' | 'DOCUMENT';
  fileName: string;
  mimeType: string;
  url: string;
  createdAt: string;
}

export interface MaintenanceRecord {
  id: string;
  reportId?: string | null;
  equipmentId: string;
  profileId: string;
  maintenanceDate: string;
  status: OperationalStatus;
  responsibleNameSnapshot: string;
  createdBy?: { id: string; name: string };
  profileNameSnapshot: string;
  selectedServices: Array<{ itemId?: string; label: string; order: number }>;
  observations?: string | null;
  reviewNotes?: string | null;
  supervisorNameSnapshot?: string | null;
  equipment: MaintenanceEquipment;
  thirdPartyServices: Array<
    MaintenanceThirdPartyPayload & { id: string; order: number }
  >;
  photos: MaintenanceAttachment[];
  document?: MaintenanceAttachment | null;
  createdAt: string;
}

export interface OperationalReport {
  id: string;
  reportType: 'RDO_MAINTENANCE' | 'RDO_PRODUCTION';
  kind: OperationalKind;
  sequenceNumber: number;
  status: OperationalStatus;
  reportDate: string;
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  daytimeWorkedMinutes: number;
  nighttimeWorkedMinutes: number;
  totalOvertimeMinutes: number;
  overtimeReason?: string | null;
  dailyDescription?: string | null;
  reviewNotes?: string | null;
  specialConditions?: Record<string, unknown>;
  project: { id: string; code: string; name: string };
  createdBy: { id: string; name: string };
  collaborators: Array<{ collaborator: OperationalCollaborator }>;
  maintenanceRecords: MaintenanceRecord[];
  chemicalCleanings: Array<
    ChemicalCleaningPayload & { id: string; order: number }
  >;
  createdAt: string;
}

export interface PaginatedOperational<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MaintenanceHistoryPage {
  items: MaintenanceRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export type MaintenanceScheduleStatus =
  | 'OVERDUE'
  | 'DUE_TODAY'
  | 'UPCOMING'
  | 'NO_HISTORY'
  | 'UNCONFIGURED';

export interface MaintenanceScheduleItem {
  equipment: { id: string; code: string; name: string };
  category: {
    id: string;
    name: string;
    maintenanceIntervalDays: number | null;
  };
  lastMaintenanceId: string | null;
  lastMaintenanceDate: string | null;
  nextMaintenanceDate: string | null;
  status: MaintenanceScheduleStatus;
  daysUntilDue: number | null;
}

export interface MaintenanceSchedulePage {
  items: MaintenanceScheduleItem[];
  categories: Array<{
    id: string;
    name: string;
    maintenanceIntervalDays: number | null;
  }>;
  summary: Record<MaintenanceScheduleStatus, number> & { total: number };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  referenceDate: string;
}

export type MaintenanceHistorySort =
  | 'maintenanceDate'
  | 'tag'
  | 'equipment'
  | 'category'
  | 'responsible';

export type MaintenanceHistorySortDirection = 'asc' | 'desc';

const operationalPath = (suffix = '') =>
  rdoApiPath(`/operational-reports${suffix}`);

export async function getOperationalContext() {
  const response = await apiClient.get<OperationalContext>(
    operationalPath('/context')
  );
  return response.data;
}

export async function listOperationalReports(
  params: Record<string, string | number | undefined> = {}
) {
  const response = await apiClient.get<PaginatedOperational<OperationalReport>>(
    operationalPath(),
    { params }
  );
  return response.data;
}

export async function getOperationalReport(id: string) {
  const response = await apiClient.get<OperationalReport>(
    operationalPath(`/${id}`)
  );
  return response.data;
}

export async function createOperationalReport(
  payload: OperationalReportPayload
) {
  const response = await apiClient.post<OperationalReport>(
    operationalPath(),
    payload
  );
  return response.data;
}

export async function updateOperationalReport(
  id: string,
  payload: OperationalReportPayload
) {
  const response = await apiClient.put<OperationalReport>(
    operationalPath(`/${id}`),
    payload
  );
  return response.data;
}

export async function updateOperationalReportStatus(
  id: string,
  status: OperationalStatus,
  reviewNotes?: string
) {
  const response = await apiClient.patch<OperationalReport>(
    operationalPath(`/${id}/status`),
    { status, reviewNotes }
  );
  return response.data;
}

export async function listStandaloneMaintenances(
  params: Record<string, string | number | undefined> = {}
) {
  const response = await apiClient.get<PaginatedOperational<MaintenanceRecord>>(
    operationalPath('/maintenance'),
    { params }
  );
  return response.data;
}

export async function listMaintenanceHistory(
  params: {
    q?: string;
    page?: number;
    pageSize?: number;
    sortBy?: MaintenanceHistorySort;
    sortDirection?: MaintenanceHistorySortDirection;
  } = {}
) {
  const response = await apiClient.get<MaintenanceHistoryPage>(
    operationalPath('/maintenance/history'),
    { params }
  );
  return response.data;
}

export async function listMaintenanceSchedule(
  params: {
    q?: string;
    categoryId?: string;
    status?: MaintenanceScheduleStatus;
    page?: number;
    pageSize?: number;
  } = {}
) {
  const response = await apiClient.get<MaintenanceSchedulePage>(
    operationalPath('/maintenance/schedule'),
    { params }
  );
  return response.data;
}

export async function getStandaloneMaintenance(id: string) {
  const response = await apiClient.get<MaintenanceRecord>(
    operationalPath(`/maintenance/${id}`)
  );
  return response.data;
}

export async function createStandaloneMaintenance(
  payload: MaintenanceCardPayload & { maintenanceDate: string }
) {
  const response = await apiClient.post<MaintenanceRecord>(
    operationalPath('/maintenance'),
    payload
  );
  return response.data;
}

export async function updateStandaloneMaintenance(
  id: string,
  payload: MaintenanceCardPayload & { maintenanceDate: string }
) {
  const response = await apiClient.put<MaintenanceRecord>(
    operationalPath(`/maintenance/${id}`),
    payload
  );
  return response.data;
}

export async function updateStandaloneMaintenanceStatus(
  id: string,
  status: OperationalStatus,
  reviewNotes?: string
) {
  const response = await apiClient.patch<MaintenanceRecord>(
    operationalPath(`/maintenance/${id}/status`),
    { status, reviewNotes }
  );
  return response.data;
}

export async function downloadMaintenanceDocument(record: MaintenanceRecord) {
  if (!record.document) return;
  return downloadMaintenanceAttachment(record.document);
}

export async function downloadMaintenanceAttachment(
  attachment: MaintenanceAttachment
) {
  const requestUrl = attachment.url.startsWith('/api/')
    ? attachment.url.slice('/api'.length)
    : attachment.url;
  const response = await apiClient.get(requestUrl, {
    responseType: 'blob'
  });
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = attachment.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
