import { Router } from 'express';

import asyncHandler from '../lib/async-handler.js';
import { loadCorporateCalendar } from '../lib/calendar/corporate-calendar.js';
import {
  checkWorkforceAvailability,
  createWorkforceAbsence,
  deleteWorkforceAbsence,
  listWorkforceAbsences,
  updateWorkforceAbsence
} from '../lib/collaborators/availability-service.js';
import { canViewEfetivo, requireEfetivoManager, requireEfetivoViewer } from '../lib/efetivo/access.js';
import { hasModuleRole } from '../lib/module-roles.js';
import prisma from '../lib/prisma.js';
import {
  parseIfMatchVersion,
  workforceAbsenceQuerySchema,
  workforceAbsenceInputSchema,
  workforceAbsenceUpdateSchema,
  workforceAvailabilityInputSchema,
  workforceCalendarQuerySchema
} from '../lib/workforce/schemas.js';
import { ACOMPANHAMENTO_ACCESS_ROLES, RDO_INTERNAL_ROLES, requireAuth } from '../middleware/auth.js';

const router = Router();

function actorContext(req) {
  return { actorUserId: req.auth?.user?.id || null };
}

function absenceDto(absence) {
  if (!absence) return absence;
  return {
    ...absence,
    collaborator: absence.collaborator
      ? { ...absence.collaborator, role: absence.collaborator.jobRole?.name || '' }
      : absence.collaborator
  };
}

export function requireWorkforceRead(req, res, next) {
  const user = req.auth?.user;
  if (!user || (
    user.accountType !== 'ADMIN'
    && !canViewEfetivo(user)
    && !hasModuleRole(user, RDO_INTERNAL_ROLES)
    && !hasModuleRole(user, ACOMPANHAMENTO_ACCESS_ROLES)
  )) {
    return res.status(403).json({ error: 'Acesso restrito aos módulos operacionais autorizados.' });
  }
  next();
}

router.use(requireAuth);

router.get('/calendar', requireWorkforceRead, asyncHandler(async (req, res) => {
  const query = workforceCalendarQuerySchema.parse(req.query);
  const collaboratorIds = Array.isArray(query.collaboratorId)
    ? query.collaboratorId
    : query.collaboratorId ? [query.collaboratorId] : [];
  const [calendar, absences] = await Promise.all([
    loadCorporateCalendar(prisma, query.from, query.to),
    listWorkforceAbsences(prisma, {
      startDate: query.from,
      endDate: query.to,
      ...(collaboratorIds.length === 1 ? { collaboratorId: collaboratorIds[0] } : {})
    })
  ]);
  const filteredAbsences = collaboratorIds.length > 1
    ? absences.filter(item => collaboratorIds.includes(item.collaboratorId))
    : absences;
  res.json({ revision: calendar.revision, holidays: calendar.holidays, absences: filteredAbsences.map(absenceDto) });
}));

router.post('/availability/check', requireWorkforceRead, asyncHandler(async (req, res) => {
  res.json(await checkWorkforceAvailability(prisma, workforceAvailabilityInputSchema.parse(req.body)));
}));

router.get('/absences', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const query = workforceAbsenceQuerySchema.parse({
    from: req.query.from,
    to: req.query.to,
    collaboratorId: req.query.collaboratorId
  });
  const items = await listWorkforceAbsences(prisma, {
    collaboratorId: Array.isArray(query.collaboratorId) ? query.collaboratorId[0] : query.collaboratorId,
    startDate: query.from,
    endDate: query.to
  });
  res.json(items.map(absenceDto));
}));

router.post('/absences', requireEfetivoManager, asyncHandler(async (req, res) => {
  const result = await createWorkforceAbsence(prisma, workforceAbsenceInputSchema.parse(req.body), actorContext(req));
  res.status(201).json({ ...result, absence: absenceDto(result.absence) });
}));

router.patch('/absences/:absenceId', requireEfetivoManager, asyncHandler(async (req, res) => {
  const expectedVersion = parseIfMatchVersion(req.get('If-Match-Version'));
  if (!expectedVersion) return res.status(428).json({ error: 'Informe If-Match-Version com a versão atual.' });
  const result = await updateWorkforceAbsence(
    prisma,
    req.params.absenceId,
    workforceAbsenceUpdateSchema.parse(req.body),
    { ...actorContext(req), expectedVersion }
  );
  res.json({ ...result, absence: absenceDto(result.absence) });
}));

router.delete('/absences/:absenceId', requireEfetivoManager, asyncHandler(async (req, res) => {
  const expectedVersion = parseIfMatchVersion(req.get('If-Match-Version'));
  if (!expectedVersion) return res.status(428).json({ error: 'Informe If-Match-Version com a versão atual.' });
  await deleteWorkforceAbsence(prisma, req.params.absenceId, { ...actorContext(req), expectedVersion });
  res.status(204).end();
}));

export default router;
