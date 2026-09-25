import prisma from '../prisma.js';
import { isRealizedSourceReport, isServiceFinalized, loadReportServicesByProject } from './avanco.js';
import { CORRECTABLE_TUBE_SERVICES, dailyTubeSourceTotals, latestRealizedCorrections, realizedCorrectionKey } from './realized-corrections.js';
import { normalizeRdoServiceType } from './service-types.js';

function correctionError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function assertProject(client, projectId) {
  const project = await client.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
  if (!project) throw correctionError('Projeto não encontrado.', 404);
}

function validateGlobalTubeScope(planned, serviceType) {
  const rows = planned.filter(service => normalizeRdoServiceType(service.serviceType) === serviceType)
    .flatMap(service => service.systems ?? []).filter(row => row.systemType === 'TUBULACAO');
  if (!rows.length || !rows.some(row => !row.projectSystemId && Number(row.quantity) > 0)) {
    throw correctionError('A correção exige uma meta global de tubulação para este serviço.');
  }
  if (rows.some(row => row.projectSystemId)) {
    throw correctionError('Este serviço possui metas por sistema. Concilie cada sistema antes de corrigir a metragem global.');
  }
}

export async function listRealizedCorrections(projectId) {
  await assertProject(prisma, projectId);
  const [servicesByProject, revisions] = await Promise.all([
    loadReportServicesByProject([projectId], { applyCorrections: false }),
    prisma.projectRealizedCorrection.findMany({
      where: { projectId }, orderBy: [{ measureDate: 'asc' }, { serviceType: 'asc' }, { revision: 'asc' }]
    })
  ]);
  const source = dailyTubeSourceTotals(servicesByProject.get(projectId) ?? [],
    service => isServiceFinalized(service) && isRealizedSourceReport(service));
  const latest = latestRealizedCorrections(revisions);
  const keys = new Set([...source.keys(), ...latest.keys()]);
  const rows = [...keys].sort().map(key => {
    const current = latest.get(key);
    const [date, serviceType] = key.split(':');
    const sourceMeters = Math.round((source.get(key) ?? 0) * 100) / 100;
    const correctedMeters = current?.quantityM == null ? null : Number(current.quantityM);
    return { date, serviceType, sourceMeters, correctedMeters,
      effectiveMeters: correctedMeters ?? sourceMeters,
      sourceChanged: current ? Math.abs(sourceMeters - Number(current.sourceQuantityM)) >= 0.005 : false,
      revision: current?.revision ?? 0, reason: current?.reason ?? null,
      reference: current?.reference ?? null, createdAt: current?.createdAt ?? null,
      createdByUserId: current?.createdByUserId ?? null,
      history: revisions.filter(row => realizedCorrectionKey(row.measureDate, row.serviceType) === key)
        .map(row => ({ revision: row.revision, sourceQuantityM: Number(row.sourceQuantityM), quantityM: row.quantityM == null ? null : Number(row.quantityM),
          reason: row.reason, reference: row.reference, createdAt: row.createdAt, createdByUserId: row.createdByUserId })) };
  });
  return { rows };
}

export async function saveRealizedCorrection(projectId, { date, serviceType, quantityM, reason, reference = null, expectedRevision, expectedSourceMeters }, userId) {
  if (!CORRECTABLE_TUBE_SERVICES.includes(serviceType)) throw correctionError('Serviço inválido para correção de tubulação.');
  const measureDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(measureDate.getTime()) || measureDate.toISOString().slice(0, 10) !== date) throw correctionError('Data inválida.');
  const source = (await listRealizedCorrections(projectId)).rows.find(row => row.date === date && row.serviceType === serviceType)?.sourceMeters ?? 0;
  if (Math.abs(source - expectedSourceMeters) >= 0.005) throw correctionError('O RDO mudou. Atualize a lista antes de salvar.', 409);
  try {
    return await prisma.$transaction(async tx => {
      await assertProject(tx, projectId);
      const planned = await tx.projectPlannedService.findMany({ where: { projectId }, include: { systems: true } });
      validateGlobalTubeScope(planned, serviceType);
      const previous = await tx.projectRealizedCorrection.findFirst({
        where: { projectId, measureDate, serviceType }, orderBy: { revision: 'desc' }
      });
      const revision = previous?.revision ?? 0;
      if (revision !== expectedRevision) throw correctionError('A correção mudou. Atualize a lista antes de salvar.', 409);
      const next = await tx.projectRealizedCorrection.create({ data: {
        projectId, measureDate, serviceType, revision: revision + 1,
        sourceQuantityM: source, quantityM, reason, reference: reference || null, createdByUserId: userId
      } });
      return { date, serviceType, revision: next.revision, correctedMeters: quantityM };
    }, { isolationLevel: 'Serializable', timeout: 20000 });
  } catch (error) {
    if (['P2002', 'P2034'].includes(error.code)) throw correctionError('A correção mudou. Atualize a lista antes de salvar.', 409);
    throw error;
  }
}
