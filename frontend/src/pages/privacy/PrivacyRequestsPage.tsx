import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import {
  listDataSubjectRequests,
  respondDataSubjectRequest,
  updateDataSubjectRequestStatus,
  verifyDataSubjectRequestIdentity
} from '../../api/privacy';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';

const requestTypeLabel: Record<string, string> = {
  CONFIRMATION: 'Confirmação',
  ACCESS: 'Acesso',
  CORRECTION: 'Correção',
  ANONYMIZATION: 'Anonimização',
  BLOCKING: 'Bloqueio',
  DELETION: 'Eliminação',
  PORTABILITY: 'Portabilidade',
  SHARING_INFO: 'Compartilhamento',
  CONSENT_REVOCATION: 'Revogação',
  OPPOSITION: 'Oposição',
  OTHER: 'Outro'
};

const requestStatusLabel: Record<string, string> = {
  OPEN: 'Aberta',
  IN_REVIEW: 'Em análise',
  COMPLETED: 'Resolvida',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada'
};

const requestStatusClass: Record<string, string> = {
  OPEN: 'privacy-status-open',
  IN_REVIEW: 'privacy-status-review',
  COMPLETED: 'privacy-status-resolved',
  REJECTED: 'privacy-status-rejected',
  CANCELLED: 'privacy-status-cancelled'
};
const requestStatusOptions = [
  { value: 'OPEN', label: 'Abertas' },
  { value: 'IN_REVIEW', label: 'Em análise' },
  { value: 'COMPLETED', label: 'Resolvidas' },
  { value: 'ALL', label: 'Todas' }
] as const;
type RequestStatusFilter = typeof requestStatusOptions[number]['value'];
type ResponseKind = 'ACKNOWLEDGEMENT' | 'VERIFICATION_REQUEST' | 'SUBSTANTIVE';
const highRiskRequestTypes = new Set([
  'CONFIRMATION',
  'ACCESS',
  'CORRECTION',
  'ANONYMIZATION',
  'BLOCKING',
  'DELETION',
  'PORTABILITY',
  'SHARING_INFO',
  'CONSENT_REVOCATION',
  'OPPOSITION',
  'OTHER'
]);
const responseKindLabel: Record<ResponseKind, string> = {
  ACKNOWLEDGEMENT: 'Acuse sem dados pessoais',
  VERIFICATION_REQUEST: 'Solicitar verificação',
  SUBSTANTIVE: 'Resposta final/com dados'
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function matchesSearch(values: Array<string | null | undefined>, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return values.some(value => String(value || '').toLowerCase().includes(needle));
}

export function PrivacyRequestsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RequestStatusFilter>('OPEN');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
  const [resolvedDrafts, setResolvedDrafts] = useState<Record<string, boolean>>({});
  const [responseKindDrafts, setResponseKindDrafts] = useState<Record<string, ResponseKind>>({});
  const requestsQuery = useQuery({
    queryKey: ['privacy-requests', statusFilter, page],
    queryFn: () => listDataSubjectRequests({ status: statusFilter, page, pageSize: 25 })
  });
  const respondMutation = useMutation({
    mutationFn: ({ id, message, resolved, responseKind }: { id: string; message: string; resolved: boolean; responseKind: ResponseKind }) =>
      respondDataSubjectRequest(id, { message, resolved, responseKind }),
    onSuccess: async request => {
      setNotice(`Resposta enviada para ${request.email}.`);
      setError('');
      setResponseDrafts(current => ({ ...current, [request.id]: '' }));
      setResolvedDrafts(current => ({ ...current, [request.id]: request.status === 'COMPLETED' }));
      setResponseKindDrafts(current => ({ ...current, [request.id]: 'SUBSTANTIVE' }));
      await queryClient.invalidateQueries({ queryKey: ['privacy-requests'] });
    },
    onError: err => {
      setNotice('');
      setError(err instanceof Error ? err.message : 'Não foi possível enviar a resposta.');
    }
  });
  const identityMutation = useMutation({
    mutationFn: ({ id, evidence }: { id: string; evidence: string }) =>
      verifyDataSubjectRequestIdentity(id, { evidence }),
    onSuccess: async request => {
      setNotice(`Identidade verificada para ${request.protocol}.`);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['privacy-requests'] });
    },
    onError: err => {
      setNotice('');
      setError(err instanceof Error ? err.message : 'Não foi possível registrar a verificação.');
    }
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, resolved, offlineResponseEvidence }: { id: string; resolved: boolean; offlineResponseEvidence?: string }) =>
      updateDataSubjectRequestStatus(id, { resolved, offlineResponseEvidence }),
    onSuccess: async request => {
      setNotice(request.status === 'COMPLETED' ? 'Solicitação marcada como resolvida.' : 'Solicitação marcada como não resolvida.');
      setError('');
      setResolvedDrafts(current => ({ ...current, [request.id]: request.status === 'COMPLETED' }));
      await queryClient.invalidateQueries({ queryKey: ['privacy-requests'] });
    },
    onError: err => {
      setNotice('');
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar o status.');
    }
  });

  const requests = useMemo(
    () => (requestsQuery.data?.requests || []).filter(request => matchesSearch([
      request.protocol,
      requestTypeLabel[request.type] || request.type,
      requestStatusLabel[request.status] || request.status,
      request.name,
      request.email,
      request.identifier || '',
      request.details
    ], search)),
    [requestsQuery.data?.requests, search]
  );

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  function handleSendResponse(request: NonNullable<typeof requestsQuery.data>['requests'][number]) {
    const message = (responseDrafts[request.id] || '').trim();
    const resolved = resolvedDrafts[request.id] ?? request.status === 'COMPLETED';
    const responseKind = responseKindDrafts[request.id] || 'SUBSTANTIVE';
    if (message.length < 10) {
      setNotice('');
      setError('Informe uma resposta com pelo menos 10 caracteres.');
      return;
    }
    if (highRiskRequestTypes.has(request.type) && !request.identityVerifiedAt && (responseKind === 'SUBSTANTIVE' || resolved)) {
      setNotice('');
      setError('Verifique a identidade do titular antes de enviar resposta final ou concluir esta solicitação.');
      return;
    }
    respondMutation.mutate({ id: request.id, message, resolved, responseKind });
  }

  function handleVerifyIdentity(request: NonNullable<typeof requestsQuery.data>['requests'][number]) {
    const evidence = window.prompt('Informe a evidência da verificação de identidade do titular.');
    if (evidence === null) return;
    const trimmed = evidence.trim();
    if (trimmed.length < 10) {
      setNotice('');
      setError('Informe uma evidência de verificação com pelo menos 10 caracteres.');
      return;
    }
    identityMutation.mutate({ id: request.id, evidence: trimmed });
  }

  function handleToggleResolved(request: NonNullable<typeof requestsQuery.data>['requests'][number]) {
    const resolved = request.status !== 'COMPLETED';
    if (!resolved) {
      statusMutation.mutate({ id: request.id, resolved: false });
      return;
    }
    if (highRiskRequestTypes.has(request.type) && !request.identityVerifiedAt) {
      setNotice('');
      setError('Verifique a identidade do titular antes de marcar esta solicitação como resolvida.');
      return;
    }
    let offlineResponseEvidence = '';
    if (!request.responseNotes || request.responseEmailStatus !== 'SENT') {
      const evidence = window.prompt('Informe a evidência de atendimento fora do sistema antes de marcar como resolvida.');
      if (evidence === null) return;
      offlineResponseEvidence = evidence.trim();
      if (offlineResponseEvidence.length < 10) {
        setNotice('');
        setError('Informe uma evidência de atendimento com pelo menos 10 caracteres.');
        return;
      }
    }
    statusMutation.mutate({ id: request.id, resolved: true, offlineResponseEvidence });
  }

  return (
    <Shell>
      <TopBar
        title="Privacidade"
        subtitle={user?.name}
        showLogo
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location.pathname) })}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />

      <main className="page-scroll">
        <section className="nps-tab-content">
          <div className="nps-tab-heading">
            <div>
              <div className="section-title">Solicitações LGPD</div>
              <div className="admin-card-subtitle">Pedidos registrados em /privacidade/direitos e solicitações autenticadas da conta.</div>
            </div>
            <button className="mini-btn alt" type="button" onClick={() => void requestsQuery.refetch()}>
              Atualizar
            </button>
          </div>

          {notice ? <div className="privacy-request-success">{notice}</div> : null}
          {error ? <div className="inline-error">{error}</div> : null}

          <div className="admin-card-meta">
            <span className="privacy-status-tag privacy-status-open">Abertas: {requestsQuery.data?.counts.open ?? 0}</span>
            <span className="privacy-status-tag privacy-status-review">Em análise: {requestsQuery.data?.counts.inReview ?? 0}</span>
            <span className="privacy-status-tag privacy-status-review">Pendentes: {requestsQuery.data?.counts.pending ?? 0}</span>
          </div>

          <div className="filter-tabs" role="tablist" aria-label="Status das solicitações LGPD">
            {requestStatusOptions.map(option => (
              <button
                className={`filter-tab ${statusFilter === option.value ? 'active' : ''}`}
                key={option.value}
                type="button"
                role="tab"
                aria-selected={statusFilter === option.value}
                onClick={() => {
                  setStatusFilter(option.value);
                  setPage(1);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="admin-search-row">
            <input
              aria-label="Buscar em solicitações LGPD"
              placeholder="Buscar em solicitações LGPD"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>

          {requestsQuery.isLoading ? (
            <div className="page-card placeholder-copy">Carregando solicitações LGPD...</div>
          ) : null}

          {requestsQuery.isError ? (
            <div className="page-card inline-error">Não foi possível carregar as solicitações LGPD.</div>
          ) : null}

          {!requestsQuery.isLoading && !requestsQuery.isError && requests.length ? (
            <div className="admin-stack">
              {requests.map(request => (
                <article className="card admin-card" key={request.id}>
                  <div className="admin-card-title">{request.protocol}</div>
                  <div className="admin-card-meta">
                    <span>{requestTypeLabel[request.type] || request.type}</span>
                    <span className={`privacy-status-tag ${requestStatusClass[request.status] || 'privacy-status-open'}`}>
                      {requestStatusLabel[request.status] || request.status}
                    </span>
                    <span>Recebida: {formatDate(request.createdAt)}</span>
                    <span>Origem: {request.source}</span>
                    <span className={`privacy-status-tag ${request.identityVerifiedAt ? 'privacy-status-resolved' : 'privacy-status-open'}`}>
                      {request.identityVerifiedAt ? 'Identidade verificada' : 'Identidade pendente'}
                    </span>
                  </div>
                  <div className="det-section" style={{ marginTop: 12 }}>
                    <div className="det-row">
                      <span className="det-label">Titular</span>
                      <span className="det-val">{request.name}</span>
                    </div>
                    <div className="det-row">
                      <span className="det-label">E-mail</span>
                      <span className="det-val">{request.email}</span>
                    </div>
                    <div className="det-row">
                      <span className="det-label">Identificador</span>
                      <span className="det-val">{request.identifier || '-'}</span>
                    </div>
                    <div className="det-row">
                      <span className="det-label">Detalhes</span>
                      <span className="det-val">{request.details}</span>
                    </div>
                    {request.requesterUser ? (
                      <div className="det-row">
                        <span className="det-label">Conta vinculada</span>
                        <span className="det-val">{request.requesterUser.name} ({request.requesterUser.username})</span>
                      </div>
                    ) : null}
                    <div className="det-row">
                      <span className="det-label">Verificação</span>
                      <span className="det-val">
                        {request.identityVerifiedAt
                          ? `Verificada em ${formatDate(request.identityVerifiedAt)}`
                          : highRiskRequestTypes.has(request.type) ? 'Obrigatória antes de resposta final/conclusão' : 'Não obrigatória para resposta inicial'}
                      </span>
                    </div>
                    {request.identityVerificationEvidence ? (
                      <div className="det-row">
                        <span className="det-label">Evidência de identidade</span>
                        <span className="det-val">{request.identityVerificationEvidence}</span>
                      </div>
                    ) : null}
                    {request.identityVerifiedByUser ? (
                      <div className="det-row">
                        <span className="det-label">Verificada por</span>
                        <span className="det-val">{request.identityVerifiedByUser.name} ({request.identityVerifiedByUser.username})</span>
                      </div>
                    ) : null}
                    {request.responseNotes ? (
                      <div className="det-row">
                        <span className="det-label">Observações</span>
                        <span className="det-val">{request.responseNotes}</span>
                      </div>
                    ) : null}
                    {request.responseEmailStatus ? (
                      <div className="det-row">
                        <span className="det-label">E-mail de resposta</span>
                        <span className="det-val">
                          {request.responseEmailStatus}
                          {request.responseEmailSentAt ? ` em ${formatDate(request.responseEmailSentAt)}` : ''}
                          {request.responseEmailError ? ` - ${request.responseEmailError}` : ''}
                        </span>
                      </div>
                    ) : null}
                    {request.completionNotes ? (
                      <div className="det-row">
                        <span className="det-label">Evidência de conclusão</span>
                        <span className="det-val">{request.completionNotes}</span>
                      </div>
                    ) : null}
                    {request.completedByUser ? (
                      <div className="det-row">
                        <span className="det-label">Concluída por</span>
                        <span className="det-val">{request.completedByUser.name} ({request.completedByUser.username})</span>
                      </div>
                    ) : null}
                    {request.responseAttempts?.length ? (
                      <div className="det-row">
                        <span className="det-label">Tentativas de envio</span>
                        <span className="det-val">
                          {request.responseAttempts.map(attempt =>
                            `${attempt.status} (${responseKindLabel[attempt.responseKind as ResponseKind] || attempt.responseKind}) em ${formatDate(attempt.sentAt || attempt.createdAt)}${attempt.providerMessageId ? ` - ID ${attempt.providerMessageId}` : ''}${attempt.error ? ` - ${attempt.error}` : ''}`
                          ).join(' | ')}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="field-group field-group-wide" style={{ marginTop: 12 }}>
                    <label htmlFor={`privacy-response-kind-${request.id}`}>Tipo da resposta</label>
                    <select
                      id={`privacy-response-kind-${request.id}`}
                      value={responseKindDrafts[request.id] || 'SUBSTANTIVE'}
                      onChange={event => setResponseKindDrafts(current => ({ ...current, [request.id]: event.target.value as ResponseKind }))}
                    >
                      {Object.entries(responseKindLabel).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group field-group-wide" style={{ marginTop: 12 }}>
                    <label htmlFor={`privacy-response-${request.id}`}>Resposta ao titular</label>
                    <textarea
                      id={`privacy-response-${request.id}`}
                      value={responseDrafts[request.id] ?? ''}
                      onChange={event => setResponseDrafts(current => ({ ...current, [request.id]: event.target.value }))}
                      rows={4}
                      maxLength={4000}
                      placeholder={`A resposta será enviada para ${request.email}`}
                    />
                  </div>
                  <label className="privacy-notice-check">
                    <input
                      type="checkbox"
                      checked={resolvedDrafts[request.id] ?? request.status === 'COMPLETED'}
                      onChange={event => setResolvedDrafts(current => ({ ...current, [request.id]: event.target.checked }))}
                    />
                    <span>Marcar como resolvida ao enviar a resposta</span>
                  </label>
                  <div className="collaborator-signature-actions" style={{ marginTop: 12 }}>
                    <button
                      className="mini-btn alt"
                      type="button"
                      disabled={identityMutation.isPending}
                      onClick={() => handleVerifyIdentity(request)}
                    >
                      {request.identityVerifiedAt ? 'Atualizar verificação' : 'Registrar verificação'}
                    </button>
                    <button
                      className="mini-btn"
                      type="button"
                      disabled={respondMutation.isPending}
                      onClick={() => handleSendResponse(request)}
                    >
                      {respondMutation.isPending ? 'Enviando...' : 'Enviar resposta'}
                    </button>
                    <button
                      className="mini-btn alt"
                      type="button"
                      disabled={statusMutation.isPending}
                      onClick={() => handleToggleResolved(request)}
                    >
                      {request.status === 'COMPLETED' ? 'Marcar como não resolvida' : 'Marcar como resolvida'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {!requestsQuery.isLoading && !requestsQuery.isError && !requests.length ? (
            <p className="placeholder-copy">
              {search.trim() ? 'Nenhuma solicitação encontrada.' : 'Nenhuma solicitação LGPD registrada.'}
            </p>
          ) : null}

          {!requestsQuery.isLoading && !requestsQuery.isError && requestsQuery.data ? (
            <div className="collaborator-signature-actions" style={{ marginTop: 12 }}>
              <button
                className="mini-btn alt"
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(current => Math.max(1, current - 1))}
              >
                Anterior
              </button>
              <span className="placeholder-copy">
                Página {requestsQuery.data.pagination.page} de {requestsQuery.data.pagination.totalPages} ({requestsQuery.data.pagination.total} registros)
              </span>
              <button
                className="mini-btn alt"
                type="button"
                disabled={page >= requestsQuery.data.pagination.totalPages}
                onClick={() => setPage(current => current + 1)}
              >
                Próxima
              </button>
            </div>
          ) : null}
        </section>
      </main>
    </Shell>
  );
}
