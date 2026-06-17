import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { UNIT_SYSTEMKEY_PREFIX, legacyUnitCategory } from '../../lib/equipment-categories.js';
import { listManometersCompat, listParticleCountersCompat, listRdoEquipments, listUnitsCompat } from '../../lib/equipment-compat.js';
import { resolveRdoSlotMap } from '../../lib/rdo-equipment-slots.js';
import { seedInhibitionOptions } from '../../lib/inhibition-options.js';
import prisma from '../../lib/prisma.js';
import {
  collaboratorsCache,
  companyEquipmentCache,
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
    equipments,
    rdoSlots,
    inhibitionOptions,
    drafts
  ] = await Promise.all([
    prisma.project.findMany({
      where: await projectListWhereForAuth(auth, 'true', prisma, { includeRegistrationPending: false }),
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
    unitsCache.get(() => listUnitsCompat()),
    manometersCache.get(() => listManometersCompat()),
    particleCountersCache.get(() => listParticleCountersCompat()),
    companyEquipmentCache.get(() => listRdoEquipments()),
    resolveRdoSlotMap(),
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
    manometers,
    counters,
    equipments,
    rdoSlotMap: rdoSlots.map,
    inhibitionOptions,
    drafts: rdoDraftItems(drafts)
  };
}

router.get('/new-report', asyncHandler(async (req, res) => {
  res.json(await newReportBootstrapData(req.auth));
}));

router.get('/report-detail/:reportId', asyncHandler(async (req, res) => {
  const reportProjectWhere = await projectListWhereForAuth(req.auth, undefined, prisma, { includeRegistrationPending: false });
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
