import type { PlaygroundParameter } from '../../../../../shared/schemas/playground-parameters.js';

export interface ApiOperationOption {
  operationId: string;
  label: string;
  method: 'GET';
  path: string;
  requiredScopes: string[];
  optionalScopes: string[];
  domain: string;
  responseKind: 'JSON' | 'DOWNLOAD_CHECK';
  parameters: PlaygroundParameter[];
  queryParams: string[];
  pathParams: string[];
}

export function operationsForScope(operations: ApiOperationOption[], scope: string) {
  return scope ? operations.filter(operation => [...operation.requiredScopes, ...operation.optionalScopes].includes(scope)) : operations;
}
