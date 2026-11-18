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
  restore?: OperationalFileStatus;
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
  restore: OperationalFileStatus;
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
