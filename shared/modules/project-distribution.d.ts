export type ProjectDistributionChannel = 'efetivo' | 'acompanhamento' | 'api' | 'commercial' | 'omie' | 'pontomais';
export type ProjectDistributionSettings = Record<ProjectDistributionChannel, boolean>;
export const PROJECT_DISTRIBUTION_CHANNELS: readonly { key: ProjectDistributionChannel; label: string; description: string }[];
export function projectDistributionDefaults(project?: { managerOnly?: boolean }): ProjectDistributionSettings;
export function projectDistributionSettings(project?: { managerOnly?: boolean; distributionSettings?: Partial<ProjectDistributionSettings> | null }): ProjectDistributionSettings;
