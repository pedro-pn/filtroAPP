import { Router } from 'express';
import { pipeline } from 'node:stream/promises';
import env from '../../../config/env.js';
import asyncHandler from '../../../lib/async-handler.js';
import prisma from '../../../lib/prisma.js';
import { OPERATIONAL_RESOURCES } from '../../../lib/api-credentials/operational-resources.js';
import { OPERATIONAL_DOWNLOADS } from '../../../lib/api-credentials/extended-operational-resources.js';
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
            ...(query.projectId ? { projectId: query.projectId } : {}),
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
