import type { ApiScopeDefinition } from '../../../api/apiCredentials';

export function toggleApiScope(scopes: ApiScopeDefinition[], selected: string[], code: string): string[] {
  const available = new Map(scopes.filter(scope => scope.availability === 'AVAILABLE').map(scope => [scope.code, scope]));
  if (!available.has(code)) return selected;
  const next = new Set(selected);
  if (next.has(code)) {
    const remove = (removed: string) => {
      if (!next.delete(removed)) return;
      for (const scope of available.values()) {
        if (scope.requiredScopes.includes(removed)) remove(scope.code);
      }
    };
    remove(code);
  } else {
    const add = (added: string) => {
      if (next.has(added)) return;
      const scope = available.get(added);
      if (!scope) throw new Error('Uma dependência desta permissão não está disponível.');
      next.add(added);
      scope.requiredScopes.forEach(add);
    };
    add(code);
  }
  return [...next];
}
