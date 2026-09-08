import type { MissionStage, PlanningMission } from '../api/efetivoPlanning';

export type MissionColumns = Record<MissionStage, PlanningMission[]>;

export const MISSION_STAGES: MissionStage[] = ['STANDBY', 'MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT', 'FINISHED'];
export const MISSION_STAGE_LABELS: Record<MissionStage, string> = {
  STANDBY: 'Stand by',
  MOBILIZATION: 'Mobilização',
  EXECUTION: 'Execução',
  FINAL_MEASUREMENT: 'Medição final',
  FINISHED: 'Finalizadas'
};
export const MISSION_STAGE_DESCRIPTIONS: Record<MissionStage, string> = {
  STANDBY: 'Contrato fechado, aguardando início',
  MOBILIZATION: 'Preparação e deslocamento',
  EXECUTION: 'Equipe atuando na obra',
  FINAL_MEASUREMENT: 'Conferência e fechamento',
  FINISHED: 'Missão concluída'
};

export function missionsToColumns(missions: PlanningMission[]): MissionColumns {
  return Object.fromEntries(MISSION_STAGES.map(stage => [stage, missions.filter(item => item.stage === stage).sort((a, b) => a.kanbanOrder - b.kanbanOrder)])) as MissionColumns;
}

export function moveMissionInColumns(columns: MissionColumns, missionId: string, stage: MissionStage, index: number): MissionColumns {
  const next = Object.fromEntries(MISSION_STAGES.map(key => [key, columns[key].filter(item => item.id !== missionId)])) as MissionColumns;
  const mission = MISSION_STAGES.flatMap(key => columns[key]).find(item => item.id === missionId);
  if (!mission) return columns;
  const target = [...next[stage]];
  target.splice(Math.min(Math.max(0, index), target.length), 0, { ...mission, stage });
  next[stage] = target.map((item, kanbanOrder) => ({ ...item, stage, kanbanOrder }));
  return next;
}

export function missionStage(columns: MissionColumns, missionId: string): MissionStage | undefined {
  return MISSION_STAGES.find(stage => columns[stage].some(item => item.id === missionId));
}

// Onde o cartão deve parar ao soltar. Dentro da mesma coluna a posição vem da prévia ao vivo;
// entre colunas vem do alvo destacado ou do fim da coluna de destino.
export function resolveKanbanDrop(
  columns: MissionColumns,
  missionId: string,
  stage: MissionStage,
  hovered: { stage: MissionStage; order: number } | null
): { sameColumn: boolean; order: number } {
  const sameColumn = missionStage(columns, missionId) === stage;
  if (sameColumn) return { sameColumn, order: Math.max(0, columns[stage].findIndex(item => item.id === missionId)) };
  if (hovered && hovered.stage === stage) return { sameColumn, order: Math.min(Math.max(0, hovered.order), columns[stage].length) };
  return { sameColumn, order: columns[stage].length };
}

export function cloneMissionColumns(columns: MissionColumns): MissionColumns {
  return Object.fromEntries(MISSION_STAGES.map(stage => [stage, columns[stage].map(item => ({ ...item }))])) as MissionColumns;
}
