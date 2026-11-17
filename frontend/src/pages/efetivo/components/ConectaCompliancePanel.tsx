import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlanningRhComplianceBatch, getPlanningRhEvidence, rhComplianceKey, type RhComplianceReport, type RhComplianceRequest, type RhMissionComplianceItem } from '../../../api/efetivoPlanning';
import { Alert, Badge, Button, type SemanticTone } from '../../../components/ui/ds';
import { displayDateOnly } from '../../../utils/calendarGrid';
import './ConectaCompliancePanel.css';

const labels: Record<string, string> = { VALID: 'Válido', EXPIRED: 'Vencido', REVOKED: 'Revogado', PENDING: 'Pendente', UNKNOWN: 'Validade desconhecida' };
const categories: Record<string, string> = { DOCUMENT: 'Documentos', EXAM: 'Exames', TRAINING: 'Treinamentos', CERTIFICATE: 'Certificados' };
const tone = (status: string): SemanticTone => status === 'VALID' ? 'success' : ['EXPIRED', 'REVOKED'].includes(status) ? 'danger' : 'warning';
const validPeriod = ({ date, endDate }: RhComplianceRequest) => /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && date <= endDate;
type BatchState = { reports: RhComplianceReport[]; loading: boolean; error: boolean; refresh: () => void };
const ComplianceContext = createContext<BatchState | null>(null);

function useComplianceBatch(requests: RhComplianceRequest[], enabled: boolean) {
  const normalized = [...new Map(requests.filter(validPeriod).map(request => [rhComplianceKey(request), request])).entries()]
    .sort(([left], [right]) => left.localeCompare(right)).map(([, request]) => request);
  const query = useQuery({
    queryKey: ['efetivo-conecta-compliance', normalized], queryFn: () => getPlanningRhComplianceBatch(normalized),
    enabled: enabled && normalized.length > 0, staleTime: 30_000, refetchInterval: 60_000, retry: 1
  });
  return { reports: query.data || [], loading: query.isPending, error: query.isError, refresh: () => { void query.refetch(); } };
}

export function ConectaComplianceProvider({ requests, enabled = true, children }: { requests: RhComplianceRequest[]; enabled?: boolean; children: ReactNode }) {
  const state = useComplianceBatch(requests, enabled);
  return <ComplianceContext.Provider value={state}>{children}</ComplianceContext.Provider>;
}

function EvidenceButton({ collaboratorId, item, onRefresh }: { collaboratorId: string; item: RhMissionComplianceItem; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    setError(''); setLoading(true);
    const tab = window.open('about:blank', '_blank');
    if (tab) {
      tab.opener = null;
      tab.document.title = 'Abrindo comprovante…';
      const policy = tab.document.createElement('meta'); policy.name = 'referrer'; policy.content = 'no-referrer'; tab.document.head.append(policy);
    }
    try {
      const result = await getPlanningRhEvidence(collaboratorId, item);
      if (!tab || tab.closed) throw new Error('Permita a abertura de uma nova guia para consultar o comprovante.');
      tab.location.replace(result.url);
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o comprovante.');
      onRefresh();
    } finally { setLoading(false); }
  };
  return <div className="conecta-rh-evidence"><Button type="button" variant="secondary" size="sm" disabled={loading} onClick={() => { void open(); }}>{loading ? 'Abrindo…' : 'Ver comprovante'}</Button>{error ? <p role="alert">{error}</p> : null}</div>;
}

