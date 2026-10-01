import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listDataSubjectRequests,
  respondDataSubjectRequest,
  updateDataSubjectRequestStatus,
  verifyDataSubjectRequestIdentity,
  type DataSubjectRequestAdminSummary
} from '../../api/privacy';

import { Modal } from '../../components/ui/Modal';
import { Alert, Badge, Button, Card, EmptyState, Field, SearchInput, Select, Skeleton, Textarea, type SemanticTone } from '../../components/ui/ds';
import { PageHeader } from '../../layout/PageHeader';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import { OperationalModuleAppShell } from '../OperationalModuleAppShell';
import './PrivacyRequestsPage.ds.css';

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

const requestStatusTone: Record<string, SemanticTone> = {
  OPEN: 'warning',
  IN_REVIEW: 'info',
  COMPLETED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral'
};
const requestStatusOptions = [
  { value: 'OPEN', label: 'Abertas' },
  { value: 'IN_REVIEW', label: 'Em análise' },
  { value: 'COMPLETED', label: 'Resolvidas' },
  { value: 'ALL', label: 'Todas' }
] as const;
type RequestStatusFilter = typeof requestStatusOptions[number]['value'];
type ResponseKind = 'ACKNOWLEDGEMENT' | 'VERIFICATION_REQUEST' | 'SUBSTANTIVE';
type EvidenceDialog = { kind: 'identity' | 'completion'; request: DataSubjectRequestAdminSummary };
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

function parseRequestStatusFilter(value: string | null): RequestStatusFilter {
  return requestStatusOptions.some(option => option.value === value) ? value as RequestStatusFilter : 'OPEN';
}

