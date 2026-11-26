export type CollaboratorSkillKey = 'FLUSHING' | 'CHEMICAL_CLEANING' | 'FILTRATION' | 'HYDROJETTING' | 'HYDROSTATIC_TEST';
export type CollaboratorSkillLevel = 0 | 1 | 2 | 3;
export type CollaboratorSkillLevels = Partial<Record<CollaboratorSkillKey, CollaboratorSkillLevel>>;
export type CollaboratorSkillTone = 'success' | 'info' | 'warning' | 'neutral';

export type CollaboratorSkill = { key: CollaboratorSkillKey; label: string; shortLabel: string };
export type CollaboratorSkillLevelInfo = { level: CollaboratorSkillLevel; tone: CollaboratorSkillTone; label: string };
export type CollaboratorSkillEntry = CollaboratorSkill & { level: CollaboratorSkillLevel };

export const COLLABORATOR_SKILLS: readonly CollaboratorSkill[];
export const COLLABORATOR_SKILL_LEVELS: readonly CollaboratorSkillLevelInfo[];
export const COLLABORATOR_SKILL_KEYS: readonly CollaboratorSkillKey[];
export const MAX_COLLABORATOR_SKILL_LEVEL: 3;

export function isCollaboratorSkillKey(value: unknown): value is CollaboratorSkillKey;
export function isCollaboratorSkillLevel(value: unknown): value is CollaboratorSkillLevel;
export function normalizeCollaboratorSkillLevels(value: unknown): CollaboratorSkillLevels;
export function collaboratorSkillLevel(levels: CollaboratorSkillLevels | null | undefined, key: CollaboratorSkillKey): CollaboratorSkillLevel;
export function collaboratorSkillLevelMeta(level: number): CollaboratorSkillLevelInfo;
export function collaboratorSkillEntries(levels: CollaboratorSkillLevels | null | undefined, options?: { includeZero?: boolean }): CollaboratorSkillEntry[];
export function meetsCollaboratorSkill(levels: CollaboratorSkillLevels | null | undefined, key: CollaboratorSkillKey | '' | null | undefined, minLevel?: number): boolean;
export function collaboratorSkillScore(levels: CollaboratorSkillLevels | null | undefined): number;
