import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { currentCalibrationCertificateInclude, withCurrentCalibrationCertificate } from '../../lib/calibration-certificates.js';
import { seedInhibitionOptions } from '../../lib/inhibition-options.js';
import prisma from '../../lib/prisma.js';
import {
  collaboratorsCache,
  equipmentCache,
  inhibitionOptionsCache,
  manometersCache,
  particleCountersCache,
  unitCategoriesCache,
  unitsCache
} from '../../lib/resource-list-cache.js';
import { ensureCollaboratorSignatureDataUrl } from '../../lib/signature-image.js';
import { safeSurvey } from '../../lib/survey-mail.js';
import { RDO_INTERNAL_ROLES, requireAuth, requireModuleRole } from '../../middleware/auth.js';
import { rdoDraftItems } from './drafts.js';
import { projectListInclude, projectListWhereForAuth } from './projects.js';
import { activeSurveyQuestions, safeQuestion } from './surveys.js';

const router = Router();
const requireRdoInternal = requireModuleRole(...RDO_INTERNAL_ROLES);
const requireRdoManager = requireModuleRole('rdo:manager');

router.use(requireAuth, requireRdoInternal);

async function newReportBootstrapData(auth) {
  const [
    projects,
    collaborators,
    units,
    manometers,
    counters,
    inhibitionOptions,
    drafts
  ] = await Promise.all([
    prisma.project.findMany({
      where: await projectListWhereForAuth(auth, 'true'),
      include: projectListInclude,
      orderBy: { name: 'asc' }
    }),
    collaboratorsCache.get(async () => {
      const items = await prisma.collaborator.findMany({ orderBy: { name: 'asc' } });
      const result = [];
      for (const item of items) {
        result.push(await ensureCollaboratorSignatureDataUrl(prisma, item));
      }
      return result;
    }),
    unitsCache.get(() => prisma.unit.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { code: 'asc' }]
    })),
    manometersCache.get(() => prisma.manometer.findMany({
      orderBy: { code: 'asc' },
      include: currentCalibrationCertificateInclude
    })),
    particleCountersCache.get(() => prisma.particleCounter.findMany({
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
      include: currentCalibrationCertificateInclude
    })),
    inhibitionOptionsCache.get(async () => {
      await seedInhibitionOptions(prisma);
      const [vessels, systems] = await Promise.all([
        prisma.inhibitionVessel.findMany({
          where: { isActive: true },
          orderBy: [{ order: 'asc' }, { code: 'asc' }]
        }),
        prisma.inhibitionSystem.findMany({
          where: { isActive: true },
          orderBy: [{ order: 'asc' }, { code: 'asc' }]
        })
      ]);
      return { vessels, systems };
    }),
    prisma.reportDraft.findMany({
      where: { userId: auth.user.id },
      include: { project: true },
      orderBy: { updatedAt: 'desc' }
    })
  ]);

  return {
    projects,
    collaborators,
    units,
    manometers: manometers.map(withCurrentCalibrationCertificate),
    counters: counters.map(withCurrentCalibrationCertificate),
    inhibitionOptions,
    drafts: rdoDraftItems(drafts)
  };
}

router.get('/new-report', asyncHandler(async (req, res) => {
  res.json(await newReportBootstrapData(req.auth));
}));

router.get('/report-detail/:reportId', asyncHandler(async (req, res) => {
  const reportProjectWhere = await projectListWhereForAuth(req.auth, undefined);
  const [data, equipment, sequenceReports] = await Promise.all([
    newReportBootstrapData(req.auth),
    equipmentCache.get(() => prisma.equipment.findMany({ orderBy: { name: 'asc' } })),
    prisma.report.findMany({
      where: {
        deletedAt: null,
        project: reportProjectWhere
      },
      select: {
        id: true,
        projectId: true,
        reportType: true,
        sequenceNumber: true
      }
    })
  ]);

  res.json({
    ...data,
    equipment,
    sequenceReports
  });
}));

router.get('/gestor', requireRdoManager, asyncHandler(async (req, res) => {
  const [
    activeProjects,
    archivedProjects,
    collaborators,
    units,
    unitCategories,
    manometers,
    counters,
    surveys,
    projectSegments,
    surveyQuestions
  ] = await Promise.all([
    prisma.project.findMany({
      where: await projectListWhereForAuth(req.auth, 'true'),
      include: projectListInclude,
      orderBy: { name: 'asc' }
    }),
    prisma.project.findMany({
      where: await projectListWhereForAuth(req.auth, 'false'),
      include: projectListInclude,
      orderBy: { name: 'asc' }
    }),
    collaboratorsCache.get(async () => {
      const items = await prisma.collaborator.findMany({ orderBy: { name: 'asc' } });
      const result = [];
      for (const item of items) {
        result.push(await ensureCollaboratorSignatureDataUrl(prisma, item));
      }
      return result;
    }),
    unitsCache.get(() => prisma.unit.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { code: 'asc' }]
    })),
    unitCategoriesCache.get(async () => {
      const [unitRows, romaneioRows] = await Promise.all([
        prisma.unit.findMany({
          distinct: ['category'],
          select: { category: true },
          orderBy: { category: 'asc' }
        }),
        prisma.romaneioCatalogItem.findMany({
          distinct: ['categoryName'],
          where: { isActive: true },
          select: { categoryName: true },
          orderBy: { categoryName: 'asc' }
        })
      ]);
      return Array.from(new Set([
        ...unitRows.map(item => item.category),
        ...romaneioRows.map(item => item.categoryName)
      ].map(item => String(item || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    }),
    manometersCache.get(() => prisma.manometer.findMany({
      orderBy: { code: 'asc' },
      include: currentCalibrationCertificateInclude
    })),
    particleCountersCache.get(() => prisma.particleCounter.findMany({
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
      include: currentCalibrationCertificateInclude
    })),
    prisma.satisfactionSurvey.findMany({
      include: { project: true },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.clientSegment.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { label: 'asc' }]
    }),
    activeSurveyQuestions()
  ]);

  res.json({
    activeProjects,
    archivedProjects,
    collaborators,
    units,
    unitCategories,
    manometers: manometers.map(withCurrentCalibrationCertificate),
    counters: counters.map(withCurrentCalibrationCertificate),
    surveys: surveys.map(item => ({
      ...safeSurvey(item),
      responses: item.responses,
      project: item.project ? {
        id: item.project.id,
        code: item.project.code,
        name: item.project.name,
        clientName: item.project.clientName,
        isActive: item.project.isActive
      } : null
    })),
    projectSegments,
    surveyQuestions: surveyQuestions.map(safeQuestion)
  });
}));

export default router;
