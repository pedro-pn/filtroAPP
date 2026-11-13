import { Router } from 'express';
import env from '../../../config/env.js';
import prisma from '../../../lib/prisma.js';
import asyncHandler from '../../../lib/async-handler.js';
import { IntegrationApiError } from '../../../middleware/api-request-context.js';
import { requireApiOperation, runMeteredApiOperation } from '../../../middleware/api-token-auth.js';
import { receiveConectaEvent, getConectaReceipt } from '../../../lib/conecta-rh/service.js';
import { requireConectaCompany, validateConectaEvent } from '../../../lib/conecta-rh/schema.js';

export function createConectaRhRouter({ prismaClient = prisma, envConfig = env } = {}) {
  const router = Router();
  const authorize = req => {
    if (req.apiAuth.credential.projectAccessMode !== 'ALL') throw new IntegrationApiError(403, 'GLOBAL_ACCESS_REQUIRED', 'A integração de RH exige autorização global.');
  };
  router.post('/eventos', requireApiOperation('rh.conecta.events.post'), asyncHandler(async (req, res) => {
    authorize(req);
    if (!req.headers['idempotency-key']) throw new IntegrationApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Envie Idempotency-Key igual ao eventId.');
    const input = validateConectaEvent(req.body, req.headers['idempotency-key']);
    requireConectaCompany(input.companyId, envConfig.conectaRhCompanyId);
    if (input.aggregateType === 'job_role_salary' && !req.apiAuth.scopeCodes.has('rh.conecta.salarios.write')) {
      throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'A credencial não possui o escopo salarial.');
    }
    const result = await runMeteredApiOperation(req, { prismaClient, operationId: 'rh.conecta.events.post', requestedRows: 1,
      execute: async database => ({ rows: 1, statusCode: 202,
        body: { ...await receiveConectaEvent(database, input, { idempotencyKey: req.headers['idempotency-key'], companyId: envConfig.conectaRhCompanyId }), requestId: req.requestId } }) });
    res.status(result.statusCode).json(result.body);
  }));
  router.get('/recebimentos/:id', requireApiOperation('rh.conecta.receipts.get'), asyncHandler(async (req, res) => {
    authorize(req);
    requireConectaCompany(envConfig.conectaRhCompanyId, envConfig.conectaRhCompanyId);
    const result = await runMeteredApiOperation(req, { prismaClient, operationId: 'rh.conecta.receipts.get', requestedRows: 1,
      execute: async database => ({ rows: 1, body: { ...await getConectaReceipt(database, req.params.id, envConfig.conectaRhCompanyId), requestId: req.requestId } }) });
    res.json(result.body);
  }));
  return router;
}

export default createConectaRhRouter();
