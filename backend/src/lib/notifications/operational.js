import { createHash } from 'node:crypto';

import prisma from '../prisma.js';
import { getOperationalStatus } from '../operations/status.js';

export const OPERATIONAL_NOTIFICATION_KINDS = ['SYNC_FAILED', 'BACKUP_FAILED'];
const SYNC_LABELS = {
  'omie-sync': 'Omie',
  'pontomais-sync': 'PontoMais',
  'commercial-access-import': 'Banco comercial',
  'legacy-zapsign-reconciliation': 'ZapSign'
};
const SCOPE_LABELS = {
  projects: 'projetos', purchases: 'compras', categories: 'categorias',
  receivables: 'contas a receber', invoices: 'notas fiscais'
};

function incidentKey(kind, source, run) {
  // O instante da consulta não faz parte da chave: atualizar não repete o aviso.
  const fingerprint = createHash('sha256').update(JSON.stringify(run)).digest('hex');
  return `operational:${kind}:${source}:${fingerprint}`;
}

export async function refreshOperationalNotifications({
  client = prisma,
  statusProvider = getOperationalStatus
} = {}) {
  const [status, pontoRun] = await Promise.all([
    statusProvider({ prismaClient: client }),
    client.pontoSyncRun.findFirst({ orderBy: { startedAt: 'desc' } })
  ]);
  const candidates = [];
  for (const issue of status.problems) {
    if (issue.backup) {
      const backup = issue.backup;
      candidates.push({
        kind: 'BACKUP_FAILED',
        dedupeKey: incidentKey('BACKUP_FAILED', 'backup', [backup.status, backup.startedAt, backup.finishedAt, backup.runDir]),
        data: { title: backup.status === 'FAILURE' ? 'Falha no backup' : 'Atenção ao backup', description: issue.message }
      });
      continue;
    }
    if (!SYNC_LABELS[issue.job]) continue;
    // A execução de sincronização registra falhas manuais e automáticas.
    // O job agendador pode continuar concluído mesmo quando uma janela falha.
    if (issue.job === 'pontomais-sync' && pontoRun?.status === 'FAILED') continue;
    const run = issue.job === 'omie-sync'
      ? status.omie.scopes.find(item => item.scope === issue.scope)?.latestRun || status.omie.latestRun
      : issue.job === 'commercial-access-import'
        ? status.commercialImport.latestImport
        : status.jobs.recurring.find(item => item.name === issue.job)?.latestRun;
    const scope = issue.scope ? ` · ${SCOPE_LABELS[issue.scope] || issue.scope}` : '';
    candidates.push({
      kind: 'SYNC_FAILED',
      dedupeKey: incidentKey('SYNC_FAILED', `${issue.job}:${issue.scope || ''}`, [run?.id, run?.status, issue.message]),
      data: { title: `Falha de sincronização · ${SYNC_LABELS[issue.job]}${scope}`, description: issue.message }
    });
  }
  if (pontoRun?.status === 'FAILED') {
    candidates.push({
      kind: 'SYNC_FAILED',
      dedupeKey: incidentKey('SYNC_FAILED', 'pontomais-sync', pontoRun.id),
      data: { title: 'Falha de sincronização · PontoMais', description: pontoRun.errorMessage || 'A última sincronização com o PontoMais falhou.' }
    });
  }
  const events = await Promise.all(candidates.map(candidate => client.notificationEvent.upsert({
    where: { dedupeKey: candidate.dedupeKey }, create: candidate, update: {}, select: { id: true, kind: true }
  })));
  return events.filter(event => event.kind === 'BACKUP_FAILED').map(event => event.id);
}
