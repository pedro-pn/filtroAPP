import type { ApiCredentialPublic } from '../../../../../shared/schemas/api-credentials.js';
import { SearchCombobox } from '../../ui/SearchCombobox';
import { Alert, Badge, Card } from '../../ui/ds';
import type { ApiOperationOption } from './apiOperations';
import { operationsForScope } from './apiOperations';
import type { ApiScopeDefinition } from '../../../api/apiCredentials';

export function ApiOperationSelector({
  operations,
  credential,
  value,
  onChange,
  scopes = [],
  scopeCode = '',
  onScopeChange
}: {
  operations: ApiOperationOption[];
  credential: ApiCredentialPublic | null;
  value: string;
  onChange: (value: string) => void;
  scopes?: ApiScopeDefinition[];
  scopeCode?: string;
  onScopeChange?: (value: string) => void;
}) {
  const selected = operations.find(
    (operation) => operation.operationId === value
  );
  const filtered = operationsForScope(operations, scopeCode);
  const selectedScope = scopes.find((scope) => scope.code === scopeCode);
  const missing =
    selected?.requiredScopes.filter(
      (scope) => !credential?.scopeCodes.includes(scope)
    ) || [];
  return (
    <Card className="api-playground-section api-operation-selector">
      <h3>1. Escolha uma operação</h3>
      {onScopeChange ? (
        <SearchCombobox
          id="playground-scope"
          label="Permissão a testar"
          variant="select"
          portal
          value={scopeCode}
          onChange={onScopeChange}
          options={scopes
            .filter((scope) => scope.availability === 'AVAILABLE')
            .map((scope) => ({
              value: scope.code,
              label: `${scope.domain} · ${scope.label}`,
              description: `${scope.code}${credential?.scopeCodes.includes(scope.code) ? ' · Concedida ao token' : ' · Não concedida ao token'}`
            }))}
        />
      ) : null}
      {selectedScope ? (
        <p>{selectedScope.description}</p>
      ) : (
        <p>
          Escolha uma permissão ou busque entre todas as operações
          implementadas.
        </p>
      )}
      <SearchCombobox
        id="playground-operation"
        label="Operação"
        variant="select"
        portal
        value={value}
        onChange={onChange}
        options={filtered.map((operation) => ({
          value: operation.operationId,
          label: operation.label,
          description: `${operation.domain} · ${operation.method} ${operation.path}`
        }))}
      />
      {selected ? (
        <div className="api-operation-contract">
          <Badge tone="info" className="api-method">{selected.method}</Badge>
          <code>{selected.path}</code>
          <small>
            Método e caminho são definidos pelo catálogo e não podem ser
            editados.
          </small>
        </div>
      ) : null}
      {missing.length ? (
        <Alert tone="warning">A credencial não possui: {missing.join(', ')}.</Alert>
      ) : null}
      {scopeCode && !credential?.scopeCodes.includes(scopeCode) ? (
        <Alert tone="warning">
          A permissão selecionada não foi concedida a este token. Selecione
          outro token ou faça uma rotação com essa permissão.
        </Alert>
      ) : null}
    </Card>
  );
}
