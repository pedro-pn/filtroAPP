import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { makePlaygroundParameterSchema, buildPlaygroundInput, playgroundParameterDefaults } from '../../../../shared/schemas/playground-parameters.js';
import { apiValidationError } from '../../../../shared/schemas/api-validation-messages.js';
import { operationsForScope } from '../../components/admin/api-tokens/apiOperations';

import type { CreateApiCredentialInput } from '../../../../shared/schemas/api-credentials.js';
import { createApiCredential, getApiCredential, listApiCredentials, listApiScopes, testApiCredential, type ApiPlaygroundResult, type IssuedApiCredential } from '../../api/apiCredentials';
import { nextAdminSearch, resolveSelectedCredential } from '../../components/admin/api-tokens/apiAdminNavigation';
import { failedPlaygroundResult } from '../../components/admin/api-tokens/apiRequestFormatting';
import { ApiCursorPagination } from '../../components/admin/api-tokens/ApiCursorPagination';
import { ApiClientError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { ApiCredentialCards } from '../../components/admin/api-tokens/ApiCredentialCards';
import { ApiCredentialForm } from '../../components/admin/api-tokens/ApiCredentialForm';
import { ApiCredentialActions } from '../../components/admin/api-tokens/ApiCredentialActions';
import { ApiCredentialActivity } from '../../components/admin/api-tokens/ApiCredentialActivity';
import { ApiTokenRevealModal } from '../../components/admin/api-tokens/ApiTokenRevealModal';
import { ApiOperationSelector } from '../../components/admin/api-tokens/ApiOperationSelector';
import { ApiOperationParameters, type ApiPlaygroundParameters } from '../../components/admin/api-tokens/ApiOperationParameters';
import { ApiRequestConsole } from '../../components/admin/api-tokens/ApiRequestConsole';
import { Button } from '../../components/ui/Button';
import { SearchBar } from '../../components/ui/SearchBar';
import { Skeleton } from '../../components/ui/Skeleton';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { isApiTokenPlaygroundNoveltyActive, markApiTokenPlaygroundNoveltySeen, shouldShowApiTokenPlaygroundNovelty } from './apiTokenPlaygroundNovelty';
import { startApiTokenPlaygroundTour } from './apiTokenPlaygroundTour';

export function AdminTokensPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const etapa = searchParams.get('etapa') || 'credenciais';
  const operation = searchParams.get('operation') || '';
  const testScope = searchParams.get('testScope') || '';
  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';
  const scopeFilter = searchParams.get('scope') || '';
  const expiresBeforeFilter = searchParams.get('expiresBefore') || '';
  const [issued, setIssued] = useState<IssuedApiCredential | null>(null);
  const [error, setError] = useState('');
  const selectedCredentialId = searchParams.get('credential') || '';
  const activityCredentialId = searchParams.get('detail') || '';
  const cursor = searchParams.get('cursor') || '';
  const eventCursor = searchParams.get('eventCursor') || '';
  const testSequence = useRef(0);
  const [playgroundResult, setPlaygroundResult] = useState<ApiPlaygroundResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [showNovelty, setShowNovelty] = useState(false);
  const noveltyWindowActive = isApiTokenPlaygroundNoveltyActive();
  const scopesQuery = useQuery({ queryKey: ['admin-api-scopes'], queryFn: listApiScopes, staleTime: 300000 });
  const credentialsQuery = useQuery({
    queryKey: ['admin-api-credentials', search, statusFilter, scopeFilter, expiresBeforeFilter, cursor],
    queryFn: () => listApiCredentials({
      ...(cursor ? { cursor } : {}),
      ...(search ? { q: search } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(scopeFilter ? { scope: scopeFilter } : {}),
      ...(expiresBeforeFilter ? { expiresBefore: `${expiresBeforeFilter}T23:59:59.999Z` } : {})
    })
  });

  const selectedQuery = useQuery({ queryKey: ['admin-api-credential', selectedCredentialId], queryFn: () => getApiCredential(selectedCredentialId), enabled: Boolean(selectedCredentialId), retry: false });
  const detailQuery = useQuery({ queryKey: ['admin-api-credential', activityCredentialId], queryFn: () => getApiCredential(activityCredentialId), enabled: Boolean(activityCredentialId), retry: false });

  async function refreshCredentials() {
    await Promise.all(['admin-api-credentials', 'admin-api-credential', 'admin-api-credential-events', 'admin-api-credential-usage'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
  }

  useEffect(() => {
    if (!user) return undefined;
    const isNew = shouldShowApiTokenPlaygroundNovelty(user);
    setShowNovelty(isNew);
    if (isNew) markApiTokenPlaygroundNoveltySeen(user);
    const timer = window.setTimeout(() => startApiTokenPlaygroundTour({ user }), 800);
    return () => window.clearTimeout(timer);
  }, [user]);

  async function issueCredential(payload: CreateApiCredentialInput) {
    setError('');
    const result = await createApiCredential(payload, crypto.randomUUID());
    // O segredo fica apenas neste estado efêmero; nunca entra no cache da consulta.
    setIssued(result);
    replaceSafeParams({ etapa: 'credenciais', credential: result.credential.id, detail: result.credential.id, cursor: '' });
    await refreshCredentials();
  }

  const credentials = credentialsQuery.data?.items || [];
  const selectedCredential = selectedQuery.isError ? null : resolveSelectedCredential(selectedCredentialId, [], selectedQuery.data);
  const activityCredential = detailQuery.isError ? null : resolveSelectedCredential(activityCredentialId, [], detailQuery.data);
  const credentialOptions = selectedCredential && !credentials.some(item => item.id === selectedCredential.id) ? [selectedCredential, ...credentials] : credentials;
  const operations = scopesQuery.data?.operations || [];
  const selectedOperation = operations.find(item => item.operationId === operation);
  const canTest = Boolean(selectedCredential && ['ACTIVE', 'NEAR_EXPIRY'].includes(selectedCredential.effectiveStatus) && selectedOperation && selectedOperation.requiredScopes.every(scope => selectedCredential.scopeCodes.includes(scope))
    && (!testScope || (selectedCredential.scopeCodes.includes(testScope) && operationsForScope(operations, testScope).includes(selectedOperation))));
  const maxTestItems = Math.min(20, selectedCredential?.limits.maxPageSize || 20);
  const grantedScopes = selectedCredential?.scopeCodes || [];
  const scopeSignature = grantedScopes.join('|');
  const parameterForm = useForm<ApiPlaygroundParameters>({
    resolver: zodResolver(makePlaygroundParameterSchema(z, selectedOperation?.parameters || [], { maxPageSize: maxTestItems, scopes: grantedScopes }), { error: apiValidationError }), defaultValues: {}
  });
  const { reset: resetParameters } = parameterForm;
  useEffect(() => {
    resetParameters(playgroundParameterDefaults(selectedOperation, maxTestItems, testScope, scopeSignature.split('|')));
    testSequence.current += 1;
    setPlaygroundResult(null);
    setTesting(false);
    setError('');
  }, [selectedOperation, selectedCredential?.id, selectedCredential?.version, maxTestItems, testScope, scopeSignature, resetParameters]);

  function replaceSafeParams(values: Record<string, string | undefined>) {
    setSearchParams(nextAdminSearch(searchParams, values), { replace: true });
  }

  function setEtapa(value: string) {
    replaceSafeParams({ etapa: value, operation: value === 'playground' ? operation : undefined });
  }

  async function runPlayground(values: ApiPlaygroundParameters) {
    if (!selectedCredential || !selectedOperation || !canTest) return;
    setTesting(true);
    setError('');
    setPlaygroundResult(null);
    const startedAt = performance.now();
    const sequence = ++testSequence.current;
    try {
      const result = await testApiCredential(selectedCredential.id, buildPlaygroundInput(selectedOperation, values));
      if (sequence === testSequence.current) setPlaygroundResult(result);
    } catch (cause) {
      if (sequence === testSequence.current) {
        setPlaygroundResult(failedPlaygroundResult(cause, performance.now() - startedAt));
        if (cause instanceof ApiClientError && Array.isArray(cause.fields)) {
          for (const field of cause.fields) {
            const name = String(field.path).replace(/^(query|pathParams)\./, '');
            if (selectedOperation.parameters.some(parameter => parameter.name === name)) parameterForm.setError(name, { type: 'server', message: field.message });
          }
        }
      }
    } finally {
      if (sequence === testSequence.current) setTesting(false);
    }
  }

  return (
    <Shell>
      <TopBar title="Tokens de API" subtitle="Integrações com menor privilégio" actions={<button className="topbar-chip" type="button" onClick={() => navigate('/admin/accounts')}>Contas</button>} />
      <main className="page-scroll api-token-page equip-page">
        <nav className="api-admin-tabs" aria-label="Administração"><button type="button" onClick={() => navigate('/admin/accounts')}>Contas</button><button type="button" className="active" aria-current="page">Tokens</button></nav>
        <section className="api-hero" data-api-token-hero>
          <div><span className="api-eyebrow">API PLAYGROUND {showNovelty ? <span className="api-new-badge">Novo</span> : null}</span><h1>Tokens e integrações</h1><p>Gerencie acessos de leitura aos dados do app e teste suas consultas.</p></div>
          <div className="api-hero-actions">{noveltyWindowActive ? <Button variant="secondary" onClick={() => startApiTokenPlaygroundTour({ user, force: true })}>Ver tutorial</Button> : null}{etapa !== 'configurar' ? <Button onClick={() => setEtapa('configurar')}>Gerar token</Button> : <Button variant="secondary" onClick={() => setEtapa('credenciais')}>Voltar à lista</Button>}</div>
        </section>
        <nav className="api-workflow-tabs" aria-label="Etapas do playground">
          <button data-api-workflow="credentials" type="button" aria-current={etapa === 'credenciais' ? 'page' : undefined} className={etapa === 'credenciais' ? 'active' : ''} onClick={() => setEtapa('credenciais')}>Meus tokens</button>
          <button data-api-workflow="configure" type="button" aria-current={etapa === 'configurar' ? 'page' : undefined} className={etapa === 'configurar' ? 'active' : ''} onClick={() => setEtapa('configurar')}>Novo token</button>
          <button data-api-workflow="playground" type="button" aria-current={etapa === 'playground' ? 'page' : undefined} className={etapa === 'playground' ? 'active' : ''} onClick={() => setEtapa('playground')}>Testar API</button>
        </nav>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        {etapa === 'configurar' ? (
          scopesQuery.isLoading ? <Skeleton lines={6} />
            : scopesQuery.isError ? <div className="inline-error">Não foi possível carregar o catálogo de permissões.</div>
              : <ApiCredentialForm scopes={scopesQuery.data?.items || []} onSubmit={issueCredential} />
        ) : etapa === 'playground' ? <section className="api-playground">
          <section className="page-card api-playground-section"><h3>Credencial usada na simulação</h3><div className="field-group"><label htmlFor="playground-credential">Credencial</label><select id="playground-credential" value={selectedCredentialId} onChange={event => { replaceSafeParams({ credential: event.target.value }); setPlaygroundResult(null); }}><option value="">Selecione</option>{selectedCredentialId && !credentialOptions.some(item => item.id === selectedCredentialId) ? <option value={selectedCredentialId}>Credencial indisponível</option> : null}{credentialOptions.map(item => <option key={item.id} value={item.id}>{item.name} · {item.displayToken}</option>)}</select></div>{selectedQuery.isError ? <p className="inline-error" role="alert">Não foi possível carregar a credencial selecionada. Selecione outra ou <button type="button" onClick={() => void selectedQuery.refetch()}>tente novamente</button>.</p> : null}<p>Para encontrar outros tokens, use os filtros e a paginação em Meus tokens e abra o token no Playground.</p><p>A restrição de IP não é simulada no painel; valide-a a partir da rede real do consumidor.</p></section>
          {scopesQuery.isError ? <div className="inline-error">Não foi possível carregar as operações disponíveis.</div> : null}
          <ApiOperationSelector operations={operations} scopes={scopesQuery.data?.items || []} scopeCode={testScope} credential={selectedCredential} value={operation}
            onScopeChange={value => replaceSafeParams({ etapa: 'playground', testScope: value, operation: value ? operationsForScope(operations, value)[0]?.operationId || '' : '' })}
            onChange={value => replaceSafeParams({ etapa: 'playground', operation: value })} />
          <ApiOperationParameters operation={selectedOperation} value={parameterForm.watch()} register={parameterForm.register} maxPageSize={maxTestItems} scopes={grantedScopes}
            errors={Object.fromEntries(Object.entries(parameterForm.formState.errors).map(([name, error]) => [name, String(error?.message || '')]))}
            onChange={value => { for (const [name, item] of Object.entries(value)) parameterForm.setValue(name, item, { shouldValidate: parameterForm.formState.isSubmitted }); testSequence.current += 1; setTesting(false); setPlaygroundResult(null); }} />
          <div className="api-playground-run"><Button disabled={!canTest || testing} onClick={() => void parameterForm.handleSubmit(runPlayground)()}>{testing ? 'Executando…' : selectedOperation?.responseKind === 'DOWNLOAD_CHECK' ? 'Verificar acesso ao arquivo' : 'Executar teste seguro'}</Button></div>
          <ApiRequestConsole result={playgroundResult} loading={testing} />
        </section> : <>
          <section className="page-card api-token-filters"><div className="field-group"><label htmlFor="api-token-search">Buscar</label><SearchBar id="api-token-search" value={search} onChange={value => replaceSafeParams({ q: value })} placeholder="Nome, finalidade ou destinatário"  /></div><div className="field-group"><label htmlFor="api-token-status">Status</label><select id="api-token-status" value={statusFilter} onChange={event => replaceSafeParams({ status: event.target.value })}><option value="">Todos</option><option value="ACTIVE">Ativos</option><option value="NEAR_EXPIRY">Vencem em breve</option><option value="SCHEDULED">Agendados</option><option value="EXPIRED">Expirados</option><option value="REVOKED">Revogados</option></select></div><div className="field-group"><label htmlFor="api-token-scope">Escopo</label><input id="api-token-scope" value={scopeFilter} onChange={event => replaceSafeParams({ scope: event.target.value })} placeholder="qualidade.registros.read" /></div><div className="field-group"><label htmlFor="api-token-expiry-filter">Vence até</label><input id="api-token-expiry-filter" type="date" value={expiresBeforeFilter} onChange={event => replaceSafeParams({ expiresBefore: event.target.value })} /></div></section>
          {credentialsQuery.isLoading ? <Skeleton lines={5} />
            : credentialsQuery.isError ? <div className="inline-error">Não foi possível carregar as credenciais.</div>
              : credentials.length === 0 ? <section className="page-card api-empty"><h2>Nenhuma credencial encontrada</h2><p>Gere um token temporário para começar.</p><Button onClick={() => setEtapa('configurar')}>Gerar primeiro token</Button></section>
                : <ApiCredentialCards credentials={credentials} onSelect={credential => replaceSafeParams({ detail: activityCredentialId === credential.id ? '' : credential.id })} />}
          <ApiCursorPagination key={[search, statusFilter, scopeFilter, expiresBeforeFilter].join('|')} label="Paginação dos tokens" cursor={cursor} nextCursor={credentialsQuery.data?.page.nextCursor} loading={credentialsQuery.isFetching} onChange={value => replaceSafeParams({ cursor: value })} />
          {activityCredentialId ? <section className="api-credential-detail" aria-label="Detalhes do token">
            <div className="api-hero-actions"><Button variant="secondary" onClick={() => replaceSafeParams({ detail: '' })}>Fechar detalhes</Button>{activityCredential ? <Button onClick={() => replaceSafeParams({ etapa: 'playground', credential: activityCredential.id })}>Abrir no Playground</Button> : null}</div>
            {detailQuery.isLoading ? <Skeleton /> : detailQuery.isError ? <p className="inline-error" role="alert">Não foi possível carregar os detalhes. <button type="button" onClick={() => void detailQuery.refetch()}>Tentar novamente</button></p> : activityCredential ? <>
              <h2>{activityCredential.name}</h2>
              {scopesQuery.data ? <ApiCredentialActions key={activityCredential.id} credential={activityCredential} scopes={scopesQuery.data.items} onChanged={refreshCredentials} onIssued={value => setIssued(value)} /> : <p>Carregue o catálogo de permissões para gerenciar a política.</p>}
              <ApiCredentialActivity key={'activity:' + activityCredential.id} credentialId={activityCredential.id} cursor={eventCursor} onCursorChange={value => replaceSafeParams({ eventCursor: value })} />
            </> : null}
          </section> : null}
        </>}
      </main>
      <ApiTokenRevealModal issued={issued} operations={operations} onClose={() => setIssued(null)} />
    </Shell>
  );
}
