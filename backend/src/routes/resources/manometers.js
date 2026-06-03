import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import {
  createCalibrationCertificate,
  currentCalibrationCertificateInclude,
  withCurrentCalibrationCertificate
} from '../../lib/calibration-certificates.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const dateField = z.string().min(1);

const schema = z.object({
  code: z.string().min(1),
  scale: z.string().min(1),
  calibrationCertCode: z.string().min(1),
  calibratedAt: dateField,
  expiresAt: dateField,
  calibrationCertificate: z.object({
    fileName: z.string().min(1),
    mimeType: z.string().optional(),
    dataUrl: z.string().min(1)
  }).optional().nullable()
});

router.get('/', requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await prisma.manometer.findMany({
    orderBy: { code: 'asc' },
    include: currentCalibrationCertificateInclude
  });
  res.json(items.map(withCurrentCalibrationCertificate));
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const { calibrationCertificate, ...fields } = data;
  const existing = await prisma.manometer.findUnique({ where: { code: data.code } });
  if (existing && !existing.isActive) {
    const item = await prisma.manometer.update({
      where: { id: existing.id },
      data: { ...fields, isActive: true, calibratedAt: new Date(fields.calibratedAt), expiresAt: new Date(fields.expiresAt) }
    });
    await createCalibrationCertificate(prisma, {
      equipmentType: 'MANOMETER',
      manometerId: item.id,
      upload: calibrationCertificate
    });
    const freshItem = await prisma.manometer.findUnique({
      where: { id: item.id },
      include: currentCalibrationCertificateInclude
    });
    return res.status(200).json(withCurrentCalibrationCertificate(freshItem));
  }
  const item = await prisma.manometer.create({
    data: { ...fields, calibratedAt: new Date(fields.calibratedAt), expiresAt: new Date(fields.expiresAt) }
  });
  await createCalibrationCertificate(prisma, {
    equipmentType: 'MANOMETER',
    manometerId: item.id,
    upload: calibrationCertificate
  });
  const freshItem = await prisma.manometer.findUnique({
    where: { id: item.id },
    include: currentCalibrationCertificateInclude
  });
  res.status(201).json(withCurrentCalibrationCertificate(freshItem));
}));

router.put('/:id', requireManager, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const { calibrationCertificate, ...fields } = data;
  const payload = {
    ...fields,
    ...(fields.calibratedAt ? { calibratedAt: new Date(fields.calibratedAt) } : {}),
    ...(fields.expiresAt ? { expiresAt: new Date(fields.expiresAt) } : {})
  };
  const item = await prisma.manometer.update({ where: { id: req.params.id }, data: payload });
  await createCalibrationCertificate(prisma, {
    equipmentType: 'MANOMETER',
    manometerId: item.id,
    upload: calibrationCertificate
  });
  const freshItem = await prisma.manometer.findUnique({
    where: { id: item.id },
    include: currentCalibrationCertificateInclude
  });
  res.json(withCurrentCalibrationCertificate(freshItem));
}));

router.delete('/:id', requireManager, asyncHandler(async (req, res) => {
  await prisma.manometer.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.status(204).end();
}));

export default router;
