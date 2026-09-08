import { apiClient } from './client';

export interface PontoImportRow {
  id: string;
  fileName: string;
  periodStart: string;
  periodEnd: string;
  rowsRead: number;
  collaboratorsTotal: number;
  collaboratorsMatched: number;
  status: string;
  source?: 'XLSX' | 'PONTOMAIS_API' | string;
  createdAt: string;
}

export interface PontoMaisRunSummary {
  id: string;
  trigger: 'MANUAL' | 'AUTOMATIC_BOOTSTRAP' | 'AUTOMATIC_DAILY' | string;
  periodStart: string;
  periodEnd: string;
  completedAt: string | null;
  pendingCount: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface PontoMaisIntegrationStatus {
  configured: boolean;
  running: boolean;
  automation: {
    bootstrapStatus: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | string;
    historyStart: string | null;
    historyThrough: string | null;
    nextPeriodStart: string | null;
    lastDailySyncDate: string | null;
    lastAttemptAt: string | null;
    lastSuccessfulAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    scheduledTime: string;
    timeZone: string;
  };
  lastSuccessfulRun: PontoMaisRunSummary | null;
  lastFailure: PontoMaisRunSummary | null;
}

export interface PontoMaisSyncResult {
  runId: string;
  status: 'SUCCEEDED';
  trigger: 'MANUAL' | 'AUTOMATIC_BOOTSTRAP' | 'AUTOMATIC_DAILY' | string;
  skippedDuplicate: boolean;
  importId: string;
  periodStart: string;
  periodEnd: string;
  employeesRead: number;
  workDaysRead: number;
  timeCardsRead: number;
  collaboratorsTotal: number;
  collaboratorsMatched: number;
  pendingCount: number;
}

export interface PontoMaisSyncRun extends PontoMaisRunSummary {
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | string;
  employeesRead: number;
  workDaysRead: number;
  timeCardsRead: number;
  collaboratorsMatched: number;
  startedAt: string;
}

export interface PontoMaisPendingEmployee {
  externalEmployeeId: string;
  registrationNumber: string | null;
  externalName: string;
  reason: string;
}

export interface PontoMaisPendingProjectTag {
  rawTag: string;
  normalizedTag: string;
  reason: string;
}

export interface PontoMaisPendingAmbiguousDay {
  externalEmployeeId: string;
  externalName: string;
  date: string;
  projectCodes: string[];
  tagProjectCodes: string[];
  rdoProjectCodes: string[];
  reason: string;
}

export interface PontoMaisPending {
  employees: PontoMaisPendingEmployee[];
  ambiguousDays: PontoMaisPendingAmbiguousDay[];
  missingProjects: {
    projectTags: PontoMaisPendingProjectTag[];
    ambiguousDays: PontoMaisPendingAmbiguousDay[];
  };
}

export interface PontoMaisReconciliationProject {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  historical: boolean;
}

export interface PontoMaisExternalEmployee {
  externalEmployeeId: string;
  registrationNumber: string | null;
  externalName: string;
  isActive: boolean | null;
  ignored: boolean;
}

export function pontoMaisSyncTriggerLabel(trigger: string): string {
  if (trigger === 'AUTOMATIC_BOOTSTRAP') return 'Carga histórica automática';
  if (trigger === 'AUTOMATIC_DAILY') return 'Atualização diária automática';
  return 'Contingência manual';
}

export function pontoMaisBootstrapStatusLabel(status: string, running = false): string {
  if (running) return 'Sincronização em andamento';
  if (status === 'SUCCEEDED') return 'Carga histórica concluída';
  if (status === 'FAILED') return 'Carga histórica aguardando nova tentativa automática';
  if (status === 'RUNNING') return 'Carga histórica em andamento';
  return 'Carga histórica aguardando início';
}

export interface UnmatchedPontoName {
  rawName: string;
  normalizedName: string;
}

export interface IdleBucket {
  cost: number;
  costBase: number;
  hours: number;
}

export interface CollaboratorMonthRate {
  month: string; // YYYY-MM
  normalHoras: number;
  he70Horas: number;
  he100Horas: number;
  totalMensal: number;
  totalMensalBase: number;
  fixoMensal: number;
  variavelMensal: number;
  custoHora: number;
  custoHoraBase: number;
  idle: { sede: IdleBucket; folga: IdleBucket };
}

export interface CollaboratorRate {
  collaboratorId: string;
  name: string;
  role: string | null;
  hasCostProfile: boolean;
  normalHoras: number;  // horas normais do ponto (somado)
  he70Horas: number;
  he100Horas: number;
  totalHoras: number;   // horas do ponto (normais + HE)
  folgaHours: number;
  totalMensalBase: number | null; // folha sem offshore
  totalMensal: number | null;     // folha (com offshore), somando a divisão mensal
  fixoMensal: number | null;      // base do motor sem dias + EPI (proporcional no mês parcial)
  variavelMensal: number | null;  // folha − fixo
  custoHoraBase: number | null;
  custoHora: number | null;       // HH = folha ÷ (horas do ponto + folga)
  idle: {
    sede: IdleBucket;   // ponto batido, não alocado a nenhuma obra
    folga: IdleBucket;  // dia de semana sem ponto (8,8h)
  };
  months: CollaboratorMonthRate[]; // detalhe por mês (para o filtro)
}

export interface PontoColaboradores {
  importId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  fileName: string | null;
  rates: CollaboratorRate[];
  unmatched: UnmatchedPontoName[];
}

export interface PontoImportResult {
  skippedDuplicate: boolean;
  importId: string;
  collaboratorsTotal?: number;
  collaboratorsMatched?: number;
  unmatched?: UnmatchedPontoName[];
  periodStart?: string;
  periodEnd?: string;
}

export type PontoImportSourceFilter = 'ALL' | 'XLSX' | 'PONTOMAIS_API';

export async function getPontoImports(source: PontoImportSourceFilter = 'ALL'): Promise<PontoImportRow[]> {
  const { data } = await apiClient.get<PontoImportRow[]>('/acompanhamento/ponto/imports', {
    params: source === 'ALL' ? undefined : { source, limit: 200 }
  });
  return data;
}

export async function setPontoMaisProjectTagIgnored(payload: { rawTag: string; ignored: boolean }) {
  const { data } = await apiClient.post<{ normalizedTag: string; ignored: boolean }>(
    '/acompanhamento/ponto/project-tags/ignore',
    payload
  );
  return data;
}

export async function getPontoMaisIgnoredProjectTags(): Promise<Array<{ normalizedTag: string; rawTag: string }>> {
  const { data } = await apiClient.get<Array<{ normalizedTag: string; rawTag: string }>>(
    '/acompanhamento/ponto/project-tags/ignored'
  );
  return data;
}

export async function getPontoMaisIntegrationStatus(): Promise<PontoMaisIntegrationStatus> {
  const { data } = await apiClient.get<PontoMaisIntegrationStatus>('/acompanhamento/ponto/integration-status');
  return data;
}

/*
 * O apiClient não define timeout, então uma requisição que fica pendurada nunca rejeita — e o laço
 * de janelas ficaria travado para sempre, sem sucesso nem erro. Uma janela de 31 dias é pesada mas
 * finita, então vale um teto generoso: melhor falhar dizendo em qual janela parou do que congelar.
 */
export const PONTOMAIS_SYNC_TIMEOUT_MS = 5 * 60 * 1000;

export async function syncPontoMais(payload: { startDate: string; endDate: string }): Promise<PontoMaisSyncResult> {
  const { data } = await apiClient.post<PontoMaisSyncResult>(
    '/acompanhamento/ponto/sync',
    payload,
    { timeout: PONTOMAIS_SYNC_TIMEOUT_MS }
  );
  return data;
}

/*
 * O endpoint aceita no máximo 31 dias por chamada — a mesma janela que a carga histórica usa, e que
 * reflete o limite prático dos relatórios do Ponto Mais. Para o gestor poder pedir "o ano inteiro"
 * sem esbarrar nisso, o recorte é feito aqui: uma chamada por janela, em sequência.
 *
 * Fatiar no cliente em vez de no servidor evita que uma requisição só fique minutos aberta e morra
 * no timeout do proxy, e permite mostrar progresso. Cada janela concluída já fica persistida, então
 * uma interrupção no meio não desfaz o que já entrou.
 */
export const PONTOMAIS_SYNC_WINDOW_DAYS = 31;

function addDaysKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function pontoMaisSyncWindows(startDate: string, endDate: string): Array<{ startDate: string; endDate: string }> {
  const windows: Array<{ startDate: string; endDate: string }> = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const last = addDaysKey(cursor, PONTOMAIS_SYNC_WINDOW_DAYS - 1);
    const windowEnd = last > endDate ? endDate : last;
    windows.push({ startDate: cursor, endDate: windowEnd });
    cursor = addDaysKey(windowEnd, 1);
  }
  return windows;
}

