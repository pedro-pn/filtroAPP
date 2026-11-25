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
import { defineRoute } from '../../lib/api-contract/registry.js';
import { efetivoRoute, jsonResponseSchema } from '../../lib/api-contract/domains/efetivo.js';

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

  defineRoute(router, efetivoRoute('GET /pendencias/contagem', { summary: 'Quantidade de semanas com conferência pendente', tag: 'efetivo-conferencia', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
    res.json(await services.getReviewPendingCount({}));
  }));

  defineRoute(router, efetivoRoute('GET /meses/:yearMonth', { summary: 'Conferência de alocação do mês', tag: 'efetivo-conferencia', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), asyncHandler(async (req, res) => {
    const parsed = yearMonthParamSchema.safeParse(req.params.yearMonth);
    if (!parsed.success) return invalid(res, parsed, 'INVALID_YEAR_MONTH');
    return res.json(await services.getReviewMonth({ yearMonth: parsed.data, user: req.auth?.user }));
  }));

  defineRoute(router, efetivoRoute('GET /semanas/:weekStart', { summary: 'Conferência de alocação da semana', tag: 'efetivo-conferencia', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), asyncHandler(async (req, res) => {
    const weekStart = weekStartOf(req, res);
    if (!weekStart) return undefined;
    return res.json(await services.getReviewWeek({ weekStart, user: req.auth?.user }));
  }));

  defineRoute(router, efetivoRoute('PUT /semanas/:weekStart/dias', { summary: 'Salvar dias conferidos da semana (exige If-Match-Version)', tag: 'efetivo-conferencia', body: saveDaysBodySchema, validatedBy: 'handler (write(): mesmo schema do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 409, 428] }), write(saveDaysBodySchema, ({ weekStart, body, expectedVersion, user }) => (
    services.saveReviewDays({ weekStart, items: body.items, expectedVersion, user })
  )));

  defineRoute(router, efetivoRoute('DELETE /semanas/:weekStart/dias', { summary: 'Descartar ajustes de dias da semana (exige If-Match-Version)', tag: 'efetivo-conferencia', body: discardDaysBodySchema, validatedBy: 'handler (write(): mesmo schema do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 409, 428] }), write(discardDaysBodySchema, ({ weekStart, body, expectedVersion, user }) => (
    services.discardReviewDays({ weekStart, items: body.items, expectedVersion, user })
  )));

  defineRoute(router, efetivoRoute('POST /semanas/:weekStart/linhas/conferir', { summary: 'Conferir linhas de colaboradores da semana (exige If-Match-Version)', tag: 'efetivo-conferencia', body: confirmRowsBodySchema, validatedBy: 'handler (write(): mesmo schema do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 409, 428] }), write(confirmRowsBodySchema, ({ weekStart, body, expectedVersion, user }) => (
    services.confirmReviewRows({
      weekStart,
      collaboratorIds: body.collaboratorIds || null,
      allReady: body.allReady === true,
      expectedVersion,
      user
    })
  )));

  defineRoute(router, efetivoRoute('POST /semanas/:weekStart/linhas/desconferir', { summary: 'Desfazer conferência de linhas da semana (exige If-Match-Version)', tag: 'efetivo-conferencia', body: unconfirmRowsBodySchema, validatedBy: 'handler (write(): mesmo schema do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 409, 428] }), write(unconfirmRowsBodySchema, ({ weekStart, body, expectedVersion, user }) => (
    services.unconfirmReviewRows({ weekStart, collaboratorIds: body.collaboratorIds, expectedVersion, user })
  )));

  defineRoute(router, efetivoRoute('POST /semanas/:weekStart/fechar', { summary: 'Fechar a conferência da semana (exige If-Match-Version)', tag: 'efetivo-conferencia', body: reopenBodySchema.partial(), validatedBy: 'handler (write(): mesmo schema do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 409, 428] }), write(reopenBodySchema.partial(), ({ weekStart, expectedVersion, user }) => (
    services.closeReviewWeek({ weekStart, expectedVersion, user })
  )));

  defineRoute(router, efetivoRoute('POST /semanas/:weekStart/reabrir', { summary: 'Reabrir a conferência da semana (exige If-Match-Version)', tag: 'efetivo-conferencia', body: reopenBodySchema, validatedBy: 'handler (write(): mesmo schema do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 409, 428] }), write(reopenBodySchema, ({ weekStart, body, expectedVersion, user }) => (
    services.reopenReviewWeek({ weekStart, expectedVersion, note: body.note || null, user })
  )));

  return router;
}

export default createAllocationReviewRouter();
