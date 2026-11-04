import { apiClient } from './client';

// Conferência semanal de alocação (feature 037). Contrato em specs/037-conferencia-alocacao/contracts.

export type AllocationReviewKind = 'PROJECT' | 'TRAVEL' | 'SEDE' | 'FOLGA' | 'FERIAS' | 'AFASTAMENTO' | 'TREINAMENTO';
export type AllocationReviewValueKind = AllocationReviewKind | 'NONE';
export type SourceState = 'confirms' | 'diverges' | 'none';
export type PendingReason = 'DIVERGENCE' | 'NO_INFORMATION' | 'PLAN_ONLY';

export interface AllocationReviewValue {
  kind: AllocationReviewValueKind;
  projectIds: string[];
}

export interface ReviewDayView {
  date: string;
  eligible: boolean;
  isFuture: boolean;
  isWeekend: boolean;
  isHoliday: boolean;
  suggestion: AllocationReviewValue;
  value: AllocationReviewValue | null;
  saved: boolean;
  edited: boolean;
  note: string | null;
  pending: boolean;
  pendingReason: PendingReason | null;
  reasons: string[];
  sources: {
    ponto: { state: SourceState; normalHours: number; he70Hours: number; he100Hours: number; tags: string[] };
    rdo: { state: SourceState; reports: Array<{ reportId: string; number: number | null; projectId: string; status: string }> };
    efetivo: { state: SourceState; projectIds: string[] };
    manualProjectIds: string[];
    absence: { type: string; absenceId: string } | null;
  };
  candidateProjectIds: string[];
  sourceChangedAfterReview: boolean;
  absenceAlert: boolean;
}

export interface ReviewRowView {
  collaborator: { id: string; name: string; jobRole: string | null };
  mainProjectId: string | null;
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedByUserId: string | null;
  pendingCount: number;
  canConfirm: boolean;
  days: ReviewDayView[];
}

export interface ReviewProject {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  clientCnpj: string | null;
  isActive: boolean;
}

export interface AllocationReviewWeekResponse {
  week: {
    weekStart: string;
    weekEnd: string;
    status: 'OPEN' | 'CLOSED';
    version: number;
    closedAt: string | null;
    closedBy: { id: string; name: string } | null;
    ended: boolean;
    canClose: boolean;
    closeBlockers: string[];
    canReopen: boolean;
  };
  days: Array<{ date: string; weekday: string; isWeekend: boolean; isHoliday: boolean; holidayName: string | null; isFuture: boolean }>;
  summary: {
    agreeDays: number;
    divergenceDays: number;
    noInformationDays: number;
    editedDays: number;
    confirmedRows: number;
    totalRows: number;
    readyRows: number;
  };
  rows: ReviewRowView[];
  projects: ReviewProject[];
}

export interface SaveReviewDayItem {
  collaboratorId: string;
  date: string;
  kind: AllocationReviewKind;
  projectIds: string[];
  note?: string | null;
}

export interface ReviewWriteResult {
  version: number;
  rows: ReviewRowView[];
  confirmed?: number;
  alertsCreated?: number;
  alertsCancelled?: number;
}

const base = '/efetivo/conferencia-alocacao';
const versionHeader = (version: number) => ({ headers: { 'If-Match-Version': String(version) } });

export async function getAllocationReviewWeek(weekStart: string) {
  const { data } = await apiClient.get<AllocationReviewWeekResponse>(`${base}/semanas/${weekStart}`);
  return data;
}

export async function saveAllocationReviewDays(weekStart: string, version: number, items: SaveReviewDayItem[]) {
  const { data } = await apiClient.put<ReviewWriteResult>(`${base}/semanas/${weekStart}/dias`, { items }, versionHeader(version));
  return data;
}

export async function discardAllocationReviewDays(weekStart: string, version: number, items: Array<{ collaboratorId: string; date: string }>) {
  const { data } = await apiClient.delete<ReviewWriteResult>(`${base}/semanas/${weekStart}/dias`, { data: { items }, ...versionHeader(version) });
  return data;
}

export async function confirmAllocationReviewRows(weekStart: string, version: number, payload: { collaboratorIds: string[] } | { allReady: true }) {
  const { data } = await apiClient.post<ReviewWriteResult>(`${base}/semanas/${weekStart}/linhas/conferir`, payload, versionHeader(version));
  return data;
}

export async function unconfirmAllocationReviewRows(weekStart: string, version: number, collaboratorIds: string[]) {
  const { data } = await apiClient.post<ReviewWriteResult>(`${base}/semanas/${weekStart}/linhas/desconferir`, { collaboratorIds }, versionHeader(version));
  return data;
}

export async function closeAllocationReviewWeek(weekStart: string, version: number) {
  const { data } = await apiClient.post<{ version: number; week: AllocationReviewWeekResponse['week'] }>(`${base}/semanas/${weekStart}/fechar`, {}, versionHeader(version));
  return data;
}

export async function reopenAllocationReviewWeek(weekStart: string, version: number, note?: string) {
  const { data } = await apiClient.post<{ version: number; week: AllocationReviewWeekResponse['week'] }>(`${base}/semanas/${weekStart}/reabrir`, { note: note || null }, versionHeader(version));
  return data;
}

export async function getAllocationReviewPendingCount() {
  const { data } = await apiClient.get<{ openWeeks: Array<{ weekStart: string }>; absenceAlertsOpen: number }>(`${base}/pendencias/contagem`);
  return data;
}

export interface ReviewMonthDay {
  date: string;
  eligible: boolean;
  isFuture: boolean;
  value: AllocationReviewValue | null;
  pending: boolean;
  pendingReason: PendingReason | null;
  edited: boolean;
  confirmed: boolean;
  weekStart: string;
}

export interface AllocationReviewMonthResponse {
  month: { yearMonth: string; first: string; last: string };
  weeks: Array<{ weekStart: string; weekEnd: string; status: 'OPEN' | 'CLOSED'; ended: boolean; confirmedRows: number; totalRows: number; pendingDays: number }>;
  days: Array<{ date: string; weekday: string; isWeekend: boolean; isHoliday: boolean; holidayName: string | null; isFuture: boolean }>;
  rows: Array<{
    collaborator: { id: string; name: string; jobRole: string | null };
    pendingCount: number;
    totals: Array<{ kind: AllocationReviewKind; projectId: string | null; days: number }>;
    days: ReviewMonthDay[];
  }>;
  projects: ReviewProject[];
}

export async function getAllocationReviewMonth(yearMonth: string) {
  const { data } = await apiClient.get<AllocationReviewMonthResponse>(`${base}/meses/${yearMonth}`);
  return data;
}