function ComplianceContent({ request, state, compact }: { request: RhComplianceRequest; state: BatchState; compact: boolean }) {
  const report = state.reports.find(report => rhComplianceKey(report) === rhComplianceKey(request));
  const [expanded, setExpanded] = useState(!compact);
  if (!validPeriod(request)) return <p className="conecta-rh-note">Informe o período de mobilização para conferir a documentação do RH.</p>;
  const items = report?.items || [];
  const valid = items.filter(item => item.status === 'VALID').length;
  const warnings = items.filter(item => item.status !== 'VALID' || item.expiresDuringMission).length;
  const stale = Boolean(report && report.sync.status !== 'OK');
  const emptyLabel = report?.state === 'UNMAPPED' ? 'Sem vínculo com CONECTA' : report?.state === 'NOT_CONFIGURED' ? 'Integração não configurada' : 'Sem dados publicados';
  const summary = state.loading ? 'Consultando…' : state.error ? 'Consulta indisponível' : !items.length ? emptyLabel : `${valid}/${items.length} válidos${warnings || stale ? ' · Requer conferência' : ''}`;
  const body = <div className="conecta-rh-body">
    <p className="conecta-rh-note">CONECTA · Conferência de {displayDateOnly(request.date)} a {displayDateOnly(request.endDate)}.</p>
    {state.loading ? <p role="status">Consultando documentação do RH…</p> : state.error || !report
      ? <Alert tone="warning" action={{ label: 'Tentar novamente', onClick: state.refresh }}>Não foi possível consultar a documentação do RH.</Alert>
      : <>
        {report.sync.status !== 'OK' && report.state !== 'NOT_CONFIGURED' ? <Alert tone="warning">{report.sync.status === 'ERROR' ? 'A última sincronização falhou.' : report.sync.status === 'STALE' ? 'A sincronização do RH está atrasada.' : 'A sincronização do RH ainda não foi confirmada.'} Confira os dados com o responsável.</Alert> : null}
        {report.state === 'NOT_CONFIGURED' ? <p>A integração de RH ainda não está configurada.</p> : report.state === 'UNMAPPED' ? <p>Este colaborador ainda não está vinculado ao CONECTA.</p> : report.state === 'EMPTY' ? <p>Nenhum documento ou treinamento foi publicado pelo RH para este colaborador.</p> : null}
        {Object.entries(categories).map(([category, label]) => {
          const group = items.filter(item => item.category === category);
          return group.length ? <section className="conecta-rh-group" key={category}><h4>{label}</h4><ul>{group.map(item => <li key={item.id}>
            <div className="conecta-rh-item-heading"><strong>{item.title}</strong><Badge tone={tone(item.status)}>{labels[item.status] || item.status}</Badge></div>
            <p>{item.issuedOn ? `Emissão: ${displayDateOnly(item.issuedOn)} · ` : ''}{item.hasNoExpiry ? 'Sem vencimento' : item.expiresOn ? `Validade: ${displayDateOnly(item.expiresOn)}` : 'Validade não informada'}</p>
            {item.expiresDuringMission ? <p className="conecta-rh-expiry">Vence durante a participação na missão.</p> : null}
            {item.evidence ? <EvidenceButton collaboratorId={request.collaboratorId} item={item} onRefresh={state.refresh} /> : <small>{['ASO', 'TOXICOLOGICO'].includes(item.typeCode.toUpperCase()) ? 'Consulta da situação de conformidade.' : 'Comprovante não publicado pelo RH.'}</small>}
          </li>)}</ul></section> : null;
        })}
        {report.sync.lastSuccessfulAt ? <p className="conecta-rh-note">Última sincronização: {new Date(report.sync.lastSuccessfulAt).toLocaleString('pt-BR')}.</p> : null}
      </>}
  </div>;
  return compact ? <details className="conecta-rh conecta-rh-compact" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span className="conecta-rh-summary-label">Documentação do RH<small>{displayDateOnly(request.date)} a {displayDateOnly(request.endDate)}</small></span><Badge tone={state.error || warnings || stale ? 'warning' : 'neutral'}>{summary}</Badge></summary>
    {expanded ? body : null}
  </details> : <section className="page-card conecta-rh" aria-label="Conformidade do RH"><h3>Documentação do RH</h3>{body}</section>;
}

function StandaloneCompliance({ request, compact }: { request: RhComplianceRequest; compact: boolean }) {
  const state = useComplianceBatch([request], true);
  return <ComplianceContent request={request} compact={compact} state={state} />;
}

export function ConectaCompliancePanel({ collaboratorId, date, endDate = date, compact = false }: { collaboratorId: string; date: string; endDate?: string; compact?: boolean }) {
  const state = useContext(ComplianceContext);
  const request = { collaboratorId, date, endDate };
  return state ? <ComplianceContent request={request} compact={compact} state={state} /> : <StandaloneCompliance request={request} compact={compact} />;
}
