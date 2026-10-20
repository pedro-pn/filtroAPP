export interface RdoProjectContext {
  location?: string | null;
  additionalWorkLocations?: string[];
  plannedServices?: Array<{ scopeName?: string | null; contributionKey?: string | null }>;
}
export interface RdoScopeOption {
  value: string;
  name: string | null;
  label: string;
  contributionKey?: string | null;
}
export function projectWorkLocations(project?: RdoProjectContext | null): string[];
export function projectScopeOptions(project?: RdoProjectContext | null): RdoScopeOption[];
export function findProjectScopeOption(options: RdoScopeOption[], value: unknown): RdoScopeOption | undefined;
