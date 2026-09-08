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

const router = Router();
const schemas = makeIntegrationApiSchemas(z, { globalMaxPageSize: env.apiTokenGlobalMaxPageSize });

function context(req) {
  return {
    scopes: req.apiAuth.scopeCodes,
    projectAccessMode: req.apiAuth.credential.projectAccessMode,
    projectIds: req.apiAuth.projectIds,
    maxPageSize: req.apiAuth.credential.maxPageSize,
    cursorKey: env.apiTokenHashKeys[env.apiTokenActiveKeyVersion],
    snapshotAt: new Date()
  };
}

function envelope(req, pageResult) {
  return { ...pageResult, generatedAt: new Date().toISOString(), schemaVersion: '1.0', requestId: req.requestId };
}

router.get('/registros', requireApiOperation('quality.records.list'), asyncHandler(async (req, res) => {
  const query = schemas.qualityRecordsQuery.parse(req.query);
  const result = await runMeteredApiOperation(req, {
    operationId: 'quality.records.list',
    requestedRows: query.limit,
    filterSummary: {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.updatedSince ? { updatedSince: query.updatedSince } : {}),
      includeDeleted: query.includeDeleted
    },
    execute: async () => {
      const page = await listIntegrationQualityRecords(prisma, query, context(req));
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
    operationId: 'quality.records.get', requestedRows: 1,
    execute: async () => ({ body: await getIntegrationQualityRecord(prisma, id, query, context(req)), rows: 1 })
  });
  res.json(result.body);
}));

router.get('/naturezas', requireApiOperation('quality.natures.list'), asyncHandler(async (req, res) => {
  const query = schemas.qualityNaturesQuery.parse(req.query);
  const result = await runMeteredApiOperation(req, {
    operationId: 'quality.natures.list', requestedRows: query.limit,
    filterSummary: { ...(query.updatedSince ? { updatedSince: query.updatedSince } : {}) },
    execute: async () => {
      const page = await listIntegrationQualityNatures(prisma, query, context(req));
      return { body: envelope(req, page), rows: page.items.length };
    }
  });
  res.json(result.body);
}));

router.get('/evidencias/:id/download', requireApiOperation('quality.evidence.download'), asyncHandler(async (req, res) => {
  const { id } = schemas.idParams.parse(req.params);
  const result = await runMeteredApiOperation(req, {
    operationId: 'quality.evidence.download', requestedRows: 0,
    execute: async () => {
      const resolved = await resolveIntegrationQualityEvidence(prisma, id, context(req));
      const file = await fs.stat(resolved.targetPath);
      return { ...resolved, bytes: file.size, rows: 0 };
    }
  });
  res.type(result.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
  return res.sendFile(result.targetPath);
}));

export default router;
