import type { PlaygroundParameter } from '../../../../../shared/schemas/playground-parameters.js';

export interface ApiOperationOption {
  operationId: string;
  label: string;
  method: 'GET' | 'POST';
  path: string;
  requiredScopes: string[];
  optionalScopes: string[];
  domain: string;
  responseKind: 'JSON' | 'DOWNLOAD_CHECK';
  parameters: PlaygroundParameter[];
  queryParams: string[];
  pathParams: string[];
  bodyExample: Record<string, unknown> | null;
}

export function operationsForScope(operations: ApiOperationOption[], scope: string) {
  return scope ? operations.filter(operation => [...operation.requiredScopes, ...operation.optionalScopes].includes(scope)) : operations;
}

export function exampleOperationForCredential(operations: ApiOperationOption[], scopeCodes: string[]) {
  return operations.find(operation => operation.method === 'GET' && operation.responseKind === 'JSON'
    && operation.pathParams.length === 0
    && operation.parameters.every(parameter => !parameter.required)
    && operation.requiredScopes.every(scope => scopeCodes.includes(scope)));
}
