import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
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
import { ApiCredentialSummary } from '../../components/admin/api-tokens/ApiCredentialSummary';
import { ApiCredentialForm } from '../../components/admin/api-tokens/ApiCredentialForm';
import { ApiCredentialActions } from '../../components/admin/api-tokens/ApiCredentialActions';
import { ApiCredentialActivity } from '../../components/admin/api-tokens/ApiCredentialActivity';
import { ApiTokenRevealModal } from '../../components/admin/api-tokens/ApiTokenRevealModal';
import { ApiOperationSelector } from '../../components/admin/api-tokens/ApiOperationSelector';
import { ApiOperationParameters, type ApiPlaygroundParameters } from '../../components/admin/api-tokens/ApiOperationParameters';
import { ApiRequestConsole } from '../../components/admin/api-tokens/ApiRequestConsole';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Alert, Badge, Button, Card, EmptyState, Field, FilterBar, Input, SearchInput, Select } from '../../components/ui/ds';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { AdminModuleAppShell } from './AdminModuleAppShell';
import { isApiTokenPlaygroundNoveltyActive, markApiTokenPlaygroundNoveltySeen, shouldShowApiTokenPlaygroundNovelty } from './apiTokenPlaygroundNovelty';
import { startApiTokenPlaygroundTour } from './apiTokenPlaygroundTour';
import './AdminTokensPage.ds.css';

const STATUS_FILTER_LABELS: Record<string, string> = {
  ACTIVE: 'Ativos', NEAR_EXPIRY: 'Vencem em breve', SCHEDULED: 'Agendados', EXPIRED: 'Expirados', REVOKED: 'Revogados'
};

