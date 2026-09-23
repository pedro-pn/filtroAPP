import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';

import { makeProjectDocumentSchemas } from '../../shared/schemas/project-documents.js';
import { jsonBodyLimitForRequest } from '../src/app.js';
import { allowedProjectDocumentTypes, serializeProjectDocument } from '../src/lib/efetivo/project-workflow/documents.js';

test('rotas do catálogo exigem viewer e expõem toda a superfície validada', async () => {
  const source = await fs.readFile(new URL('../src/routes/efetivo-project-workflow.js', import.meta.url), 'utf8');
  for (const route of [
    "get('/:projectId/documents'",
    "post('/:projectId/documents'",
    "patch('/:projectId/documents/:documentId'",
    "post('/:projectId/documents/:documentId/versions'",
    "get('/:projectId/documents/:documentId/versions/:versionId/file'",
    "post('/:projectId/documents/:documentId/acceptance'",
    "post('/:projectId/documents/:documentId/signature'",
    "post('/:projectId/documents/:documentId/archive'",
    "post('/:projectId/documents/:documentId/restore'"
  ]) assert.ok(source.includes(route), route);
  assert.equal((source.match(/requireEfetivoViewer/g) || []).length >= 12, true);
  assert.equal(source.includes('upsertCrmProjectDocument'), false, 'o adaptador CRM não deve virar webhook público');
});

test('schemas rejeitam corpo desconhecido, versão inválida e filtros ambíguos', () => {
  const schemas = makeProjectDocumentSchemas(z);
  assert.equal(schemas.create.safeParse({ type: 'CONTRACT', title: 'Contrato', acceptanceMode: 'NONE', storagePath: '/tmp/secret' }).success, false);
  assert.equal(schemas.patch.safeParse({ expectedVersion: 0, title: 'Contrato' }).success, false);
  assert.equal(schemas.list.parse({ includeArchived: 'true' }).includeArchived, true);
  assert.equal(schemas.list.safeParse({ includeArchived: 'talvez' }).success, false);
  assert.equal(schemas.acceptance.safeParse({ expectedVersion: 1, versionId: 'ver_1', status: 'ACCEPTED', occurredOn: '10/09/2026' }).success, false);
});

test('limite ampliado vale apenas para criação e nova versão de documento', () => {
  assert.match(jsonBodyLimitForRequest('POST', '/api/efetivo/project-workflow/project_1/documents'), /mb$/);
  assert.match(jsonBodyLimitForRequest('POST', '/api/efetivo/project-workflow/project_1/documents/doc_1/versions'), /mb$/);
  assert.equal(jsonBodyLimitForRequest('PATCH', '/api/efetivo/project-workflow/project_1/documents/doc_1'), '1mb');
});

test('serialização não expõe caminho interno e permissões respeitam responsabilidade por área', () => {
  const project = { workflow: { stage: 'INITIAL_ANALYSIS', leaderUserId: 'leader_1' } };
  const document = {
    id: 'doc_1', projectId: 'project_1', type: 'CONTRACT', title: 'Contrato', version: 1,
    description: null, responsible: null, requirementStage: null, acceptanceMode: 'NONE', archivedAt: null,
    archivedBy: null, createdAt: new Date(), createdBy: null, updatedAt: new Date(), updatedBy: null,
    currentVersion: {
      id: 'ver_1', documentId: 'doc_1', sequence: 1, source: 'MANUAL', contentKind: 'EXTERNAL_REFERENCE',
      externalUrl: 'https://crm.example/contract', storagePath: '/srv/private/contract.pdf', acceptanceStatus: 'NOT_REQUIRED',
      createdAt: new Date(), signatureDocument: null
    }
  };
  const context = { actorUserId: 'commercial_1', user: { moduleRoles: [{ module: 'EFETIVO', role: 'EFETIVO_COMMERCIAL' }] } };
  const serialized = serializeProjectDocument(document, project, context);
  assert.equal(JSON.stringify(serialized).includes('storagePath'), false);
  assert.equal(serialized.permissions.update, true);
  assert.deepEqual(allowedProjectDocumentTypes(project, context), ['COMMERCIAL_PROPOSAL', 'PURCHASE_ORDER', 'CONTRACT']);
});
