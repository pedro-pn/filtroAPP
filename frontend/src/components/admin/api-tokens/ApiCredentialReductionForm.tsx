import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ApiCredentialPublic } from '../../../../../shared/schemas/api-credentials.js';
import { makeReductionFormSchema, reductionDefaults, buildReductionPayload, type ReductionFormValues } from '../../../../../shared/schemas/api-credential-lifecycle.js';
import { apiValidationError } from '../../../../../shared/schemas/api-validation-messages.js';
import type { ApiScopeDefinition } from '../../../api/apiCredentials';
import { ApiScopeCatalog } from './ApiScopeCatalog';
import { Button } from '../../ui/Button';

export function ApiCredentialReductionForm({ credential, scopes, onSubmit, onCancel }: {
  credential: ApiCredentialPublic; scopes: ApiScopeDefinition[];
  onSubmit: (payload: Record<string, unknown>) => Promise<void>; onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [projectText, setProjectText] = useState(credential.projectAccess.projectIds.join(', '));
  const [ipText, setIpText] = useState(credential.allowedIpCidrs.join('\n'));
  const form = useForm<ReductionFormValues>({ resolver: zodResolver(makeReductionFormSchema(z, credential, scopes), { error: apiValidationError }) as Resolver<ReductionFormValues>, defaultValues: reductionDefaults(credential) });
  const { register, watch, setValue, handleSubmit, formState: { errors, isSubmitting } } = form;
  const values = watch();
  const message = (value: unknown) => {
    if (!value) return '';
    if (typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message;
    return 'Revise os valores informados.';
  };
  const split = (value: string) => value.split(/[\n,]/).map(v => v.trim()).filter(Boolean);
  const fieldClass = (value: unknown) => `field-group ${value ? 'field-invalid' : ''}`;
  const changeList = (name: 'allowedIpCidrs' | 'projectAccess.projectIds', item: string, checked: boolean) => setValue(name, checked ? [...form.getValues(name), item] : form.getValues(name).filter(v => v !== item), { shouldValidate: true });
  return <form noValidate className="api-credential-form" onSubmit={handleSubmit(async data => {
    setError('');
    try { await onSubmit(buildReductionPayload(data)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível reduzir o acesso.'); }
  })}>
    <div className="api-modal-body">
      <p>Retire acessos ou diminua limites. Para ampliar, cancele e use Rotacionar. A redução tem efeito imediato.</p>
      <fieldset disabled={isSubmitting} className="api-form-fields">
        <div className={fieldClass(errors.scopeCodes)} aria-invalid={Boolean(errors.scopeCodes)}>
          <ApiScopeCatalog scopes={scopes.filter(scope => credential.scopeCodes.includes(scope.code))} selected={values.scopeCodes} onChange={codes => setValue('scopeCodes', codes, { shouldValidate: true })} />
          {errors.scopeCodes ? <span className="field-error" role="alert">{message(errors.scopeCodes)}</span> : null}
        </div>
        <div className="api-form-grid">
          <div className={fieldClass(errors.projectAccess?.mode)}>
            <label htmlFor="reduce-project-mode">Projetos acessíveis</label>
            <select id="reduce-project-mode" value={values.projectAccess.mode} aria-invalid={Boolean(errors.projectAccess?.mode)} onChange={e => setValue('projectAccess', { mode: e.target.value as 'ALL' | 'SELECTED', projectIds: e.target.value === 'ALL' ? [] : split(projectText) }, { shouldValidate: true })}>
              <option value="ALL" disabled={credential.projectAccess.mode === 'SELECTED'}>Todos os projetos</option><option value="SELECTED">Somente selecionados</option>
            </select><span className="field-error">{message(errors.projectAccess?.mode)}</span>
          </div>
          {values.projectAccess.mode === 'SELECTED' ? <div className={fieldClass(errors.projectAccess?.projectIds)}>
            <label htmlFor="reduce-projects">Projetos permitidos *</label>
            {credential.projectAccess.mode === 'SELECTED' ? <div id="reduce-projects" className="api-policy-options">{credential.projectAccess.projectIds.map(id => <label key={id}><input type="checkbox" checked={values.projectAccess.projectIds.includes(id)} aria-invalid={Boolean(errors.projectAccess?.projectIds)} onChange={e => changeList('projectAccess.projectIds', id, e.target.checked)} /> {id}</label>)}</div>
              : <input id="reduce-projects" value={projectText} aria-invalid={Boolean(errors.projectAccess?.projectIds)} onChange={e => { setProjectText(e.target.value); setValue('projectAccess.projectIds', split(e.target.value), { shouldValidate: true }); }} />}
            <span className="field-error">{message(errors.projectAccess?.projectIds)}</span>
          </div> : null}
          <div className={fieldClass(errors.allowedIpCidrs)}>
            <label htmlFor="reduce-cidrs">IPs e redes permitidos</label>
            {credential.allowedIpCidrs.length ? <div id="reduce-cidrs" className="api-policy-options">{credential.allowedIpCidrs.map(ip => <label key={ip}><input type="checkbox" checked={values.allowedIpCidrs.includes(ip)} aria-invalid={Boolean(errors.allowedIpCidrs)} onChange={e => changeList('allowedIpCidrs', ip, e.target.checked)} /> {ip}</label>)}</div>
              : <textarea id="reduce-cidrs" value={ipText} aria-invalid={Boolean(errors.allowedIpCidrs)} onChange={e => { setIpText(e.target.value); setValue('allowedIpCidrs', split(e.target.value), { shouldValidate: true }); }} />}
            <small>{credential.allowedIpCidrs.length ? 'Mantenha ao menos uma rede. Retirar todas ampliaria o acesso.' : 'Opcional: restrinja um acesso atualmente sem restrição de IP.'}</small>
            <span className="field-error">{message(errors.allowedIpCidrs)}</span>
          </div>
          <div className={fieldClass(errors.expiresAt)}><label htmlFor="reduce-expiry">Antecipar ou definir expiração</label><input id="reduce-expiry" type="datetime-local" step="any" {...register('expiresAt')} aria-invalid={Boolean(errors.expiresAt)} /><span className="field-error">{message(errors.expiresAt)}</span></div>
          {([['requestsPerMinute', 'Requisições/minuto'], ['requestsPerDay', 'Requisições/dia'], ['rowsPerDay', 'Registros/dia'], ['maxPageSize', 'Registros por página']] as const).map(([key, label]) => <div key={key} className={fieldClass(errors.limits?.[key])}><label htmlFor={`reduce-${key}`}>{label}</label><input id={`reduce-${key}`} type="number" min={1} max={credential.limits[key]} {...register(`limits.${key}`, { valueAsNumber: true })} aria-invalid={Boolean(errors.limits?.[key])} /><span className="field-error">{message(errors.limits?.[key])}</span></div>)}
          <div className={fieldClass(errors.reason)}><label htmlFor="reduce-reason">Justificativa *</label><textarea id="reduce-reason" {...register('reason')} aria-invalid={Boolean(errors.reason)} aria-describedby="reduce-reason-error" /><span id="reduce-reason-error" className="field-error">{message(errors.reason)}</span></div>
        </div>
      </fieldset>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
    <div className="api-modal-footer"><Button variant="secondary" disabled={isSubmitting} onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Aplicando…' : 'Aplicar redução'}</Button></div>
  </form>;
}
