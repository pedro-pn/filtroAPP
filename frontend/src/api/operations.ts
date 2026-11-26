import { apiClient } from './client';

export type OperationalProblem = {
  message: string;
  job?: string;
  failed?: number;
  integration?: string;
  scope?: string | null;
  source?: string | null;
  error?: string | null;
  backup?: OperationalFileStatus;
  offsiteBackup?: OperationalFileStatus;
  restore?: OperationalFileStatus;
  deploy?: OperationalDeployStatus;
};

export type OperationalJobRun = {
  id: string;
  name: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
};

export type OperationalFileStatus = {
  configured: boolean;
  status: string;
  statusFile?: string;
  startedAt?: string;
  finishedAt?: string;
  ageMs?: number | null;
  maxAgeMs?: number | null;
  message?: string;
  runDir?: string;
  backupSource?: string;
  destination?: string;
};

// Uso do caminho antigo do webhook do PrismaCRM (spec 042, 7.6).
export type OperationalLegacyWebhookStatus = {
  status: string;
  currentPath?: string;
  legacyPath?: string;
  last30Days?: number;
  lastUsedDay?: string | null;
  sunset?: string | null;
};

export type OperationalDeployStatus = {
  configured: boolean;
  status: string;
  mode?: string;
  startedAt?: string;
  finishedAt?: string;
  sha?: string;
  shortSha?: string;
  previousSha?: string;
  shortPreviousSha?: string;
  message?: string;
};

export type OperationalOpenAiPeriod = {
  periodStart: string;
  calls: number;
  tokens: number;
  budget: number | null;
  estimatedUsd: number | null;
};

export type OperationalAbuseFinding = {
  type: string;
  subject: string;
  count: number;
  threshold: number;
  label: string;
};

export type OperationalAbuseStatus = {
  status: string;
  windowMinutes?: number;
  loginFailures?: number;
  rateLimited?: number;
  findings: OperationalAbuseFinding[];
  openai: {
    day: OperationalOpenAiPeriod;
    month: OperationalOpenAiPeriod;
    userDailyCalls: number | null;
    alertPercent: number;
  } | null;
};

export type OperationalIntegrationRun = {
  id: string;
  integration: string;
  scope: string | null;
  status: string;
  recordsRead: number;
  recordsWritten: number;
  error: string | null;
  summary: Record<string, unknown> | null;
  triggeredBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type OperationalAccessImport = {
  id: string;
  fileName: string;
  source: string;
  status: string;
  rowsRead: number;
  created: number;
  updated: number;
  skipped: number;
  pendingProjectsCreated: number;
  error: string | null;
  summary: Record<string, unknown> | null;
  importedByUserId: string | null;
  createdAt: string | null;
};

export type OperationalStatus = {
  ok: boolean;
  generatedAt: string;
  problems: OperationalProblem[];
  jobs: {
    recurring: Array<{ name: string; latestRun: OperationalJobRun | null }>;
    dataRetention: { latestRun: Record<string, unknown> | null };
    reportApprovalPostProcessing: {
      counts: Record<string, number>;
      latestFailed: Record<string, unknown> | null;
    };
    activeLocks: Array<Record<string, unknown>>;
  };
  backup: OperationalFileStatus;
  offsiteBackup?: OperationalFileStatus;
  restore: OperationalFileStatus;
  deploy?: OperationalDeployStatus;
  abuse?: OperationalAbuseStatus;
  legacyProjectWebhook?: OperationalLegacyWebhookStatus;
  omie: {
    configured: boolean;
    enabled: boolean;
    status: string;
    latestRun: OperationalIntegrationRun | null;
    scopes: Array<{ scope: string; latestRun: OperationalIntegrationRun | null }>;
  };
  commercialImport: {
    configured: boolean;
    status: string;
    latestImport: OperationalAccessImport | null;
  };
  errorTracking: {
    enabled: boolean;
    provider: string;
  };
  alerting: {
    enabled: boolean;
    webhookConfigured: boolean;
    emailRecipientsConfigured?: number;
    intervalMs: number;
    repeatMs?: number | null;
  };
};

export async function getOperationalStatus() {
  const response = await apiClient.get<OperationalStatus>('/operations/status');
  return response.data;
}

export type RetentionHoldKind = 'project' | 'collaborator';

export type RetentionHoldItem = {
  id: string;
  code: string;
  name: string;
  reason: string | null;
  setAt: string | null;
};

export type RetentionHolds = {
  projects: RetentionHoldItem[];
  collaborators: RetentionHoldItem[];
};

export async function getRetentionHolds() {
  const response = await apiClient.get<RetentionHolds>('/operations/retention-holds');
  return response.data;
}

export async function setRetentionHold(input: {
  kind: RetentionHoldKind;
  code: string;
  hold: boolean;
  reason?: string | null;
}) {
  const response = await apiClient.put<RetentionHoldItem & { hold: boolean }>('/operations/retention-holds', input);
  return response.data;
}