export interface PontoMaisRangeSyncResult {
  windows: number;
  created: number;
  skipped: number;
}

export async function syncPontoMaisRange(
  startDate: string,
  endDate: string,
  onProgress?: (done: number, total: number) => void
): Promise<PontoMaisRangeSyncResult> {
  const windows = pontoMaisSyncWindows(startDate, endDate);
  let created = 0;
  let skipped = 0;
  for (const [index, window] of windows.entries()) {
    onProgress?.(index, windows.length);
    const result = await syncPontoMais(window);
    if (result.skippedDuplicate) skipped += 1;
    else created += 1;
  }
  onProgress?.(windows.length, windows.length);
  return { windows: windows.length, created, skipped };
}

export async function getPontoMaisSyncRuns(limit = 50): Promise<PontoMaisSyncRun[]> {
  const { data } = await apiClient.get<PontoMaisSyncRun[]>('/acompanhamento/ponto/sync-runs', { params: { limit } });
  return data;
}

export async function getPontoMaisPending(): Promise<PontoMaisPending> {
  const { data } = await apiClient.get<PontoMaisPending>('/acompanhamento/ponto/pending');
  return data;
}

export async function getPontoMaisExternalEmployees(): Promise<PontoMaisExternalEmployee[]> {
  const { data } = await apiClient.get<PontoMaisExternalEmployee[]>('/acompanhamento/ponto/external-employees');
  return data;
}

