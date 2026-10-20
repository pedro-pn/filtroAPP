export interface MissionReportProject {
  isActive?: boolean;
  deletedAt?: string | Date | null;
  managerOnly?: boolean;
  authorizedUsers?: ReadonlyArray<{ userId: string }>;
  efetivoMissionPlans?: ReadonlyArray<{ allocations: ReadonlyArray<{ collaboratorId: string }> }>;
}

export function canEditMissionReports(user: {
  id?: string;
  collaboratorId?: string | null;
  isActive?: boolean;
  accountType?: string;
  role?: string;
} | null | undefined, project: MissionReportProject | null | undefined): boolean;
