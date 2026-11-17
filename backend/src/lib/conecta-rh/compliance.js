import env from '../../config/env.js';
import { planningError } from '../efetivo/planning/errors.js';
import { complianceStatusAt } from './schema.js';

const clinical = data => ['ASO', 'TOXICOLOGICO'].includes(data.typeCode.toUpperCase());
const unavailable = () => planningError('Não foi possível consultar o comprovante no CONECTA. Tente novamente.', { statusCode: 502, code: 'RH_EVIDENCE_SOURCE_UNAVAILABLE' });

function publicItem(row, date, endDate) {
  const data = row.data;
  const status = complianceStatusAt(data, date);
  return {
    id: row.externalId, category: data.category, typeCode: data.typeCode, title: data.title,
    status, issuedOn: data.issuedOn, expiresOn: data.expiresOn, hasNoExpiry: data.hasNoExpiry,
    expiresDuringMission: status === 'VALID' && complianceStatusAt(data, endDate) === 'EXPIRED',
    revision: row.revision, sourceUpdatedAt: row.occurredAt, synchronizedAt: row.lastAttemptAt,
    evidence: data.evidence && !clinical(data) && status !== 'REVOKED'
      ? { fileName: data.evidence.fileName, contentType: data.evidence.contentType } : null
  };
}

export async function getConectaComplianceBatch(database, { collaboratorIds, date, endDate = date }, { companyId = env.conectaRhCompanyId, now = new Date() } = {}) {
  const ids = [...new Set(collaboratorIds)];
  const collaborators = await database.collaborator.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (collaborators.length !== ids.length) throw planningError('Colaborador não encontrado.', { statusCode: 404, code: 'COLLABORATOR_NOT_FOUND' });
  const [mappings, rows, lastJob, lastSuccess] = companyId ? await Promise.all([
    database.conectaRhPerson.findMany({ where: { companyId, collaboratorId: { in: ids } }, select: { collaboratorId: true, personId: true } }),
    database.conectaRhAggregate.findMany({ where: { companyId, aggregateType: 'compliance', localId: { in: ids }, status: 'APPLIED' }, orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }] }),
    database.jobRun.findFirst({ where: { name: 'conecta-rh' }, orderBy: { startedAt: 'desc' }, select: { status: true, startedAt: true } }),
    database.jobRun.findFirst({ where: { name: 'conecta-rh', status: 'COMPLETED' }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } })
  ]) : [[], [], null, null];
  const lastSuccessfulAt = lastSuccess?.finishedAt || null;
  const syncStatus = !companyId ? 'NOT_CONFIGURED' : lastJob?.status === 'FAILED' ? 'ERROR'
    : !lastSuccessfulAt ? 'UNKNOWN' : now.getTime() - lastSuccessfulAt.getTime() > 15 * 60_000 ? 'STALE' : 'OK';
  const byCollaborator = new Map(mappings.map(mapping => [mapping.collaboratorId, mapping.personId]));
  const itemsByCollaborator = new Map(ids.map(id => [id, []]));
  for (const row of rows) {
    if (byCollaborator.get(row.localId) === row.data.personId) itemsByCollaborator.get(row.localId).push(publicItem(row, date, endDate));
  }
  return {
    source: 'CONECTA', date, endDate,
    sync: { status: syncStatus, lastSuccessfulAt, lastAttemptAt: lastJob?.startedAt || null },
    collaborators: ids.map(collaboratorId => {
      const items = itemsByCollaborator.get(collaboratorId);
      return { collaboratorId, state: !companyId ? 'NOT_CONFIGURED' : !byCollaborator.has(collaboratorId) ? 'UNMAPPED' : items.length ? 'AVAILABLE' : 'EMPTY', items };
    })
  };
}

// Resolve um link novo a cada clique. O token e o caminho autenticado da origem
// nunca integram o DTO de conformidade nem a URL de navegação da aplicação.
export async function resolveConectaEvidence(database, { collaboratorId, itemId, revision }, { config = env, fetchImpl = fetch, now = new Date() } = {}) {
  const mapping = await database.conectaRhPerson.findFirst({ where: { collaboratorId, companyId: config.conectaRhCompanyId || '' } });
  const row = mapping && await database.conectaRhAggregate.findFirst({ where: {
    companyId: mapping.companyId, aggregateType: 'compliance', externalId: itemId, localId: collaboratorId, status: 'APPLIED'
  } });
  if (!row || row.data.personId !== mapping.personId) throw planningError('Comprovante não encontrado.', { statusCode: 404, code: 'RH_EVIDENCE_NOT_FOUND' });
  if (row.revision !== revision) throw planningError('A documentação foi atualizada. Atualize a consulta antes de abrir o comprovante.', { statusCode: 409, code: 'RH_DOCUMENT_UPDATED' });
  if (clinical(row.data)) throw planningError('Este exame disponibiliza somente a situação de conformidade.', { statusCode: 403, code: 'RH_CLINICAL_EVIDENCE_NOT_ALLOWED' });
  if (row.data.status === 'REVOKED') throw planningError('O comprovante foi revogado.', { statusCode: 410, code: 'RH_EVIDENCE_REVOKED' });
  const evidence = row.data.evidence;
  if (!evidence) throw planningError('O RH ainda não publicou um comprovante para este item.', { statusCode: 404, code: 'RH_EVIDENCE_NOT_PUBLISHED' });
  if (!config.conectaRhApiUrl || !config.conectaRhReadToken) throw planningError('A consulta de comprovantes do RH não está configurada.', { statusCode: 503, code: 'RH_EVIDENCE_NOT_CONFIGURED' });
  try {
    const base = new URL(config.conectaRhApiUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw unavailable();
    // O identificador e a versão vêm do agregado persistido, nunca de uma URL do cliente.
    const url = new URL(base.href.replace(/\/$/, '') + '/evidence/' + encodeURIComponent(evidence.id));
    url.searchParams.set('companyId', mapping.companyId);
    url.searchParams.set('version', evidence.version);
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${config.conectaRhReadToken}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if ([404, 410].includes(response.status)) throw planningError('O comprovante não está mais disponível. Atualize a consulta do RH.', { statusCode: response.status, code: 'RH_EVIDENCE_UNAVAILABLE' });
    if (!response.ok) throw unavailable();
    const body = await response.json();
    const download = new URL(body.url);
    const expires = new Date(body.expiresAt);
    if (body.id !== evidence.id || body.version !== evidence.version || download.protocol !== 'https:' || download.username || download.password
      || !Number.isFinite(expires.getTime()) || expires.getTime() <= now.getTime() + 5_000
      || expires.getTime() > now.getTime() + 10 * 60_000) throw unavailable();
    return { url: download.href, expiresAt: expires.toISOString(), fileName: evidence.fileName };
  } catch (error) {
    if (['RH_EVIDENCE_UNAVAILABLE', 'RH_EVIDENCE_SOURCE_UNAVAILABLE'].includes(error.code)) throw error;
    throw unavailable();
  }
}
