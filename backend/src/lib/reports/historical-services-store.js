import { createHash } from 'node:crypto';
import {
  buildHistoricalPreview, historicalError, historicalReportKey,
  parseHistoricalServicesCsv, sourceReportConflict, historicalReportsAsServices
} from './historical-services.js';

export const historicalSourceSelect = {
  id: true, projectId: true, reportType: true, sequenceNumber: true,
  reportDate: true, specialConditions: true,
  services: { select: { id: true } }
};

export async function assertHistoricalProject(client, projectId) {
  const project = await client.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
  if (!project) throw historicalError('Projeto não encontrado.', 404);
}

async function previewWithClient(client, projectId, parsed) {
  const identities = parsed.reports.map(({ reportType, sequenceNumber }) => ({ reportType, sequenceNumber }));
  if (!identities.length) return buildHistoricalPreview(parsed, [], []);
  const [existing, sources] = await Promise.all([
    client.historicalServiceReport.findMany({ where: { projectId, OR: identities } }),
    client.report.findMany({ where: { projectId, deletedAt: null, OR: identities }, select: historicalSourceSelect })
  ]);
  const preview = buildHistoricalPreview(parsed, existing, sources);
  return { ...preview, token: createHash('sha256').update(`${projectId}:${preview.token}`).digest('hex') };
}

export async function previewHistoricalImport(client, projectId, csv) {
  await assertHistoricalProject(client, projectId);
  return previewWithClient(client, projectId, parseHistoricalServicesCsv(csv));
}

export async function commitHistoricalImport(client, { projectId, csv, token, fileName, userId }) {
  const parsed = parseHistoricalServicesCsv(csv);
  return client.$transaction(async tx => {
    await assertHistoricalProject(tx, projectId);
    const preview = await previewWithClient(tx, projectId, parsed);
    if (preview.errors.length || preview.reports.some(report => report.action === 'CONFLICT')) {
      throw historicalError('Há erros ou conflitos. Revise a prévia antes de importar.', 409);
    }
    // Re-sending an already committed batch is a successful no-op.
    if (preview.reports.every(report => report.action === 'SKIP')) return { created: 0, skipped: preview.reports.length };
    if (!token || token !== preview.token) throw historicalError('Os dados mudaram desde a prévia. Gere uma nova prévia.', 409);
    let created = 0;
    for (const report of preview.reports.filter(report => report.action === 'CREATE')) {
      await tx.historicalServiceReport.create({ data: {
        projectId, reportType: report.reportType, sequenceNumber: report.sequenceNumber,
        reportDate: new Date(`${report.reportDate}T00:00:00.000Z`), items: report.items,
        fingerprint: report.fingerprint, sourceFileName: fileName || null,
        createdByUserId: userId, updatedByUserId: userId
      } });
      created++;
    }
    return { created, skipped: preview.reports.length - created };
  }, { isolationLevel: 'Serializable', timeout: 20000 });
}

export async function listHistoricalReports(client, projectId) {
  await assertHistoricalProject(client, projectId);
  const [reports, sources] = await Promise.all([
    client.historicalServiceReport.findMany({ where: { projectId }, orderBy: [{ reportDate: 'desc' }, { reportType: 'asc' }, { sequenceNumber: 'asc' }] }),
    client.report.findMany({ where: { projectId, deletedAt: null, reportType: { in: ['RLQ', 'RTP', 'RCPU'] } }, select: historicalSourceSelect })
  ]);
  const sourceMap = new Map(sources.map(source => [historicalReportKey(source), source]));
  return reports.map(report => {
    const source = sourceMap.get(historicalReportKey(report));
    return {
      ...report, sourceReportId: source?.id ?? null,
      sourceConflict: sourceReportConflict(source, { ...report, reportDate: report.reportDate.toISOString().slice(0, 10) })
    };
  });
}

export async function updateHistoricalReport(client, { projectId, id, csv, revision, userId }) {
  const parsed = parseHistoricalServicesCsv(csv);
  if (parsed.errors.length) throw historicalError(parsed.errors.map(error => `Linha ${error.line}: ${error.message}`).join(' '));
  if (parsed.reports.length !== 1) throw historicalError('Edite um relatório por vez.');
  const report = parsed.reports[0];
  return client.$transaction(async tx => {
    await assertHistoricalProject(tx, projectId);
    const current = await tx.historicalServiceReport.findFirst({ where: { id, projectId } });
    if (!current) throw historicalError('Lançamento não encontrado.', 404);
    const sources = await tx.report.findMany({
      where: { projectId, deletedAt: null, OR: [
        { reportType: current.reportType, sequenceNumber: current.sequenceNumber },
        { reportType: report.reportType, sequenceNumber: report.sequenceNumber }
      ] }, select: historicalSourceSelect
    });
    const target = sources.find(source => historicalReportKey(source) === historicalReportKey(report));
    const conflict = sourceReportConflict(target, report);
    if (conflict) throw historicalError(conflict, 409);
    const result = await tx.historicalServiceReport.updateMany({
      where: { id, projectId, revision },
      data: {
        reportType: report.reportType, sequenceNumber: report.sequenceNumber,
        reportDate: new Date(`${report.reportDate}T00:00:00.000Z`), items: report.items,
        fingerprint: report.fingerprint, updatedByUserId: userId, revision: { increment: 1 }
      }
    });
    if (result.count !== 1) throw historicalError('Este lançamento foi alterado por outra pessoa. Reabra a edição.', 409);
    return tx.historicalServiceReport.findUnique({ where: { id } });
  }, { isolationLevel: 'Serializable' });
}

export async function loadHistoricalRealizedServices(client, projectIds) {
  if (!projectIds.length) return [];
  const history = await client.historicalServiceReport.findMany({ where: { projectId: { in: projectIds }, project: { deletedAt: null } } });
  if (!history.length) return [];
  const sources = await client.report.findMany({
    where: { projectId: { in: projectIds }, deletedAt: null, reportType: { in: ['RLQ', 'RTP', 'RCPU'] } },
    select: historicalSourceSelect
  });
  return historicalReportsAsServices(history, sources);
}
