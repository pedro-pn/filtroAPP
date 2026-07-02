import { apiClient } from './client';

export type OperationalProblem = {
  message: string;
  job?: string;
  failed?: number;
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
  errorTracking: {
    enabled: boolean;
    provider: string;
  };
  alerting: {
    enabled: boolean;
    webhookConfigured: boolean;
    intervalMs: number;
  };
};

export async function getOperationalStatus() {
  const response = await apiClient.get<OperationalStatus>('/operations/status');
  return response.data;
}
