import { Router } from 'express';
import { ReportType } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';

const router = Router();

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  clientName: z.string().min(1),
  clientCnpj: z.string().min(1),
  contractCode: z.string().min(1),
  location: z.string().min(1),
  workdayHours: z.string().min(1).default('09:00'),
  weekendWorkdayHours: z.string().min(1).default('08:00'),
  includesSaturday: z.boolean().default(false),
  includesSunday: z.boolean().default(false),
  operatorId: z.string().nullable().optional(),
  reportSequences: z.array(z.object({
    reportType: z.nativeEnum(ReportType),
    nextNumber: z.number().int().nonnegative()
  })).default([])
});

router.get('/', asyncHandler(async (_req, res) => {
  const items = await prisma.project.findMany({
    include: {
      operator: true,
      reportSequences: true
    },
    orderBy: { name: 'asc' }
  });
  res.json(items);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const { reportSequences, ...projectData } = data;
  const item = await prisma.project.create({
    data: {
      ...projectData,
      reportSequences: {
        create: reportSequences
      }
    },
    include: {
      operator: true,
      reportSequences: true
    }
  });
  res.status(201).json(item);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const { reportSequences, ...projectData } = data;

  const item = await prisma.$transaction(async tx => {
    if (reportSequences) {
      await tx.projectReportSeq.deleteMany({ where: { projectId: req.params.id } });
    }

    return tx.project.update({
      where: { id: req.params.id },
      data: {
        ...projectData,
        ...(reportSequences
          ? {
              reportSequences: {
                create: reportSequences
              }
            }
          : {})
      },
      include: {
        operator: true,
        reportSequences: true
      }
    });
  });

  res.json(item);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.project.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
