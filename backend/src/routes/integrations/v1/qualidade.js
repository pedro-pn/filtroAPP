import { withProjectChannel } from '../../../lib/projects/access-scope.js';
import fs from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';

import { makeIntegrationApiSchemas } from '../../../../../shared/schemas/integration-api.js';
import env from '../../../config/env.js';
import asyncHandler from '../../../lib/async-handler.js';
import prisma from '../../../lib/prisma.js';
import { runMeteredApiOperation, requireApiOperation } from '../../../middleware/api-token-auth.js';
import { getIntegrationQualityRecord, listIntegrationQualityRecords } from '../../../lib/qualidade/integration-service.js';
import { listIntegrationQualityNatures } from '../../../lib/qualidade/integration-natures.js';
import { resolveIntegrationQualityEvidence } from '../../../lib/qualidade/integration-evidence.js';
import { createIntegrationQualityRecord, validateIntegrationQualityCreate } from '../../../lib/qualidade/integration-create.js';

export function createIntegrationQualityRouter({ prismaClient = prisma, envConfig = env } = {}) {
  const router = Router();
  router.use((_req, _res, next) => withProjectChannel('api', next));
  const schemas = makeIntegrationApiSchemas(z, { globalMaxPageSize: envConfig.apiTokenGlobalMaxPageSize });

  function context(req) {
    return {
      credentialId: req.apiAuth.credentialId,
      scopes: req.apiAuth.scopeCodes,
      projectAccessMode: req.apiAuth.credential.projectAccessMode,
      projectIds: req.apiAuth.projectIds,
      projectCodes: req.apiAuth.projectCodes,
      maxPageSize: req.apiAuth.credential.maxPageSize,
      cursorKey: envConfig.apiTokenHashKeys[envConfig.apiTokenActiveKeyVersion],
      snapshotAt: new Date()
    };
  }

  router.post('/registros', requireApiOperation('quality.records.create'), asyncHandler(async (req, res) => {
    const ctx = context(req);
    const key = req.headers['idempotency-key'];
    validateIntegrationQualityCreate(req.body, key, ctx, req.query);
    const result = await runMeteredApiOperation(req, {
      prismaClient,
      operationId: 'quality.records.create', requestedRows: 1,
      execute: async database => ({ body: await createIntegrationQualityRecord(database, req.body, key, ctx), rows: 1, statusCode: 201 })
    });
    res.status(result.statusCode).json(result.body);
  }));

  function envelope(req, pageResult) {
    return { ...pageResult, generatedAt: new Date().toISOString(), schemaVersion: '1.0', requestId: req.requestId };
  }

  router.get('/registros', requireApiOperation('quality.records.list'), asyncHandler(async (req, res) => {
    const query = schemas.qualityRecordsQuery.parse(req.query);
    const result = await runMeteredApiOperation(req, {
      prismaClient,
      operationId: 'quality.records.list',
      requestedRows: query.limit,
      filterSummary: {
        ...(query.projectCode ? { projectCode: query.projectCode } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.updatedSince ? { updatedSince: query.updatedSince } : {}),
        includeDeleted: query.includeDeleted
      },
      execute: async () => {
        const page = await listIntegrationQualityRecords(prismaClient, query, context(req));
        const body = envelope(req, page);
        return { body, rows: page.items.length };
      }
    });
    res.status(result.statusCode || 200).json(result.body);
  }));

  router.get('/registros/:id', requireApiOperation('quality.records.get'), asyncHandler(async (req, res) => {
    const { id } = schemas.idParams.parse(req.params);
    const query = schemas.qualityRecordDetailQuery.parse(req.query);
    const result = await runMeteredApiOperation(req, {
      prismaClient,
      operationId: 'quality.records.get', requestedRows: 1,
      execute: async () => ({ body: await getIntegrationQualityRecord(prismaClient, id, query, context(req)), rows: 1 })
    });
    res.json(result.body);
  }));

  router.get('/naturezas', requireApiOperation('quality.natures.list'), asyncHandler(async (req, res) => {
    const query = schemas.qualityNaturesQuery.parse(req.query);
    const result = await runMeteredApiOperation(req, {
      prismaClient,
      operationId: 'quality.natures.list', requestedRows: query.limit,
      filterSummary: { ...(query.updatedSince ? { updatedSince: query.updatedSince } : {}) },
      execute: async () => {
        const page = await listIntegrationQualityNatures(prismaClient, query, context(req));
        return { body: envelope(req, page), rows: page.items.length };
      }
    });
    res.json(result.body);
  }));

  router.get('/evidencias/:id/download', requireApiOperation('quality.evidence.download'), asyncHandler(async (req, res) => {
    const { id } = schemas.idParams.parse(req.params);
    const result = await runMeteredApiOperation(req, {
      prismaClient,
      operationId: 'quality.evidence.download', requestedRows: 0,
      execute: async () => {
        const resolved = await resolveIntegrationQualityEvidence(prismaClient, id, context(req));
        const file = await fs.stat(resolved.targetPath);
        return { ...resolved, bytes: file.size, rows: 0 };
      }
    });
    res.type(result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    return res.sendFile(result.targetPath);
  }));

  return router;
}

export default createIntegrationQualityRouter();