export function AdminTokensPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
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
  const [pendingPostParameters, setPendingPostParameters] = useState<ApiPlaygroundParameters | null>(null);
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
    resolver: zodResolver(makePlaygroundParameterSchema(z, selectedOperation?.parameters || [], { maxPageSize: maxTestItems, scopes: grantedScopes, method: selectedOperation?.method }), { error: apiValidationError }), defaultValues: {}
  });
  const { reset: resetParameters } = parameterForm;
  useEffect(() => {
    resetParameters(playgroundParameterDefaults(selectedOperation, maxTestItems, testScope, scopeSignature.split('|')));
    testSequence.current += 1;
    setPlaygroundResult(null);
    setTesting(false);
    setPendingPostParameters(null);
    setError('');
  }, [selectedOperation, selectedCredential?.id, selectedCredential?.version, maxTestItems, testScope, scopeSignature, resetParameters]);

  useEffect(() => {
    if (etapa !== 'credenciais' || !activityCredentialId) return;
    const timeout = window.setTimeout(() => {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('api-credential-detail')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }, 100);
    return () => window.clearTimeout(timeout);
  }, [activityCredentialId, etapa]);

  function replaceSafeParams(values: Record<string, string | undefined>) {
    setSearchParams(nextAdminSearch(searchParams, values), { replace: true });
  }

  function changeListFilters(values: Record<string, string>) {
    replaceSafeParams({ ...values, cursor: '' });
  }

  const activeFilters = [
    ...(search ? [{ id: 'q', label: `Busca: ${search}`, onRemove: () => changeListFilters({ q: '' }) }] : []),
    ...(statusFilter ? [{ id: 'status', label: `Status: ${STATUS_FILTER_LABELS[statusFilter] || statusFilter}`, onRemove: () => changeListFilters({ status: '' }) }] : []),
    ...(scopeFilter ? [{ id: 'scope', label: `Escopo: ${scopeFilter}`, onRemove: () => changeListFilters({ scope: '' }) }] : []),
    ...(expiresBeforeFilter ? [{ id: 'expiresBefore', label: `Vence até: ${expiresBeforeFilter}`, onRemove: () => changeListFilters({ expiresBefore: '' }) }] : [])
  ];

  function setEtapa(value: string) {
    replaceSafeParams({ etapa: value, operation: value === 'playground' ? operation : undefined });
  }

  async function executePlayground(values: ApiPlaygroundParameters) {
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

  function runPlayground(values: ApiPlaygroundParameters) {
    if (selectedOperation?.method === 'POST') {
      setPendingPostParameters(values);
      return;
    }
    void executePlayground(values);
  }

  return (
    <AdminModuleAppShell sectionLabel="Tokens de API">
      <main className="fv-ds api-token-page api-token-page-v2">
        <div data-api-token-hero>
          <PageHeader title="Tokens e integrações" description="Gerencie permissões de integração e teste as operações autorizadas."
            auxiliary={showNovelty ? <Badge tone="info">Novo API Playground</Badge> : null}
            actions={<div className="api-hero-actions">{noveltyWindowActive ? <Button variant="secondary" onClick={() => startApiTokenPlaygroundTour({ user, force: true })}>Ver tutorial</Button> : null}{etapa !== 'configurar' ? <Button variant="primary" onClick={() => setEtapa('configurar')}>Gerar token</Button> : <Button variant="secondary" onClick={() => setEtapa('credenciais')}>Voltar à lista</Button>}</div>} />
        </div>
        <nav className="api-workflow-tabs" aria-label="Etapas do playground">
          <button data-api-workflow="credentials" type="button" aria-current={etapa === 'credenciais' ? 'page' : undefined} className={etapa === 'credenciais' ? 'active' : ''} onClick={() => setEtapa('credenciais')}><span className="api-workflow-number">1</span><span>Meus tokens</span></button>
          <button data-api-workflow="configure" type="button" aria-current={etapa === 'configurar' ? 'page' : undefined} className={etapa === 'configurar' ? 'active' : ''} onClick={() => setEtapa('configurar')}><span className="api-workflow-number">2</span><span>Novo token</span></button>
          <button data-api-workflow="playground" type="button" aria-current={etapa === 'playground' ? 'page' : undefined} className={etapa === 'playground' ? 'active' : ''} onClick={() => setEtapa('playground')}><span className="api-workflow-number">3</span><span>Testar API</span></button>
        </nav>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {etapa === 'configurar' ? (
          scopesQuery.isLoading ? <Skeleton lines={6} />
            : scopesQuery.isError ? <Alert tone="danger" action={{ label: 'Tentar novamente', onClick: () => void scopesQuery.refetch() }}>Não foi possível carregar o catálogo de permissões.</Alert>
              : <ApiCredentialForm scopes={scopesQuery.data?.items || []} onSubmit={issueCredential} />
        ) : etapa === 'playground' ? <section className="api-playground">
          <Card className="api-playground-section api-playground-credential" header={<h3>Credencial usada na simulação</h3>}>
            <Field id="playground-credential" label="Credencial" optionalText="">
              <Select value={selectedCredentialId} onChange={event => { replaceSafeParams({ credential: event.target.value }); setPlaygroundResult(null); }}><option value="">Selecione</option>{selectedCredentialId && !credentialOptions.some(item => item.id === selectedCredentialId) ? <option value={selectedCredentialId}>Credencial indisponível</option> : null}{credentialOptions.map(item => <option key={item.id} value={item.id}>{item.name} · {item.displayToken}</option>)}</Select>
            </Field>
            {selectedQuery.isError ? <Alert tone="danger" action={{ label: 'Tentar novamente', onClick: () => void selectedQuery.refetch() }}>Não foi possível carregar a credencial selecionada. Selecione outra ou tente novamente.</Alert> : null}
            <p>Para encontrar outros tokens, use os filtros e a paginação em Meus tokens e abra o token no Playground.</p>
            <p>A restrição de IP não é simulada no painel; valide-a a partir da rede real do consumidor.</p>
          </Card>
          {scopesQuery.isError ? <Alert tone="danger" action={{ label: 'Tentar novamente', onClick: () => void scopesQuery.refetch() }}>Não foi possível carregar as operações disponíveis.</Alert> : null}
          <ApiOperationSelector operations={operations} scopes={scopesQuery.data?.items || []} scopeCode={testScope} credential={selectedCredential} value={operation}
            onScopeChange={value => replaceSafeParams({ etapa: 'playground', testScope: value, operation: value ? operationsForScope(operations, value)[0]?.operationId || '' : '' })}
            onChange={value => replaceSafeParams({ etapa: 'playground', operation: value })} />
          <ApiOperationParameters operation={selectedOperation} value={parameterForm.watch()} register={parameterForm.register} maxPageSize={maxTestItems} scopes={grantedScopes}
            errors={Object.fromEntries(Object.entries(parameterForm.formState.errors).map(([name, error]) => [name, String(error?.message || '')]))}
            onChange={value => { for (const [name, item] of Object.entries(value)) parameterForm.setValue(name, item, { shouldValidate: parameterForm.formState.isSubmitted }); testSequence.current += 1; setTesting(false); setPlaygroundResult(null); }} />
          <div className="api-playground-run"><Button variant="primary" loading={testing} disabled={!canTest || testing} onClick={() => void parameterForm.handleSubmit(runPlayground)()}>{testing ? 'Executando…' : selectedOperation?.method === 'POST' ? 'Enviar POST' : selectedOperation?.responseKind === 'DOWNLOAD_CHECK' ? 'Verificar acesso ao arquivo' : 'Executar teste seguro'}</Button></div>
          <ApiRequestConsole result={playgroundResult} loading={testing} />
        </section> : <>
          <FilterBar className="api-token-filters" label="Filtros dos tokens" resultsId="api-token-results"
            search={<SearchInput id="api-token-search" label="Buscar token" value={search} onChange={value => changeListFilters({ q: value })} placeholder="Nome, finalidade ou destinatário" loading={credentialsQuery.isFetching && !credentialsQuery.isLoading} />}
            activeFilters={activeFilters} activeCount={activeFilters.length} loading={credentialsQuery.isFetching && !credentialsQuery.isLoading}
            onClear={() => changeListFilters({ q: '', status: '', scope: '', expiresBefore: '' })} mobileApplyLabel="Ver tokens">
            <Field id="api-token-status" label="Status" optionalText=""><Select value={statusFilter} onChange={event => changeListFilters({ status: event.target.value })}><option value="">Todos</option><option value="ACTIVE">Ativos</option><option value="NEAR_EXPIRY">Vencem em breve</option><option value="SCHEDULED">Agendados</option><option value="EXPIRED">Expirados</option><option value="REVOKED">Revogados</option></Select></Field>
            <Field id="api-token-scope" label="Escopo" optionalText=""><Input value={scopeFilter} onChange={event => changeListFilters({ scope: event.target.value })} placeholder="Ex.: projetos.read" /></Field>
            <Field id="api-token-expiry-filter" label="Vence até" optionalText=""><Input type="date" value={expiresBeforeFilter} onChange={event => changeListFilters({ expiresBefore: event.target.value })} /></Field>
          </FilterBar>
          <div id="api-token-results" aria-live="polite">
            {credentialsQuery.isLoading ? <Skeleton lines={5} />
              : credentialsQuery.isError ? <Alert tone="danger" title="Não foi possível carregar as credenciais" action={{ label: 'Tentar novamente', onClick: () => void credentialsQuery.refetch() }}>Confira a conexão e tente novamente.</Alert>
                : credentials.length === 0 ? <EmptyState title={activeFilters.length ? 'Nenhum token encontrado' : 'Nenhum token cadastrado'} description={activeFilters.length ? 'Ajuste ou limpe os filtros para ver outros tokens.' : 'Crie uma credencial para começar.'} variant={activeFilters.length ? 'search' : 'create'} action={activeFilters.length ? { label: 'Limpar filtros', onClick: () => changeListFilters({ q: '', status: '', scope: '', expiresBefore: '' }) } : { label: 'Gerar primeiro token', onClick: () => setEtapa('configurar') }} />
                  : <ApiCredentialCards credentials={credentials} selectedId={activityCredentialId} onSelect={credential => replaceSafeParams({ detail: activityCredentialId === credential.id ? '' : credential.id, eventCursor: '' })} />}
          </div>
          {cursor || credentialsQuery.data?.page.nextCursor ? <ApiCursorPagination key={[search, statusFilter, scopeFilter, expiresBeforeFilter].join('|')} label="Paginação dos tokens" cursor={cursor} nextCursor={credentialsQuery.data?.page.nextCursor} loading={credentialsQuery.isFetching} onChange={value => replaceSafeParams({ cursor: value })} /> : null}
          {activityCredentialId ? <section id="api-credential-detail" className="api-credential-detail" aria-label="Detalhes do token">
            <div className="api-detail-heading"><div><span className="api-detail-eyebrow">Detalhes da credencial</span><h2>{activityCredential?.name || 'Carregando credencial'}</h2></div><div className="api-hero-actions"><Button variant="secondary" size="sm" onClick={() => replaceSafeParams({ detail: '', eventCursor: '' })}>Fechar detalhes</Button>{activityCredential ? <Button variant="primary" size="sm" onClick={() => replaceSafeParams({ etapa: 'playground', credential: activityCredential.id })}>Abrir no Playground</Button> : null}</div></div>
            {detailQuery.isLoading ? <Skeleton /> : detailQuery.isError ? <Alert tone="danger" title="Não foi possível carregar os detalhes" action={{ label: 'Tentar novamente', onClick: () => void detailQuery.refetch() }} /> : activityCredential ? <>
              <ApiCredentialSummary credential={activityCredential} />
              {scopesQuery.data ? <ApiCredentialActions key={activityCredential.id} credential={activityCredential} scopes={scopesQuery.data.items} onChanged={refreshCredentials} onIssued={value => setIssued(value)} /> : <Alert tone="warning">Carregue o catálogo de permissões para gerenciar a política.</Alert>}
              <ApiCredentialActivity key={'activity:' + activityCredential.id} credentialId={activityCredential.id} cursor={eventCursor} onCursorChange={value => replaceSafeParams({ eventCursor: value })} />
            </> : null}
          </section> : null}
        </>}
      </main>
      <ApiTokenRevealModal issued={issued} operations={operations} onClose={() => setIssued(null)} />
      <ConfirmDialog
        open={Boolean(pendingPostParameters)}
        appearance="design-system"
        title="Enviar operação POST?"
        description="Esta operação grava dados reais. Confirme o envio antes de continuar."
        confirmLabel="Enviar POST"
        confirmDisabled={testing || !canTest}
        onConfirm={() => {
          const values = pendingPostParameters;
          setPendingPostParameters(null);
          if (values) void executePlayground(values);
        }}
        onCancel={() => setPendingPostParameters(null)}
      />
    </AdminModuleAppShell>
  );
}
