type CycleDate = string | Date;

interface MissionDefaultCycleContext {
  stage?: string;
  mobilizationDate: CycleDate;
  executionEndDate?: CycleDate;
  returnDate?: CycleDate | null;
  project?: { workflow?: { actualMobilizationDate?: CycleDate | null } | null };
  cycles?: Array<{
    isDefault?: boolean;
    mobilizationDate: CycleDate;
    demobilizationDate?: CycleDate | null;
  }>;
}

export function hasEditableDefaultMissionCycle(mission: MissionDefaultCycleContext): boolean;
