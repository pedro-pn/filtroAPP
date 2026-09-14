import type {
  PlaygroundParameter,
  PlaygroundParameterValues
} from '../../../../../shared/schemas/playground-parameters.js';
import type { ApiOperationOption } from './apiOperations';
import type { UseFormRegister } from 'react-hook-form';

export type ApiPlaygroundParameters = PlaygroundParameterValues;

const ids: Record<string, string> = {
  id: 'playground-record-id',
  projectId: 'playground-project',
  projectCode: 'playground-project-code',
  createdSince: 'playground-created',
  updatedSince: 'playground-updated'
};

export function ApiOperationParameters({
  operation,
  value,
  onChange,
  errors = {},
  scopes = [],
  maxPageSize = 20,
  register
}: {
  operation?: ApiOperationOption;
  value: ApiPlaygroundParameters;
  onChange: (value: ApiPlaygroundParameters) => void;
  errors?: Record<string, string>;
  scopes?: string[];
  maxPageSize?: number;
  register?: UseFormRegister<ApiPlaygroundParameters>;
}) {
  const update = (name: string, next: string) =>
    onChange({ ...value, [name]: next });
  function renderField(field: PlaygroundParameter) {
    const id = ids[field.name] || `playground-${field.name}`;
    const error = errors[field.name];
    const restricted = Boolean(
      field.requiredScope && !scopes.includes(field.requiredScope)
    );
    return (
      <div
        className={`field-group${error ? ' field-invalid' : ''}`}
        key={field.name}
      >
        <label htmlFor={id}>
          {field.label}
          {field.required ? ' *' : ''}
        </label>
        {field.type === 'boolean' ? (
          <select
            {...register?.(field.name)}
            id={id}
            value={String(value[field.name] ?? '')}
            onChange={(event) => update(field.name, event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={`${id}-help ${id}-error`}
          >
            <option value="">Padrão da consulta</option>
            <option value="true" disabled={restricted}>
              Sim
            </option>
            <option value="false">Não</option>
          </select>
        ) : (
          <input
            {...register?.(field.name)}
            id={id}
            type={
              field.type === 'integer'
                ? 'number'
                : field.type === 'datetime'
                  ? 'datetime-local'
                  : field.type === 'date'
                    ? 'date'
                    : 'text'
            }
            value={String(value[field.name] ?? '')}
            onChange={(event) => update(field.name, event.target.value)}
            min={field.type === 'integer' ? field.min : undefined}
            max={
              field.type === 'integer'
                ? Math.min(field.max || 20, maxPageSize)
                : undefined
            }
            maxLength={field.maxLength}
            aria-required={field.required}
            aria-invalid={Boolean(error)}
            aria-describedby={`${id}-help ${id}-error`}
          />
        )}
        <small id={`${id}-help`}>
          {field.help}
          {field.options ? ` Códigos: ${field.options.join(', ')}.` : ''}
          {restricted ? ` Requer ${field.requiredScope}.` : ''}
        </small>
        <span id={`${id}-error`} className="field-error">
          {error || ''}
        </span>
      </div>
    );
  }
  const fields = operation?.parameters || [];
  const uriExample = operation?.queryParams.includes('projectCode')
    ? operation.queryParams.includes('reportType')
      ? '?projectCode=5800&reportType=RCPU'
      : '?projectCode=05776&limit=20'
    : operation?.queryParams.includes('limit')
      ? '?limit=20'
      : operation?.queryParams.includes('includeDeleted')
        ? '?includeDeleted=true'
        : null;
  return (
    <section className="page-card api-playground-section">
      <h3>2. Informe os parâmetros</h3>
      {!operation ? (
        <p>Escolha uma permissão e uma operação para ver os parâmetros.</p>
      ) : (
        <>
          {operation.pathParams.length ? (
            <p>
              Informe o identificador do recurso indicado abaixo. Ele não é o ID
              do token.
            </p>
          ) : (
            <p>
              Esta operação lista registros. Não exige um ID individual; use os
              filtros opcionais para restringir a consulta.
            </p>
          )}
          {operation.queryParams.length ? (
            <p className="api-safe-note">
              Na URI, o primeiro filtro começa com ? e os demais são ligados por
              &amp;. {uriExample ? <>Exemplo desta operação: <code>{uriExample}</code>. </> : null}
              Codifique valores especiais na URL; o cURL gerado abaixo já mostra
              a URI resultante.
            </p>
          ) : null}
          {operation.responseKind === 'DOWNLOAD_CHECK' ? (
            <p className="api-safe-note">
              O teste verifica permissão e disponibilidade do arquivo, sem
              transferir seu conteúdo. O cURL permite testar o download real no
              ambiente do consumidor.
            </p>
          ) : null}
          <div className="api-form-grid">
            {fields.filter((field) => !field.advanced).map(renderField)}
          </div>
          {fields.some((field) => field.advanced) ? (
            <details>
              <summary>Paginação e filtros avançados</summary>
              <div className="api-form-grid">
                {fields.filter((field) => field.advanced).map(renderField)}
              </div>
            </details>
          ) : null}
          {!operation.queryParams.some((name) =>
            ['updatedSince', 'createdSince'].includes(name)
          ) && operation.queryParams.includes('cursor') ? (
            <p className="api-safe-note">
              Esta coleção não possui filtro por data. Use leitura completa para
              reconciliar alterações.
            </p>
          ) : null}
        </>
      )}
      <p className="api-safe-note">
        Destino, método, headers e corpo não são campos editáveis.
      </p>
    </section>
  );
}
