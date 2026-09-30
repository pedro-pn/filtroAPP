export interface PlaygroundParameter {
  name: string;
  in: 'query' | 'path';
  label: string;
  type: 'text' | 'integer' | 'datetime' | 'date' | 'boolean' | 'enum-list';
  required: boolean;
  help?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: string[];
  advanced?: boolean;
  requiredScope?: string;
}
export type PlaygroundParameterValues = Record<string, string | number | boolean | undefined>;
export function makePlaygroundParameterSchema(z: any, parameters: PlaygroundParameter[], options?: { maxPageSize?: number; scopes?: string[]; method?: 'GET' | 'POST' }): any;
export function playgroundParameterDefaults(operation?: { queryParams: string[]; method?: 'GET' | 'POST'; bodyExample?: Record<string, unknown> | null }, maxPageSize?: number, scopeCode?: string, grantedScopes?: string[]): PlaygroundParameterValues;
export function buildPlaygroundInput(operation: { operationId: string; method?: 'GET' | 'POST'; parameters: PlaygroundParameter[] }, values: PlaygroundParameterValues): { operationId: string; pathParams: Record<string, string>; query: Record<string, string | number | boolean | string[]>; body?: Record<string, unknown> };
