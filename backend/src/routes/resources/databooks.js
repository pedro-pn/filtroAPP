import fs from 'node:fs/promises';
import { Router } from 'express';
import sharp from 'sharp';
import { z } from 'zod';
import { makeDatabookSchemas } from '../../../../shared/schemas/databooks.js';
import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { inlineContentDisposition } from '../../lib/equipment-attachments.js';
import { resolvePublicStockAttachment } from '../../lib/estoque/stock-attachments.js';
import { resolveStoredUploadPath } from '../../lib/stored-image.js';
import { databookDate, databookError, databookPeriodWhere } from '../../lib/databooks/policy.js';
import { loadDatabookSources, publicDatabookSources, reportPhotos, reportSourceInclude } from '../../lib/databooks/sources.js';
import { authorizeDatabookProject, createDatabook, retryDatabook, resolveDatabookDownload, serializeDatabook } from '../../lib/databooks/service.js';

const router = Router({ mergeParams: true });
const schemas = makeDatabookSchemas(z);
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { project, permissions } = await authorizeDatabookProject(prisma, req.params.projectId, req.auth.user);
  const [records, period] = await Promise.all([
    prisma.projectDatabook.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' } }),
    prisma.report.aggregate({ where: { projectId: project.id, deletedAt: null,
      reportType: { in: ['RDO', 'RDO_MAINTENANCE', 'RDO_PRODUCTION'] } }, _min: { reportDate: true }, _max: { reportDate: true } })
  ]);
  res.set('Cache-Control', 'private, no-store').json({ project: { id: project.id, code: project.code, name: project.name }, permissions,
    defaults: { startDate: databookDate(period._min.reportDate), endDate: databookDate(period._max.reportDate) },
    items: records.map(serializeDatabook) });
}));

router.get('/sources', asyncHandler(async (req, res) => {
  const period = schemas.period.parse(req.query);
  const { project } = await authorizeDatabookProject(prisma, req.params.projectId, req.auth.user);
  const sources = await loadDatabookSources(prisma, project, period);
  res.set('Cache-Control', 'private, no-store').json(publicDatabookSources(sources));
}));

router.get('/photos/:key', asyncHandler(async (req, res) => {
  const { reportId, ...periodInput } = z.object({ reportId: z.string().min(1).max(160) }).passthrough().parse(req.query);
  const period = schemas.period.parse(periodInput);
  const { project } = await authorizeDatabookProject(prisma, req.params.projectId, req.auth.user);
  const report = await prisma.report.findFirst({ where: { id: reportId, projectId: project.id, deletedAt: null,
    reportDate: databookPeriodWhere(period.startDate, period.endDate) }, include: reportSourceInclude });
  const photo = report && reportPhotos(report, project).find(item => item.key === req.params.key);
  const target = photo && resolveStoredUploadPath(photo.storagePath);
  if (!target) throw databookError('Foto não encontrada neste projeto/período.', 404);
  const bytes = await sharp(target).rotate().resize({ width: 480, height: 360, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
  res.set('Cache-Control', 'private, no-store').type('image/jpeg').send(bytes);
}));

router.get('/stock-documents/:id', asyncHandler(async (req, res) => {
  await authorizeDatabookProject(prisma, req.params.projectId, req.auth.user);
  const document = await prisma.stockItemDocument.findFirst({ where: { id: req.params.id,
    item: { type: 'PRODUTO_QUIMICO', movements: { some: { projectId: req.params.projectId,
      type: 'SAIDA', reason: 'USO_EM_PROJETO', reversalOfId: null, reversedBy: { is: null } } } } } });
  const resolved = document && await resolvePublicStockAttachment(document.publicToken, prisma);
  if (!resolved) throw databookError('Documento não encontrado para os produtos deste projeto.', 404);
  res.set('Cache-Control', 'private, no-store').set('Content-Disposition', inlineContentDisposition(document.fileName)).type('application/pdf').send(await fs.readFile(resolved.targetPath));
}));

router.post('/', asyncHandler(async (req, res) => {
  const input = schemas.create.parse(req.body);
  const record = await createDatabook(prisma, req.params.projectId, input, req.auth.user);
  res.status(202).json(serializeDatabook(record));
}));

router.post('/:id/retry', asyncHandler(async (req, res) => {
  schemas.empty.parse(req.body || {});
  const record = await retryDatabook(prisma, req.params.projectId, req.params.id, req.auth.user);
  res.status(202).json(serializeDatabook(record));
}));

for (const kind of ['pdf', 'zip']) router.get(`/:id/${kind}`, asyncHandler(async (req, res) => {
  const file = await resolveDatabookDownload(prisma, req.params.projectId, req.params.id, kind, req.auth.user);
  res.set('Cache-Control', 'private, no-store').set('Content-Disposition', inlineContentDisposition(file.fileName).replace(/^inline;/, 'attachment;')).type(file.mimeType).send(file.buffer);
}));

export default router;
