import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { requireAllocationReviewer } from '../../lib/efetivo/access.js';
import { getReviewMonth, getReviewPendingCount, getReviewWeek } from '../../lib/efetivo/allocation-review/read-model.js';
import {
  confirmRowsBodySchema,
  discardDaysBodySchema,
  parseIfMatchVersion,
  reopenBodySchema,
  saveDaysBodySchema,
  unconfirmRowsBodySchema,
  weekStartParamSchema,
  yearMonthParamSchema
} from '../../lib/efetivo/allocation-review/schemas.js';
import {
  AllocationReviewError,
  closeReviewWeek,
  confirmReviewRows,
  discardReviewDays,
  reopenReviewWeek,
  saveReviewDays,
  unconfirmReviewRows
} from '../../lib/efetivo/allocation-review/service.js';
import { requireAuth } from '../../middleware/auth.js';

// API da conferência semanal de alocação (feature 037, contracts/allocation-review-api.md).

export const defaultAllocationReviewServices = Object.freeze({
  getReviewWeek,
  getReviewMonth,
  getReviewPendingCount,
  saveReviewDays,
  discardReviewDays,
  confirmReviewRows,
  unconfirmReviewRows,
  closeReviewWeek,
  reopenReviewWeek
});

function invalid(res, parsed, code) {
  return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.', code });
}

function sendError(res, error) {
  if (error instanceof AllocationReviewError) {
    return res.status(error.status).json({ error: error.message, code: error.code, ...error.details });
  }
  throw error;
}

export function createAllocationReviewRouter({ authenticate = requireAuth, services = defaultAllocationReviewServices } = {}) {
  const router = Router();
  router.use(authenticate, requireAllocationReviewer);

  function weekStartOf(req, res) {
    const parsed = weekStartParamSchema.safeParse(req.params.weekStart);
    if (!parsed.success) {
      invalid(res, parsed, 'INVALID_WEEK_START');
      return null;
    }
    return parsed.data;
  }

  function versionOf(req, res) {
    const version = parseIfMatchVersion(req.get ? req.get('If-Match-Version') : req.headers['if-match-version']);
    if (version === null) {
      res.status(428).json({ error: 'Informe If-Match-Version com a versão atual da semana.', code: 'VERSION_REQUIRED' });
      return null;
    }
    return version;
  }

  function write(schema, handler) {
    return asyncHandler(async (req, res) => {
      const weekStart = weekStartOf(req, res);
      if (!weekStart) return undefined;
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) return invalid(res, parsed, 'INVALID_ALLOCATION_REVIEW');
      const expectedVersion = versionOf(req, res);
      if (expectedVersion === null) return undefined;
      try {
        return res.json(await handler({ weekStart, body: parsed.data, expectedVersion, user: req.auth?.user }));
      } catch (error) {
        return sendError(res, error);
      }
    });
  }

  router.get('/pendencias/contagem', asyncHandler(async (req, res) => {
    res.json(await services.getReviewPendingCount({}));
  }));

  router.get('/meses/:yearMonth', asyncHandler(async (req, res) => {
    const parsed = yearMonthParamSchema.safeParse(req.params.yearMonth);
    if (!parsed.success) return invalid(res, parsed, 'INVALID_YEAR_MONTH');
    return res.json(await services.getReviewMonth({ yearMonth: parsed.data, user: req.auth?.user }));
  }));

  router.get('/semanas/:weekStart', asyncHandler(async (req, res) => {
    const weekStart = weekStartOf(req, res);
    if (!weekStart) return undefined;
    return res.json(await services.getReviewWeek({ weekStart, user: req.auth?.user }));
  }));

  router.put('/semanas/:weekStart/dias', write(saveDaysBodySchema, ({ weekStart, body, expectedVersion, user }) => (
    services.saveReviewDays({ weekStart, items: body.items, expectedVersion, user })
  )));

  router.delete('/semanas/:weekStart/dias', write(discardDaysBodySchema, ({ weekStart, body, expectedVersion, user }) => (
    services.discardReviewDays({ weekStart, items: body.items, expectedVersion, user })
  )));

  router.post('/semanas/:weekStart/linhas/conferir', write(confirmRowsBodySchema, ({ weekStart, body, expectedVersion, user }) => (
    services.confirmReviewRows({
      weekStart,
      collaboratorIds: body.collaboratorIds || null,
      allReady: body.allReady === true,
      expectedVersion,
      user
    })
  )));

  router.post('/semanas/:weekStart/linhas/desconferir', write(unconfirmRowsBodySchema, ({ weekStart, body, expectedVersion, user }) => (
    services.unconfirmReviewRows({ weekStart, collaboratorIds: body.collaboratorIds, expectedVersion, user })
  )));

  router.post('/semanas/:weekStart/fechar', write(reopenBodySchema.partial(), ({ weekStart, expectedVersion, user }) => (
    services.closeReviewWeek({ weekStart, expectedVersion, user })
  )));

  router.post('/semanas/:weekStart/reabrir', write(reopenBodySchema, ({ weekStart, body, expectedVersion, user }) => (
    services.reopenReviewWeek({ weekStart, expectedVersion, note: body.note || null, user })
  )));

  return router;
}

export default createAllocationReviewRouter();
