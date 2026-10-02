export interface RdoProjectContext {
  location?: string | null;
  additionalWorkLocations?: string[];
  plannedServices?: Array<{ scopeName?: string | null }>;
}
export interface RdoScopeOption {
  value: string;
  name: string | null;
  label: string;
}
export function projectWorkLocations(project?: RdoProjectContext | null): string[];
export function projectScopeOptions(project?: RdoProjectContext | null): RdoScopeOption[];
