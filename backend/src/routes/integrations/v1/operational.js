import { Router } from 'express';
import { pipeline } from 'node:stream/promises';
import env from '../../../config/env.js';
import asyncHandler from '../../../lib/async-handler.js';
import prisma from '../../../lib/prisma.js';
import { OPERATIONAL_RESOURCES } from '../../../lib/api-credentials/operational-resources.js';
import { OPERATIONAL_DOWNLOADS } from '../../../lib/api-credentials/extended-operational-resources.js';
import { getEfetivoProjectStatus, validateEfetivoProjectStatusRequest } from '../../../lib/api-credentials/efetivo-project-status.js';
import { createCrmDocument, createCrmProject, upsertCrmCommercialFact, validateCommercialFact, validateCrmDocument, validateProjectCreation, validateProjectWriteAccess } from '../../../lib/api-credentials/efetivo-project-writes.js';
import { openOperationalDownload, validateOperationalDownload } from '../../../lib/api-credentials/operational-downloads.js';
import {
  listOperationalResources,
  prepareOperationalQuery
} from '../../../lib/api-credentials/operational-service.js';
import {
  requireApiOperation,
  runMeteredApiOperation
} from '../../../middleware/api-token-auth.js';

export function createOperationalRouter({
  prismaClient = prisma,
  envConfig = env
} = {}) {
  const router = Router();
  router.post('/efetivo/projetos', requireApiOperation('efetivo.projects.create'), asyncHandler(async (req, res) => {
    validateProjectWriteAccess(null, req.query, req.apiAuth.credential, { create: true });
    validateProjectCreation(req.body);
    const result = await runMeteredApiOperation(req, {
      prismaClient, operationId: 'efetivo.projects.create', requestedRows: 1,
      execute: async () => {
        const body = await createCrmProject(prismaClient, req.body);
        return { rows: 1, statusCode: body.status === 'created' ? 201 : 200, outcomeCode: body.status.toUpperCase(), body: { ...body, requestId: req.requestId } };
      }
    });
    res.status(result.statusCode).json(result.body);
  }));
  router.post('/efetivo/projetos/:id/fatos-comerciais', requireApiOperation('efetivo.projects.commercialFact.post'), asyncHandler(async (req, res) => {
    const id = validateProjectWriteAccess(req.params.id, req.query, { projectAccessMode: req.apiAuth.credential.projectAccessMode, projectIds: req.apiAuth.projectIds });
    validateCommercialFact(req.body);
    const result = await runMeteredApiOperation(req, {
      prismaClient, operationId: 'efetivo.projects.commercialFact.post', requestedRows: 1,
      filterSummary: { projectId: id },
      execute: async () => {
        const body = await upsertCrmCommercialFact(prismaClient, id, req.body);
        return { rows: 1, statusCode: body.outcome === 'CREATED' ? 201 : 200, outcomeCode: body.outcome, body: { ...body, requestId: req.requestId } };
      }
    });
    res.status(result.statusCode).json(result.body);
  }));
  router.post('/efetivo/projetos/:id/documentos', requireApiOperation('efetivo.projects.document.post'), asyncHandler(async (req, res) => {
    const id = validateProjectWriteAccess(req.params.id, req.query, { projectAccessMode: req.apiAuth.credential.projectAccessMode, projectIds: req.apiAuth.projectIds });
    validateCrmDocument(req.body);
    const result = await runMeteredApiOperation(req, {
      prismaClient, operationId: 'efetivo.projects.document.post', requestedRows: 1,
      filterSummary: { projectId: id },
      execute: async () => {
        const body = await createCrmDocument(prismaClient, id, req.body);
        return { rows: 1, statusCode: body.outcome === 'CREATED' ? 201 : 200, outcomeCode: body.outcome, body: { ...body, requestId: req.requestId } };
      }
    });
    res.status(result.statusCode).json(result.body);
  }));
  router.get('/efetivo/projetos/:id/status', requireApiOperation('efetivo.projects.status.get'), asyncHandler(async (req, res) => {
    const context = {
      projectAccessMode: req.apiAuth.credential.projectAccessMode,
      projectIds: req.apiAuth.projectIds
    };
    const id = validateEfetivoProjectStatusRequest(req.params, req.query, context);
    const result = await runMeteredApiOperation(req, {
      prismaClient,
      operationId: 'efetivo.projects.status.get',
      requestedRows: 1,
      execute: async () => ({ rows: 1, body: {
        ...await getEfetivoProjectStatus(prismaClient, id, context),
        generatedAt: new Date().toISOString(), schemaVersion: '1.0', requestId: req.requestId
      } })
    });
    res.json(result.body);
  }));
  // Registra somente caminhos declarados no contrato; não recebe modelo/campos do cliente.
  for (const resource of OPERATIONAL_RESOURCES) {
    router.get(
      resource.path,
      requireApiOperation(resource.operationId),
      asyncHandler(async (req, res) => {
        const context = {
          scopes: req.apiAuth.scopeCodes,
          projectAccessMode: req.apiAuth.credential.projectAccessMode,
          projectIds: req.apiAuth.projectIds,
          projectCodes: req.apiAuth.projectCodes,
          maxPageSize: Math.min(
            req.apiAuth.credential.maxPageSize,
            envConfig.apiTokenGlobalMaxPageSize
          ),
          cursorKey:
            envConfig.apiTokenHashKeys[envConfig.apiTokenActiveKeyVersion],
          snapshotAt: new Date()
        };
        const { query } = prepareOperationalQuery(
          resource.operationId,
          req.query,
          context
        );
        const result = await runMeteredApiOperation(req, {
          prismaClient,
          operationId: resource.operationId,
          requestedRows: query.limit,
          filterSummary: {
            ...(query.projectCode ? { projectCode: query.projectCode } : {}),
            ...(query.projectId ? { projectId: query.projectId } : {}),
            ...(query.reportType ? { reportType: query.reportType.join(',') } : {}),
            ...(query.updatedSince ? { updatedSince: query.updatedSince } : {})
          },
          execute: async () => {
            const page = await listOperationalResources(
              prismaClient,
              resource.operationId,
              query,
              context
            );
            return {
              rows: page.items.length,
              body: {
                ...page,
                generatedAt: new Date().toISOString(),
                schemaVersion: '1.0',
                requestId: req.requestId
              }
            };
          }
        });
        res.json(result.body);
      })
    );
  }
  for (const download of OPERATIONAL_DOWNLOADS) {
    router.get(download.path, requireApiOperation(download.operationId), asyncHandler(async (req, res) => {
      const context = { scopes: req.apiAuth.scopeCodes, projectAccessMode: req.apiAuth.credential.projectAccessMode,
        projectIds: req.apiAuth.projectIds, maxPageSize: req.apiAuth.credential.maxPageSize };
      validateOperationalDownload(download.operationId, req.params, req.query, context);
      let file;
      try {
        await runMeteredApiOperation(req, { prismaClient, operationId: download.operationId, execute: async () => {
          file = await openOperationalDownload(prismaClient, download.operationId, req.params, req.query, context, envConfig);
          return { rows: 0, bytes: file.bytes };
        } });
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Type', file.contentType);
        res.setHeader('Content-Disposition', file.disposition);
        res.setHeader('Content-Length', String(file.bytes));
        if (!file.bytes) res.end();
        else await pipeline(file.handle.createReadStream({ autoClose: false, start: 0, end: file.bytes - 1 }), res);
      } catch (error) {
        if (res.headersSent) res.destroy();
        else throw error;
      } finally {
        if (file) await file.handle.close().catch(() => {});
      }
    }));
  }
  return router;
}

export default createOperationalRouter();
