interface MissionMobilizationContext {
  stage?: string;
  plan?: { kind?: string };
  project?: {
    workflow?: { stage?: string; actualMobilizationDate?: string | Date | null } | null;
  };
}

export function missionAwaitsMobilization(mission: MissionMobilizationContext): boolean;
