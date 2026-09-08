import { useMemo, useState } from 'react';

import type { ApiScopeDefinition } from '../../../api/apiCredentials';
import { toggleApiScope } from './apiScopeSelection';

interface Props {
  scopes: ApiScopeDefinition[];
  selected: string[];
  onChange: (scopeCodes: string[]) => void;
}

const statusLabel: Record<ApiScopeDefinition['availability'], string> = {
  AVAILABLE: 'Disponível',
  PLANNED: 'Planejado',
  SENSITIVE: 'Sensível',
  RESERVED: 'Reservado',
  PROHIBITED: 'Não exposto'
};

export function ApiScopeCatalog({ scopes, selected, onChange }: Props) {
  const [catalogQuery, setCatalogQuery] = useState('');
  const [selectionNotice, setSelectionNotice] = useState('');
  const groupedScopes = useMemo(() => {
    const normalized = catalogQuery.trim().toLocaleLowerCase('pt-BR');
    const filtered = scopes.filter((scope) =>
      [
        scope.domain,
        scope.code,
        scope.label,
        scope.description,
        ...(scope.models || []),
        ...(scope.endpointFamilies || [])
      ]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(normalized)
    );
    const groups = new Map<string, ApiScopeDefinition[]>();
    for (const scope of filtered)
      groups.set(scope.domain, [...(groups.get(scope.domain) || []), scope]);
    return [...groups.entries()].sort(
      ([left, a], [right, b]) =>
        Number(b.some((scope) => scope.availability === 'AVAILABLE')) -
          Number(a.some((scope) => scope.availability === 'AVAILABLE')) ||
        left.localeCompare(right, 'pt-BR')
    );
  }, [catalogQuery, scopes]);

  function toggleScope(code: string) {
    const next = toggleApiScope(scopes, selected, code);
    const dependentChanges = selected.includes(code)
      ? selected.filter((item) => item !== code && !next.includes(item))
      : next.filter((item) => item !== code && !selected.includes(item));
    setSelectionNotice(
      dependentChanges.length
        ? `Permissões ${selected.includes(code) ? 'removidas' : 'incluídas'} por dependência: ${dependentChanges.map((item) => scopes.find((scope) => scope.code === item)?.label || item).join(', ')}.`
        : ''
    );
    onChange(next);
  }

  return (
    <section
      className="api-scope-catalog"
      aria-labelledby="scope-catalog-title"
    >
      <div className="api-section-heading">
        <div>
          <h3 id="scope-catalog-title">Selecione os dados permitidos</h3>
          <p>
            Abra um módulo e marque exatamente o que este token poderá
            consultar.
          </p>
        </div>
        <span className="api-selection-count">
          {selected.length}{' '}
          {selected.length === 1 ? 'selecionada' : 'selecionadas'}
        </span>
      </div>
      <p className="api-safe-note">
        Permissões relacionadas são incluídas automaticamente. Ao desmarcar uma,
        os acessos que dependem dela também são removidos.
      </p>
      <p className="api-selection-notice" role="status" aria-live="polite">
        {selectionNotice}
      </p>
      <div className="field-group api-catalog-search">
        <label htmlFor="api-catalog-search">Buscar no catálogo</label>
        <input
          id="api-catalog-search"
          type="search"
          value={catalogQuery}
          onChange={(event) => setCatalogQuery(event.target.value)}
          placeholder="Ex.: relatórios, colaboradores, equipamentos"
        />
      </div>
      <div className="api-scope-domains">
        {groupedScopes.map(([domain, domainScopes]) => (
          <details
            className="api-scope-domain"
            key={domain}
            open={
              catalogQuery ||
              domainScopes.some((scope) => selected.includes(scope.code))
                ? true
                : undefined
            }
          >
            <summary>
              <strong>{domain}</strong>
              <span>
                Selecionadas:{' '}
                {
                  domainScopes.filter((scope) => selected.includes(scope.code))
                    .length
                }{' '}
                · Disponíveis:{' '}
                {
                  domainScopes.filter(
                    (scope) => scope.availability === 'AVAILABLE'
                  ).length
                }{' '}
              </span>
            </summary>
            <div className="api-catalog-entries">
              {domainScopes.map((scope) => (
                <div className="api-catalog-entry" key={scope.code}>
                  <label
                    className={`api-permission-row ${selected.includes(scope.code) ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      disabled={scope.availability !== 'AVAILABLE'}
                      checked={selected.includes(scope.code)}
                      onChange={() => toggleScope(scope.code)}
                      aria-describedby={`scope-description-${scope.code}`}
                    />
                    <span className="api-permission-copy">
                      <strong>{scope.label}</strong>
                      <span id={`scope-description-${scope.code}`}>
                        {scope.description}
                      </span>
                      {scope.requiredScopes.length ? (
                        <small>
                          Requer{' '}
                          {scope.requiredScopes
                            .map(
                              (code) =>
                                scopes.find((item) => item.code === code)
                                  ?.label || code
                            )
                            .join(' e ')}
                          .
                        </small>
                      ) : null}
                    </span>
                    <span
                      className={`api-badge status-${scope.availability.toLowerCase()}`}
                    >
                      {statusLabel[scope.availability]}
                    </span>
                  </label>
                  <details className="api-scope-technical">
                    <summary>Ver campos e endpoints</summary>
                    <div className="api-catalog-entry-body">
                      <code>{scope.code}</code>
                      <p>{scope.description}</p>
                      {scope.models?.length ? (
                        <p>
                          <strong>Modelos:</strong> {scope.models.join(', ')}
                        </p>
                      ) : null}
                      {scope.exposedFields?.length ? (
                        <p>
                          <strong>Incluído:</strong>{' '}
                          {scope.exposedFields.join(', ')}
                        </p>
                      ) : null}
                      {scope.excludedFields?.length ? (
                        <p>
                          <strong>Excluído:</strong>{' '}
                          {scope.excludedFields.join(', ')}
                        </p>
                      ) : null}
                      {scope.endpointFamilies?.length ? (
                        <p>
                          <strong>
                            {scope.availability === 'AVAILABLE'
                              ? 'Endpoints:'
                              : 'Endpoints planejados:'}
                          </strong>{' '}
                          {scope.endpointFamilies.join(', ')}
                        </p>
                      ) : null}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </details>
        ))}
        {groupedScopes.length === 0 ? (
          <p className="api-empty-inline">
            Nenhum dado encontrado no catálogo.
          </p>
        ) : null}
      </div>
    </section>
  );
}