export async function setPontoMaisExternalEmployeeIgnored(payload: {
  externalEmployeeId: string;
  ignored: boolean;
}): Promise<PontoMaisExternalEmployee> {
  const { data } = await apiClient.post<PontoMaisExternalEmployee>(
    '/acompanhamento/ponto/external-employees/ignore',
    payload
  );
  return data;
}

export async function getPontoMaisReconciliationProjects(): Promise<PontoMaisReconciliationProject[]> {
  const { data } = await apiClient.get<PontoMaisReconciliationProject[]>(
    '/acompanhamento/ponto/reconciliation-projects'
  );
  return data;
}

export async function linkPontoMaisExternalEmployee(payload: { externalEmployeeId: string; collaboratorId: string }) {
  const { data } = await apiClient.post<{
    externalEmployeeId: string;
    collaboratorId: string;
    normalizedName: string | null;
    relinked: number;
  }>(
    '/acompanhamento/ponto/external-employees/link',
    payload
  );
  return data;
}

export async function linkPontoMaisProjectTag(payload: { rawTag: string; projectId: string }) {
  const { data } = await apiClient.post<{ normalizedTag: string; projectId: string }>(
    '/acompanhamento/ponto/project-tags/link',
    payload
  );
  return data;
}

export async function setPontoMaisDayProjectOverride(payload: {
  externalEmployeeId: string;
  date: string;
  projectIds: string[];
}) {
  const { data } = await apiClient.post<{
    externalEmployeeId: string;
    date: string;
    projectIds: string[];
  }>('/acompanhamento/ponto/day-project-overrides', payload);
  return data;
}

export async function setPontoMaisDayProjectOverridesBatch(payload: {
  items: Array<{ externalEmployeeId: string; date: string; projectIds: string[] }>;
}) {
  const { data } = await apiClient.post<{ updated: number }>(
    '/acompanhamento/ponto/day-project-overrides/batch',
    payload
  );
  return data;
}

export async function deletePontoImport(id: string): Promise<void> {
  await apiClient.delete(`/acompanhamento/ponto/imports/${id}`);
}

export async function getPontoColaboradores(): Promise<PontoColaboradores> {
  const { data } = await apiClient.get<PontoColaboradores>('/acompanhamento/ponto/colaboradores');
  return data;
}

export interface ActiveCollaborator {
  id: string;
  name: string;
  role: string | null;
  isActive: boolean;
}

export async function getActiveCollaborators(): Promise<ActiveCollaborator[]> {
  const { data } = await apiClient.get<ActiveCollaborator[]>('/acompanhamento/ponto/colaboradores-ativos');
  return data;
}

