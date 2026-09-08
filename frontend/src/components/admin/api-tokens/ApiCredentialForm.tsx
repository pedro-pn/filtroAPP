import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';

import { makeApiCredentialSchemas, NEVER_EXPIRES_CONFIRMATION } from '../../../../../shared/schemas/api-credentials.js';
import type { CreateApiCredentialInput } from '../../../../../shared/schemas/api-credentials.js';
import type { ApiScopeDefinition } from '../../../api/apiCredentials';
import { Button } from '../../ui/Button';
import { ApiScopeCatalog } from './ApiScopeCatalog';
import { localCredentialDate } from '../../../../../shared/schemas/api-credential-lifecycle.js';
import { apiValidationError } from '../../../../../shared/schemas/api-validation-messages.js';

type FormValues = CreateApiCredentialInput;
const schemas = makeApiCredentialSchemas(z, { globalMaxPageSize: 500, allowLocalDateTime: true });
const pad = (value: number) => String(value).padStart(2, '0');
function localDateTime(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const expiryDurations: Record<string, number> = {
  '1h': 3600000, '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000, '90d': 90 * 86400000
};

interface Props {
  scopes: ApiScopeDefinition[];
  onSubmit: (payload: CreateApiCredentialInput) => Promise<void>;
  disabled?: boolean;
  initialValues?: CreateApiCredentialInput;
  title?: string;
  children?: ReactNode;
  onBeforeReview?: () => Promise<boolean>;
}

export function ApiCredentialForm({ scopes, onSubmit, disabled = false, initialValues, title = 'Novo token', children, onBeforeReview }: Props) {
  const now = useMemo(() => new Date(), []);
  const [expiryPreset, setExpiryPreset] = useState(initialValues ? initialValues.expiresAt ? 'custom' : 'never' : '30d');
  const [pending, setPending] = useState<CreateApiCredentialInput | null>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [projectIdsText, setProjectIdsText] = useState(initialValues?.projectAccess.projectIds.join(', ') || '');
  const [allowedIpCidrsText, setAllowedIpCidrsText] = useState(initialValues?.allowedIpCidrs.join('\n') || '');
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schemas.create, { error: apiValidationError }) as Resolver<FormValues>,
    defaultValues: initialValues ? { ...initialValues, startsAt: localCredentialDate(initialValues.startsAt), expiresAt: initialValues.expiresAt ? localCredentialDate(initialValues.expiresAt) : null, neverExpiresConfirmation: '' } : {
      name: '', purpose: '', recipientName: '',
      startsAt: localDateTime(now), expiresAt: localDateTime(new Date(now.getTime() + expiryDurations['30d'])), neverExpiresConfirmation: '',
      scopeCodes: ['qualidade.registros.read'], projectAccess: { mode: 'ALL', projectIds: [] },
      allowedIpCidrs: [], allowedFormats: ['JSON'],
      limits: { requestsPerMinute: 60, requestsPerDay: 10000, rowsPerDay: 500000, maxPageSize: 100 }
    }
  });
  const projectMode = watch('projectAccess.mode');
  const scopeCodes = watch('scopeCodes');
  const startsAt = watch('startsAt');
  const expiresAt = watch('expiresAt');
  const neverExpires = expiryPreset === 'never';
  const busy = disabled || issuing || isSubmitting;

  useEffect(() => {
    if (expiryPreset === 'custom') return;
    const start = Math.max(new Date(startsAt).getTime(), Date.now());
    if (Number.isNaN(start)) return;
    setValue('expiresAt', expiryPreset === 'never' ? null : localDateTime(new Date(start + expiryDurations[expiryPreset])), { shouldValidate: true });
  }, [expiryPreset, startsAt, setValue]);

  useEffect(() => {
    if (pending) reviewRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    setValue('projectAccess.projectIds', projectMode === 'ALL' ? [] : projectIdsText.split(',').map(item => item.trim()).filter(Boolean), { shouldValidate: true });
  }, [projectMode, projectIdsText, setValue]);

  async function prepareReview(values: FormValues) {
    if (onBeforeReview && !(await onBeforeReview())) return;
    setSubmitError('');
    setPending({
      ...values,
      startsAt: new Date(values.startsAt).toISOString(),
      expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null
    });
  }

  async function confirmIssue() {
    if (!pending || issuing) return;
    setIssuing(true);
    setSubmitError('');
    try {
      await onSubmit(pending);
      setPending(null);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Não foi possível gerar o token. Tente novamente.');
    } finally {
      setIssuing(false);
    }
  }

  const field = (name: keyof FormValues) => errors[name]?.message as string | undefined;
  const advancedHasErrors = Boolean(errors.startsAt || errors.projectAccess || errors.allowedIpCidrs || errors.limits);
  return (
    <form className="api-credential-form" onSubmit={handleSubmit(prepareReview, invalid => {
      if (invalid.startsAt || invalid.projectAccess || invalid.allowedIpCidrs || invalid.limits) setAdvancedOpen(true);
    })} noValidate>
      <fieldset className="api-form-fields" hidden={Boolean(pending)} disabled={busy || Boolean(pending)}>
        <div className="api-configuration-grid">
          <section className="page-card api-form-section">
            <div className="api-section-heading"><div><h3>{title}</h3><p>Identifique o acesso e defina por quanto tempo ele vale.</p></div></div>
            <div className="api-form-grid api-identity-grid">
              <div className={`field-group ${field('name') ? 'field-invalid' : ''}`}>
                <label htmlFor="api-token-name">Nome do token *</label>
                <input id="api-token-name" placeholder="Ex.: Exportação da qualidade" {...register('name')} aria-invalid={Boolean(field('name'))} aria-describedby={field('name') ? 'api-name-error' : undefined} />
                {field('name') ? <span id="api-name-error" className="field-error">{field('name')}</span> : null}
              </div>
              <div className={`field-group ${field('recipientName') ? 'field-invalid' : ''}`}>
                <label htmlFor="api-token-recipient">Destinatário *</label>
                <input id="api-token-recipient" placeholder="Pessoa ou sistema que usará o token" {...register('recipientName')} aria-invalid={Boolean(field('recipientName'))} aria-describedby={field('recipientName') ? 'api-recipient-error' : undefined} />
                {field('recipientName') ? <span id="api-recipient-error" className="field-error">{field('recipientName')}</span> : null}
              </div>
              <div className={`field-group ${field('purpose') ? 'field-invalid' : ''}`}>
                <label htmlFor="api-token-purpose">Finalidade *</label>
                <input id="api-token-purpose" placeholder="Ex.: Consultar registros para análise mensal" {...register('purpose')} aria-invalid={Boolean(field('purpose'))} aria-describedby="api-purpose-help" />
                <small id="api-purpose-help" className={field('purpose') ? 'field-error' : ''}>{field('purpose') || 'Resuma o uso em uma frase (mínimo de 10 caracteres).'}</small>
              </div>
              <div className="field-group">
                <label htmlFor="api-token-expiry-preset">Validade</label>
                <select id="api-token-expiry-preset" value={expiryPreset} onChange={event => {
                  const value = event.target.value;
                  if (value === 'custom' && !expiresAt) setValue('expiresAt', localDateTime(new Date(Date.now() + expiryDurations['30d'])));
                  setExpiryPreset(value);
                }}>
                  <option value="1h">1 hora</option><option value="24h">24 horas</option><option value="7d">7 dias</option>
                  <option value="30d">30 dias (recomendado)</option><option value="90d">90 dias</option>
                  <option value="custom">Data personalizada</option><option value="never">Sem expiração</option>
                </select>
                {!neverExpires && expiryPreset !== 'custom' && expiresAt ? <small>Expira em {new Date(expiresAt).toLocaleString('pt-BR')}.</small> : null}
              </div>
              {expiryPreset === 'custom' ? <div className={`field-group ${field('expiresAt') ? 'field-invalid' : ''}`}><label htmlFor="api-token-expiry">Data de expiração *</label><input id="api-token-expiry" type="datetime-local" step="any" {...register('expiresAt')} aria-invalid={Boolean(field('expiresAt'))} />{field('expiresAt') ? <span className="field-error">{field('expiresAt')}</span> : null}</div> : null}
              {neverExpires ? <div className={`field-group api-expiry-warning ${field('neverExpiresConfirmation') ? 'field-invalid' : ''}`}>
                <p>Este acesso ficará ativo até ser revogado. Use apenas quando necessário.</p>
                <label htmlFor="api-token-never">Digite {NEVER_EXPIRES_CONFIRMATION} para confirmar</label>
                <input id="api-token-never" {...register('neverExpiresConfirmation')} aria-invalid={Boolean(field('neverExpiresConfirmation'))} />
                {field('neverExpiresConfirmation') ? <span className="field-error">{field('neverExpiresConfirmation')}</span> : null}
              </div> : null}
            </div>
          </section>

          <section className="page-card api-form-section">
            <ApiScopeCatalog scopes={scopes} selected={scopeCodes} onChange={value => setValue('scopeCodes', value, { shouldValidate: true })} />
            {errors.scopeCodes ? <p className="field-error" role="alert">Selecione ao menos uma permissão de leitura.</p> : null}
          </section>
        </div>

        <details className="page-card api-advanced-settings" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
          <summary>Configurações avançadas<span>Projetos, IPs, agendamento e limites de uso</span></summary>
          <p className="api-safe-note">Padrão: todos os projetos, sem restrição de IP, até 60 requisições/minuto e 100 registros por página. Resposta em JSON.</p>
          <div className="api-form-grid">
            <div className="field-group"><label htmlFor="api-token-project-mode">Projetos acessíveis</label><select id="api-token-project-mode" {...register('projectAccess.mode')}><option value="ALL">Todos os projetos</option><option value="SELECTED">Somente selecionados</option></select></div>
            {projectMode === 'SELECTED' ? <div className={`field-group ${errors.projectAccess?.projectIds ? 'field-invalid' : ''}`}>
              <label htmlFor="api-token-projects">IDs dos projetos *</label>
              <input id="api-token-projects" placeholder="Separe os IDs por vírgula" value={projectIdsText} aria-invalid={Boolean(errors.projectAccess?.projectIds)} onChange={event => setProjectIdsText(event.target.value)} />
              {errors.projectAccess?.projectIds ? <span className="field-error">{errors.projectAccess.projectIds.message || 'Revise os IDs dos projetos.'}</span> : null}
            </div> : null}
            <div className={`field-group ${field('startsAt') ? 'field-invalid' : ''}`}>
              <label htmlFor="api-token-start">Início do acesso</label><input id="api-token-start" type="datetime-local" step="any" {...register('startsAt')} aria-invalid={Boolean(field('startsAt'))} />
              <small>Altere apenas se quiser agendar a ativação.</small>
              {field('startsAt') ? <span className="field-error">{field('startsAt')}</span> : null}
            </div>
            <div className={`field-group full ${errors.allowedIpCidrs ? 'field-invalid' : ''}`}>
              <label htmlFor="api-token-cidrs">Restringir a IPs ou redes (opcional)</label>
              <textarea id="api-token-cidrs" rows={2} placeholder="Ex.: 203.0.113.10/32 — um IP ou CIDR por linha" value={allowedIpCidrsText} aria-invalid={Boolean(errors.allowedIpCidrs)} onChange={event => { setAllowedIpCidrsText(event.target.value); setValue('allowedIpCidrs', event.target.value.split(/[\n,]/).map(item => item.trim()).filter(Boolean), { shouldValidate: true }); }} />
              <small>Em branco, permite acesso a partir de qualquer IP.</small>
              {errors.allowedIpCidrs ? <span className="field-error">{errors.allowedIpCidrs.message || 'Revise os IPs e redes informados.'}</span> : null}
            </div>
          </div>
          <div className="api-limits-grid">
            {([
              ['requestsPerMinute', 'Requisições/minuto', 'api-token-rpm', 600],
              ['requestsPerDay', 'Requisições/dia', 'api-token-rpd', 100000],
              ['rowsPerDay', 'Registros/dia', 'api-token-rows', 10000000],
              ['maxPageSize', 'Registros por página', 'api-token-page', 500]
            ] as const).map(([key, label, id, max]) => <div className={`field-group ${errors.limits?.[key] ? 'field-invalid' : ''}`} key={key}>
              <label htmlFor={id}>{label}</label>
              <input id={id} type="number" min={1} max={max} {...register(`limits.${key}`, { valueAsNumber: true })} aria-invalid={Boolean(errors.limits?.[key])} />
              {errors.limits?.[key] ? <span className="field-error">{errors.limits[key]?.message}</span> : null}
            </div>)}
          </div>
        </details>
        {children}
      </fieldset>

      {pending ? <section ref={reviewRef} tabIndex={-1} className="page-card api-review-card" aria-labelledby="api-review-title">
        <h3 id="api-review-title">Confira antes de gerar</h3>
        <p><strong>{pending.name}</strong> para {pending.recipientName}.</p>
        <dl className="api-review-summary">
          <div><dt>Permissões</dt><dd>{scopes.filter(scope => pending.scopeCodes.includes(scope.code)).map(scope => scope.label).join(', ')}</dd></div>
          <div><dt>Validade</dt><dd>{pending.expiresAt ? `Até ${new Date(pending.expiresAt).toLocaleString('pt-BR')}` : 'Sem expiração'}</dd></div>
          <div><dt>Projetos e rede</dt><dd>{pending.projectAccess.mode === 'ALL' ? 'Todos os projetos' : `${pending.projectAccess.projectIds.length} projeto(s)`} · {pending.allowedIpCidrs.length ? `${pending.allowedIpCidrs.length} IP(s)/rede(s)` : 'Sem restrição de IP'}</dd></div>
          <div><dt>Finalidade</dt><dd>{pending.purpose}</dd></div>
          <div><dt>Início</dt><dd>{new Date(pending.startsAt).toLocaleString('pt-BR')}</dd></div>
          <div><dt>Limites</dt><dd>{pending.limits.requestsPerMinute} requisições/min · {pending.limits.requestsPerDay} requisições/dia · {pending.limits.rowsPerDay} registros/dia · {pending.limits.maxPageSize} por página</dd></div>
        </dl>
        <p className="api-safe-note">O token completo será mostrado uma única vez.</p>
        <div className="api-review-actions"><Button variant="secondary" disabled={busy} onClick={() => { setPending(null); setSubmitError(''); }}>Voltar e ajustar</Button><Button disabled={busy} onClick={confirmIssue}>{issuing ? 'Gerando…' : 'Confirmar e gerar token'}</Button></div>
      </section> : <div className="api-form-actions"><p className="api-safe-note">Somente leitura · Token exibido uma única vez</p><Button type="submit" disabled={busy}>Revisar e gerar token</Button></div>}
      {advancedHasErrors ? <p className="field-error" role="alert">Revise os campos destacados nas configurações avançadas.</p> : null}
      {submitError ? <div className="inline-error" role="alert">{submitError}</div> : null}
    </form>
  );
}