export function PrivacyRequestsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useUrlParamState<RequestStatusFilter>({
    param: 'tab',
    defaultValue: 'OPEN',
    parse: parseRequestStatusFilter
  });
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
  const [resolvedDrafts, setResolvedDrafts] = useState<Record<string, boolean>>({});
  const [responseKindDrafts, setResponseKindDrafts] = useState<Record<string, ResponseKind>>({});
  const [evidenceDialog, setEvidenceDialog] = useState<EvidenceDialog | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState('');
  const [evidenceError, setEvidenceError] = useState('');
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
      setEvidenceDialog(null);
      setNotice(`Identidade verificada para ${request.protocol}.`);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['privacy-requests'] });
    },
    onError: err => {
      setNotice('');
      const message = err instanceof Error ? err.message : 'Não foi possível registrar a verificação.';
      setError(message);
      setEvidenceError(message);
    }
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, resolved, offlineResponseEvidence }: { id: string; resolved: boolean; offlineResponseEvidence?: string }) =>
      updateDataSubjectRequestStatus(id, { resolved, offlineResponseEvidence }),
    onSuccess: async request => {
      setEvidenceDialog(null);
      setNotice(request.status === 'COMPLETED' ? 'Solicitação marcada como resolvida.' : 'Solicitação marcada como não resolvida.');
      setError('');
      setResolvedDrafts(current => ({ ...current, [request.id]: request.status === 'COMPLETED' }));
      await queryClient.invalidateQueries({ queryKey: ['privacy-requests'] });
    },
    onError: err => {
      setNotice('');
      const message = err instanceof Error ? err.message : 'Não foi possível atualizar o status.';
      setError(message);
      setEvidenceError(message);
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

  function handleSendResponse(request: DataSubjectRequestAdminSummary) {
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

  function openEvidenceDialog(kind: EvidenceDialog['kind'], request: DataSubjectRequestAdminSummary) {
    setEvidenceDialog({ kind, request });
    setEvidenceDraft('');
    setEvidenceError('');
    setError('');
  }

  function handleToggleResolved(request: DataSubjectRequestAdminSummary) {
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
    if (!request.responseNotes || request.responseEmailStatus !== 'SENT') {
      openEvidenceDialog('completion', request);
      return;
    }
    statusMutation.mutate({ id: request.id, resolved: true });
  }

  function submitEvidence() {
    if (!evidenceDialog) return;
    const evidence = evidenceDraft.trim();
    if (evidence.length < 10) {
      setEvidenceError(evidenceDialog.kind === 'identity'
        ? 'Informe uma evidência de verificação com pelo menos 10 caracteres.'
        : 'Informe uma evidência de atendimento com pelo menos 10 caracteres.');
      return;
    }
    setEvidenceError('');
    if (evidenceDialog.kind === 'identity') {
      identityMutation.mutate({ id: evidenceDialog.request.id, evidence });
    } else {
      statusMutation.mutate({ id: evidenceDialog.request.id, resolved: true, offlineResponseEvidence: evidence });
    }
  }

  return (
    <OperationalModuleAppShell moduleId="privacy" title="Privacidade" sectionLabel="Solicitações LGPD" subNavigation={[]}>
      <main className="privacy-requests-page fv-ds">
        <PageHeader
          title="Solicitações LGPD"
          description="Pedidos registrados em /privacidade/direitos e solicitações autenticadas da conta."
          actions={<Button variant="secondary" size="sm" onClick={() => void requestsQuery.refetch()} loading={requestsQuery.isFetching}>Atualizar</Button>}
        />

        {notice ? <Alert tone="success" onDismiss={() => setNotice('')}>{notice}</Alert> : null}
        {error ? <Alert tone="danger" onDismiss={() => setError('')}>{error}</Alert> : null}

        <div className="privacy-requests-summary" aria-label="Resumo das solicitações">
          <Card variant="flat" padding="sm"><span>Abertas</span><strong>{requestsQuery.data?.counts.open ?? 0}</strong></Card>
          <Card variant="flat" padding="sm"><span>Em análise</span><strong>{requestsQuery.data?.counts.inReview ?? 0}</strong></Card>
          <Card variant="flat" padding="sm"><span>Pendentes</span><strong>{requestsQuery.data?.counts.pending ?? 0}</strong></Card>
        </div>

        <Card className="privacy-requests-controls" padding="md">
          <div className="privacy-requests-filters" role="group" aria-label="Status das solicitações LGPD">
            {requestStatusOptions.map(option => (
              <button
                className={`filter-tab ${statusFilter === option.value ? 'active' : ''}`}
                key={option.value}
                type="button"
                aria-pressed={statusFilter === option.value}
                onClick={() => {
                  setStatusFilter(option.value);
                  setPage(1);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <SearchInput
              aria-label="Buscar em solicitações LGPD"
              placeholder="Buscar em solicitações LGPD"
              value={search}
              onChange={setSearch}
              resultCount={{ shown: requests.length, total: requestsQuery.data?.pagination.total ?? requests.length }}
          />
        </Card>

          {requestsQuery.isLoading ? (
            <Skeleton variant="card" label="Carregando solicitações LGPD" />
          ) : null}

          {requestsQuery.isError ? (
            <Alert tone="danger" action={{ label: 'Tentar novamente', onClick: () => void requestsQuery.refetch() }}>Não foi possível carregar as solicitações LGPD.</Alert>
          ) : null}

          {!requestsQuery.isLoading && !requestsQuery.isError && requests.length ? (
            <div className="privacy-request-list">
              {requests.map(request => (
                <Card className="privacy-request-card" key={request.id} padding="md">
                  <details>
                    <summary>
                      <span className="privacy-request-card__identity">
                        <strong>{request.protocol}</strong>
                        <span>{request.name} · {requestTypeLabel[request.type] || request.type}</span>
                      </span>
                      <span className="privacy-request-card__summary-meta">
                        <Badge tone={requestStatusTone[request.status] || 'neutral'}>{requestStatusLabel[request.status] || request.status}</Badge>
                        <Badge tone={request.identityVerifiedAt ? 'success' : 'warning'}>{request.identityVerifiedAt ? 'Identidade verificada' : 'Identidade pendente'}</Badge>
                        <span>{formatDate(request.createdAt)}</span>
                      </span>
                      <span className="privacy-request-card__expand" aria-hidden="true">Detalhes</span>
                    </summary>
                    <div className="privacy-request-card__body">
                      <div className="privacy-request-details">
                        <div><span>Recebida</span><strong>{formatDate(request.createdAt)}</strong></div>
                        <div><span>Origem</span><strong>{request.source}</strong></div>
                      </div>
                  <div className="privacy-request-data">
                    <div className="privacy-request-data__item">
                      <span className="privacy-request-data__label">Titular</span>
                      <span className="privacy-request-data__value">{request.name}</span>
                    </div>
                    <div className="privacy-request-data__item">
                      <span className="privacy-request-data__label">E-mail</span>
                      <span className="privacy-request-data__value">{request.email}</span>
                    </div>
                    <div className="privacy-request-data__item">
                      <span className="privacy-request-data__label">Identificador</span>
                      <span className="privacy-request-data__value">{request.identifier || '-'}</span>
                    </div>
                    <div className="privacy-request-data__item">
                      <span className="privacy-request-data__label">Detalhes</span>
                      <span className="privacy-request-data__value">{request.details}</span>
                    </div>
                    {request.requesterUser ? (
                      <div className="privacy-request-data__item">
                        <span className="privacy-request-data__label">Conta vinculada</span>
                        <span className="privacy-request-data__value">{request.requesterUser.name} ({request.requesterUser.username})</span>
                      </div>
                    ) : null}
                    <div className="privacy-request-data__item">
                      <span className="privacy-request-data__label">Verificação</span>
                      <span className="privacy-request-data__value">
                        {request.identityVerifiedAt
                          ? `Verificada em ${formatDate(request.identityVerifiedAt)}`
                          : highRiskRequestTypes.has(request.type) ? 'Obrigatória antes de resposta final/conclusão' : 'Não obrigatória para resposta inicial'}
                      </span>
                    </div>
                    {request.identityVerificationEvidence ? (
                      <div className="privacy-request-data__item">
                        <span className="privacy-request-data__label">Evidência de identidade</span>
                        <span className="privacy-request-data__value">{request.identityVerificationEvidence}</span>
                      </div>
                    ) : null}
                    {request.identityVerifiedByUser ? (
                      <div className="privacy-request-data__item">
                        <span className="privacy-request-data__label">Verificada por</span>
                        <span className="privacy-request-data__value">{request.identityVerifiedByUser.name} ({request.identityVerifiedByUser.username})</span>
                      </div>
                    ) : null}
                    {request.responseNotes ? (
                      <div className="privacy-request-data__item">
                        <span className="privacy-request-data__label">Observações</span>
                        <span className="privacy-request-data__value">{request.responseNotes}</span>
                      </div>
                    ) : null}
                    {request.responseEmailStatus ? (
                      <div className="privacy-request-data__item">
                        <span className="privacy-request-data__label">E-mail de resposta</span>
                        <span className="privacy-request-data__value">
                          {request.responseEmailStatus}
                          {request.responseEmailSentAt ? ` em ${formatDate(request.responseEmailSentAt)}` : ''}
                          {request.responseEmailError ? ` - ${request.responseEmailError}` : ''}
                        </span>
                      </div>
                    ) : null}
                    {request.completionNotes ? (
                      <div className="privacy-request-data__item">
                        <span className="privacy-request-data__label">Evidência de conclusão</span>
                        <span className="privacy-request-data__value">{request.completionNotes}</span>
                      </div>
                    ) : null}
                    {request.completedByUser ? (
                      <div className="privacy-request-data__item">
                        <span className="privacy-request-data__label">Concluída por</span>
                        <span className="privacy-request-data__value">{request.completedByUser.name} ({request.completedByUser.username})</span>
                      </div>
                    ) : null}
                    {request.responseAttempts?.length ? (
                      <div className="privacy-request-data__item">
                        <span className="privacy-request-data__label">Tentativas de envio</span>
                        <span className="privacy-request-data__value">
                          {request.responseAttempts.map(attempt =>
                            `${attempt.status} (${responseKindLabel[attempt.responseKind as ResponseKind] || attempt.responseKind}) em ${formatDate(attempt.sentAt || attempt.createdAt)}${attempt.providerMessageId ? ` - ID ${attempt.providerMessageId}` : ''}${attempt.error ? ` - ${attempt.error}` : ''}`
                          ).join(' | ')}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="privacy-request-response">
                  <Field id={`privacy-response-kind-${request.id}`} label="Tipo da resposta" optionalText={null}>
                    <Select
                      value={responseKindDrafts[request.id] || 'SUBSTANTIVE'}
                      onChange={event => setResponseKindDrafts(current => ({ ...current, [request.id]: event.target.value as ResponseKind }))}
                    >
                      {Object.entries(responseKindLabel).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field id={`privacy-response-${request.id}`} label="Resposta ao titular" optionalText={null}>
                    <Textarea
                      value={responseDrafts[request.id] ?? ''}
                      onChange={event => setResponseDrafts(current => ({ ...current, [request.id]: event.target.value }))}
                      rows={4}
                      maxLength={4000}
                      placeholder={`A resposta será enviada para ${request.email}`}
                    />
                  </Field>
                  <label className="privacy-request-resolved">
                    <input
                      type="checkbox"
                      checked={resolvedDrafts[request.id] ?? request.status === 'COMPLETED'}
                      onChange={event => setResolvedDrafts(current => ({ ...current, [request.id]: event.target.checked }))}
                    />
                    <span>Marcar como resolvida ao enviar a resposta</span>
                  </label>
                  <div className="privacy-request-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={identityMutation.isPending}
                      onClick={() => openEvidenceDialog('identity', request)}
                    >
                      {request.identityVerifiedAt ? 'Atualizar verificação' : 'Registrar verificação'}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={respondMutation.isPending}
                      onClick={() => handleSendResponse(request)}
                    >
                      {respondMutation.isPending ? 'Enviando...' : 'Enviar resposta'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={statusMutation.isPending}
                      onClick={() => handleToggleResolved(request)}
                    >
                      {request.status === 'COMPLETED' ? 'Marcar como não resolvida' : 'Marcar como resolvida'}
                    </Button>
                  </div>
                  </div>
                    </div>
                  </details>
                </Card>
              ))}
            </div>
          ) : null}

          {!requestsQuery.isLoading && !requestsQuery.isError && !requests.length ? (
            <EmptyState variant={search.trim() ? 'search' : 'default'} title={search.trim() ? 'Nenhuma solicitação encontrada.' : 'Nenhuma solicitação LGPD registrada.'} />
          ) : null}

          {!requestsQuery.isLoading && !requestsQuery.isError && requestsQuery.data ? (
            <nav className="privacy-request-pagination" aria-label="Paginação das solicitações">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(current => Math.max(1, current - 1))}
              >
                Anterior
              </Button>
              <span>
                Página {requestsQuery.data.pagination.page} de {requestsQuery.data.pagination.totalPages} ({requestsQuery.data.pagination.total} registros)
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= requestsQuery.data.pagination.totalPages}
                onClick={() => setPage(current => current + 1)}
              >
                Próxima
              </Button>
            </nav>
          ) : null}
        <Modal
          open={Boolean(evidenceDialog)}
          onClose={() => setEvidenceDialog(null)}
          appearance="design-system"
          title={evidenceDialog?.kind === 'identity' ? 'Registrar verificação de identidade' : 'Evidência de atendimento'}
          size="sm"
          panelClassName="privacy-evidence-dialog"
        >
          <div className="privacy-evidence-dialog__body">
            <p>{evidenceDialog?.kind === 'identity'
              ? 'Descreva como a identidade do titular foi verificada.'
              : 'Registre a evidência do atendimento feito fora do sistema.'}</p>
            <Field
              id="privacy-evidence"
              label="Evidência"
              required
              errorText={evidenceError || undefined}
            >
              <Textarea
                rows={4}
                maxLength={4000}
                value={evidenceDraft}
                onChange={event => { setEvidenceDraft(event.target.value); setEvidenceError(''); }}
              />
            </Field>
            <div className="privacy-evidence-dialog__actions">
              <Button variant="secondary" onClick={() => setEvidenceDialog(null)}>Cancelar</Button>
              <Button variant="primary" onClick={submitEvidence} loading={identityMutation.isPending || statusMutation.isPending}>Salvar evidência</Button>
            </div>
          </div>
        </Modal>
      </main>
    </OperationalModuleAppShell>
  );
}