export async function getPontoLinkCollaborators(): Promise<ActiveCollaborator[]> {
  const { data } = await apiClient.get<ActiveCollaborator[]>('/acompanhamento/ponto/colaboradores-ativos', {
    params: { includeInactive: 'true' }
  });
  return data;
}

export async function importPonto(file: File): Promise<PontoImportResult> {
  const { data } = await apiClient.post<PontoImportResult>('/acompanhamento/ponto/import', file, {
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': file.name }
  });
  return data;
}

export async function linkPontoName(payload: { normalizedName?: string; rawName?: string; collaboratorId: string }) {
  const { data } = await apiClient.post('/acompanhamento/ponto/vincular', payload);
  return data as { normalizedName: string; collaboratorId: string; relinked: number };
}

// === Auditoria da alocação diária do ponto ===

export interface AllocationProjectRef {
  projectId: string;
  code: string | null;
  name: string | null;
}

export interface AllocationDay {
  date: string;
  normalHours: number;
  appropriatedNormalHours: number;
  he70Hours: number;
  he100Hours: number;
  totalHours: number;
  appropriatedTotalHours: number;
  minimumNormalHoursApplied: boolean;
  tags: string[];
  tagProjects: AllocationProjectRef[];
  rdoProjects: Array<AllocationProjectRef & { hours: number }>;
  manualProjects: AllocationProjectRef[];
  effectiveProjects: AllocationProjectRef[];
  candidateProjects: AllocationProjectRef[];
  allocations: Array<AllocationProjectRef & { weight: number }>;
  planningMismatch: boolean;
  pending: boolean;
  reason: string;
  allocated: boolean;
  bucket: 'ACTIONABLE' | 'MISSING_PROJECT' | null;
}

export interface AllocationAuditCollaborator {
  collaboratorId: string;
  name: string;
  role: string | null;
  days: AllocationDay[];
  totals: {
    hours: number;
    unallocatedHours: number;
    byProject: Array<AllocationProjectRef & {
      normalHours: number;
      he70Hours: number;
      he100Hours: number;
      days: number;
    }>;
  };
}

export interface UnallocatedBlock {
  collaboratorId: string;
  name: string;
  role: string | null;
  bucket: 'ACTIONABLE' | 'MISSING_PROJECT';
  reason: string;
  days: AllocationDay[];
  hours: number;
}

export interface UnallocatedDays {
  cutoffDateKey: string | null;
  actionable: UnallocatedBlock[];
  missingProjects: UnallocatedBlock[];
  counts: {
    actionableDays: number;
    actionableHours: number;
    missingProjectDays: number;
  };
}

export interface PontoPendencyCounts {
  unallocatedDays: number;
  unallocatedBlocks: number;
  unallocatedHours: number;
  unlinkedEmployees: number;
  ambiguousDays: number;
  total: number;
}

export async function getAllocationAudit(params: {
  collaboratorId?: string;
  projectId?: string;
  de?: string;
  ate?: string;
  somenteNaoAlocados?: boolean;
}): Promise<{ collaborators: AllocationAuditCollaborator[] }> {
  const { data } = await apiClient.get<{ collaborators: AllocationAuditCollaborator[] }>(
    '/acompanhamento/ponto/auditoria-alocacao',
    {
      params: {
        collaboratorId: params.collaboratorId || undefined,
        projectId: params.projectId || undefined,
        de: params.de || undefined,
        ate: params.ate || undefined,
        somenteNaoAlocados: params.somenteNaoAlocados ? 'true' : undefined
      }
    }
  );
  return data;
}

export async function getUnallocatedDays(params: { de?: string; ate?: string } = {}): Promise<UnallocatedDays> {
  const { data } = await apiClient.get<UnallocatedDays>('/acompanhamento/ponto/dias-sem-alocacao', {
    params: { de: params.de || undefined, ate: params.ate || undefined }
  });
  return data;
}

export async function resolveUnallocatedDays(payload: {
  items: Array<{ collaboratorId: string; date: string; projectIds: string[] }>;
}) {
  const { data } = await apiClient.post<{ updated: number }>(
    '/acompanhamento/ponto/dias-sem-alocacao/resolver',
    payload
  );
  return data;
}

export async function getPontoPendencyCounts(): Promise<PontoPendencyCounts> {
  const { data } = await apiClient.get<PontoPendencyCounts>('/acompanhamento/ponto/pendencias/contagem');
  return data;
}
