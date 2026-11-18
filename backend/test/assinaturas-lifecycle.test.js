import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDocumentDeletable,
  assertDocumentEditable,
  documentForOwnerOrThrow
} from '../src/lib/assinaturas/access.js';
import {
  anonymizeDocumentAccessEvidence,
  recordDocumentEvent
} from '../src/lib/assinaturas/audit.js';
import { expireOverdueInvites } from '../src/lib/assinaturas/invites.js';
import {
  archiveDocument,
  assertUserDeletionImpactReady,
  cancelDocument,
  restoreArchivedDocument,
  restoreDeletedDocument,
  softDeleteDocument,
  userDeletionImpact,
  validateByCode
} from '../src/lib/assinaturas/service.js';
import { purgeDeletedSignatureDocuments } from '../src/lib/assinaturas/jobs.js';
import { deleteUserWithSignatureDocuments } from '../src/lib/assinaturas/file-quarantine.js';
import { assertInviteUsable } from '../src/lib/assinaturas/signing.js';

test('documento publicado não pode ser editado e FINALIZANDO não pode ser excluído', () => {
  assert.throws(
    () => assertDocumentEditable({ status: 'AGUARDANDO_ASSINATURAS' }),
    error => error?.statusCode === 409
  );
  assert.throws(
    () => assertDocumentDeletable({ status: 'FINALIZANDO' }),
    error => error?.statusCode === 409 && error?.code === 'DOCUMENT_FINALIZING'
  );
});

test('auditoria é append-only e anonimização altera apenas IP/UA antes de acrescentar evento', async () => {
  const rows = [];
  const semantic = {
    id: 'audit-1', documentId: 'document-1', signerId: 'signer-1', actorUserId: 'owner-1',
    action: 'ASSINATURA_REALIZADA', description: 'Assinatura registrada.',
    ipAddress: '203.0.113.10', userAgent: 'Node Test', createdAt: new Date('2025-01-01T00:00:00.000Z')
  };
  rows.push(semantic);
  const client = {
    signatureDocumentAuditLog: {
      async create({ data }) { rows.push({ id: `audit-${rows.length + 1}`, ...data, createdAt: new Date() }); return data; },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of rows) {
          if (row.documentId === where.documentId && row.createdAt < where.createdAt.lt && (row.ipAddress || row.userAgent)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      }
    }
  };

  await recordDocumentEvent(client, { document: { id: 'document-1' }, action: 'DOCUMENTO_CRIADO', description: 'Criado.' });
  const semanticSnapshot = { ...semantic, ipAddress: null, userAgent: null };
  assert.equal(await anonymizeDocumentAccessEvidence(client, {
    documentId: 'document-1', cutoff: new Date('2026-01-01T00:00:00.000Z'), actorUserId: 'owner-1'
  }), 1);
  assert.deepEqual(semantic, semanticSnapshot);
  assert.deepEqual(rows.map(row => row.action), ['ASSINATURA_REALIZADA', 'DOCUMENTO_CRIADO', 'DADOS_ACESSO_ANONIMIZADOS']);
  assert.equal(JSON.stringify(rows).includes('convite='), false);
});

test('job expira somente convites vencidos ainda pendentes e audita a transição', async () => {
  const now = new Date('2026-08-28T15:00:00.000Z');
  const document = { id: 'document-1' };
  const signers = [
    { id: 'pending', name: 'Ana', status: 'PENDENTE', tokenExpiresAt: new Date(now.getTime() - 1), tokenHash: 'hash-1', document },
    { id: 'signed', name: 'Bia', status: 'ASSINADO', tokenExpiresAt: new Date(now.getTime() - 1), tokenHash: 'hash-2', document }
  ];
  const audits = [];
  const client = {
    signatureDocumentSigner: {
      async findMany() { return signers.filter(item => ['PENDENTE', 'VISUALIZADO'].includes(item.status) && item.tokenExpiresAt <= now); },
      async updateMany({ where, data }) {
        const signer = signers.find(item => item.id === where.id);
        if (!signer || !where.status.in.includes(signer.status) || signer.tokenExpiresAt > where.tokenExpiresAt.lte) return { count: 0 };
        Object.assign(signer, data);
        return { count: 1 };
      }
    },
    signatureDocumentAuditLog: {
      async create({ data }) { audits.push(data); return data; }
    }
  };

  assert.deepEqual(await expireOverdueInvites(client, { now }), { found: 1, expired: 1 });
  assert.equal(signers[0].status, 'EXPIRADO');
  assert.equal(signers[1].status, 'ASSINADO');
  assert.deepEqual(audits.map(item => item.action), ['CONVITE_EXPIRADO']);
});

function applyLifecycleData(target, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) target[key] = (target[key] || 0) + value.increment;
    else target[key] = value;
  }
}

function lifecycleClient(document) {
  const audits = [];
  const client = {
    signatureDocument: {
      async findFirst({ where }) {
        if (where.id !== document.id || where.ownerUserId !== document.ownerUserId) return null;
        if (where.deletedAt === null && document.deletedAt !== null) return null;
        return document;
      },
      async update({ data }) { applyLifecycleData(document, data); return document; },
      async updateMany({ where, data }) {
        if (where.id !== document.id) return { count: 0 };
        if (where.filesPurgedAt === null && document.filesPurgedAt !== null) return { count: 0 };
        applyLifecycleData(document, data);
        return { count: 1 };
      },
      async findMany() { return [document]; }
    },
    signatureDocumentSigner: {
      async updateMany({ where, data }) {
        const candidates = document.signers.filter(signer => {
          if (where.id && signer.id !== where.id) return false;
          if (where.documentId && signer.documentId !== where.documentId) return false;
          if (typeof where.status === 'string' && signer.status !== where.status) return false;
          if (where.status?.in && !where.status.in.includes(signer.status)) return false;
          if (where.tokenHash !== undefined && typeof where.tokenHash === 'string' && signer.tokenHash !== where.tokenHash) return false;
          if (where.tokenHash?.not === null && signer.tokenHash === null) return false;
          if (where.invalidationReason && signer.invalidationReason !== where.invalidationReason) return false;
          return true;
        });
        for (const signer of candidates) applyLifecycleData(signer, data);
        return { count: candidates.length };
      }
    },
    signatureDocumentAuditLog: {
      async create({ data }) { audits.push(data); return data; }
    },
    async $transaction(operation) { return operation(client); }
  };
  return { client, audits };
}

function lifecycleDocument(overrides = {}) {
  return {
    id: 'document-life',
    ownerUserId: 'owner-1',
    title: 'Contrato',
    status: 'AGUARDANDO_ASSINATURAS',
    archivedAt: null,
    deletedAt: null,
    filesPurgedAt: null,
    sourceStoragePath: 'Assinaturas/Documentos/source.pdf',
    finalStoragePath: null,
    signers: [
      { id: 'pending', documentId: 'document-life', name: 'Ana', email: null, status: 'PENDENTE', tokenHash: 'old-pending', invalidationReason: null },
      { id: 'signed', documentId: 'document-life', name: 'Bia', email: null, status: 'ASSINADO', tokenHash: 'old-signed', invalidationReason: null, signedAt: new Date() }
    ],
    ...overrides
  };
}

test('arquivar e restaurar não alteram status, assinaturas ou links', async () => {
  const document = lifecycleDocument();
  const { client, audits } = lifecycleClient(document);
  const tokenSnapshot = document.signers.map(item => item.tokenHash);

  await archiveDocument(client, document.id, document.ownerUserId, { now: new Date('2026-08-28T15:00:00.000Z') });
  assert.equal(document.status, 'AGUARDANDO_ASSINATURAS');
  assert.deepEqual(document.signers.map(item => item.tokenHash), tokenSnapshot);
  assert.ok(document.archivedAt);
  await restoreArchivedDocument(client, document.id, document.ownerUserId);
  assert.equal(document.archivedAt, null);
  assert.deepEqual(audits.map(item => item.action), ['DOCUMENTO_ARQUIVADO', 'DOCUMENTO_RESTAURADO']);
});

test('cancelamento revoga pendentes e preserva assinatura já registrada', async () => {
  const document = lifecycleDocument();
  const { client } = lifecycleClient(document);
  await cancelDocument(client, document.id, document.ownerUserId, 'Solicitação encerrada');

  assert.equal(document.status, 'CANCELADO');
  assert.equal(document.signers[0].status, 'REVOGADO');
  assert.equal(document.signers[0].invalidationReason, 'DOCUMENTO_CANCELADO');
  assert.equal(document.signers[1].status, 'ASSINADO');
  assert.equal(document.signers[1].signedAt instanceof Date, true);
});

test('exclusão bloqueia FINALIZANDO e restauração reemite só convites invalidados pela exclusão', async () => {
  const finalizing = lifecycleDocument({ status: 'FINALIZANDO' });
  await assert.rejects(
    () => softDeleteDocument(lifecycleClient(finalizing).client, finalizing.id, finalizing.ownerUserId),
    error => error?.statusCode === 409
  );
  assert.equal(finalizing.deletedAt, null);

  const document = lifecycleDocument();
  document.signers.push({
    id: 'manual', documentId: document.id, name: 'Carlos', email: null,
    status: 'REVOGADO', tokenHash: null, invalidationReason: 'MANUAL'
  });
  const { client } = lifecycleClient(document);
  const deletedAt = new Date('2026-08-28T15:00:00.000Z');
  await softDeleteDocument(client, document.id, document.ownerUserId, { now: deletedAt });
  assert.equal(document.signers[0].status, 'REVOGADO');
  assert.equal(document.signers[0].invalidationReason, 'DOCUMENTO_EXCLUIDO');
  assert.equal(document.signers[1].status, 'ASSINADO');
  assert.equal(document.signers[1].tokenHash, null);

  const oldPendingHash = 'old-pending';
  const restored = await restoreDeletedDocument(client, document.id, document.ownerUserId, {
    now: new Date(deletedAt.getTime() + 60_000),
    deliverInvites: async () => []
  });
  assert.equal(document.deletedAt, null);
  assert.equal(restored.reissuedInvites.length, 1);
  assert.equal(document.signers[0].status, 'PENDENTE');
  assert.notEqual(document.signers[0].tokenHash, oldPendingHash);
  assert.equal(document.signers[1].status, 'ASSINADO');
  assert.equal(document.signers[1].tokenHash, null);
  assert.equal(document.signers[2].status, 'REVOGADO');
  assert.equal(document.signers[2].invalidationReason, 'MANUAL');
});

test('retenção purga bytes e caminhos, mas preserva documento e trilha', async () => {
  const now = new Date('2026-08-28T15:00:00.000Z');
  const document = lifecycleDocument({ deletedAt: new Date('2026-01-01T00:00:00.000Z') });
  const { client, audits } = lifecycleClient(document);
  const removed = [];
  const result = await purgeDeletedSignatureDocuments(client, {
    now,
    purgeFiles: async item => { removed.push(item.sourceStoragePath); },
    purgePreviewFiles: async id => { removed.push(`preview:${id}`); }
  });

  assert.deepEqual(result, { found: 1, purged: 1 });
  assert.equal(document.sourceStoragePath, null);
  assert.equal(document.filesPurgedAt, now);
  assert.deepEqual(removed, ['Assinaturas/Documentos/source.pdf', `preview:${document.id}`]);
  assert.deepEqual(audits.map(item => item.action), ['ARQUIVOS_PURGADOS']);
});

test('impacto da exclusão separa descartáveis, concluídos e finalizações em curso', async () => {
  const documents = [
    { ownerUserId: 'owner-1', status: 'RASCUNHO' },
    { ownerUserId: 'owner-1', status: 'AGUARDANDO_ASSINATURAS' },
    { ownerUserId: 'owner-1', status: 'CANCELADO' },
    { ownerUserId: 'owner-1', status: 'CONCLUIDO' },
    { ownerUserId: 'owner-1', status: 'FINALIZANDO' },
    { ownerUserId: 'owner-2', status: 'RASCUNHO' }
  ];
  const client = {
    signatureDocument: {
      async count({ where }) {
        return documents.filter(document => {
          if (document.ownerUserId !== where.ownerUserId) return false;
          if (typeof where.status === 'string') return document.status === where.status;
          return where.status.in.includes(document.status);
        }).length;
      }
    }
  };
  const impact = await userDeletionImpact(client, 'owner-1');
  assert.deepEqual(impact, { toDelete: 3, toPreserve: 1, finalizing: 1 });
  assert.throws(
    () => assertUserDeletionImpactReady(impact),
    error => error?.statusCode === 409 && error?.code === 'SIGNATURE_DOCUMENTS_FINALIZING'
  );
  let touchedFiles = false;
  await assert.rejects(
    () => deleteUserWithSignatureDocuments({
      ...client,
      signatureDocument: {
        ...client.signatureDocument,
        async findMany() { touchedFiles = true; return []; }
      },
      signatureDocumentFilePurge: {
        async create() { touchedFiles = true; throw new Error('não deveria criar manifesto'); }
      }
    }, 'owner-1'),
    error => error?.statusCode === 409 && error?.code === 'SIGNATURE_DOCUMENTS_FINALIZING'
  );
  assert.equal(touchedFiles, false);
});

test('documento concluído órfão nega acesso autenticado e mantém validação e convite assinado', async () => {
  const completed = {
    id: 'completed-orphan',
    ownerUserId: null,
    requesterNameSnapshot: 'Responsável histórico',
    title: 'Contrato concluído',
    originalFileName: 'contrato.pdf',
    status: 'CONCLUIDO',
    validationCode: 'abcdefghijklmnopqrstuvwxyz',
    sourceDocumentHash: 'source-hash',
    finalDocumentHash: 'final-hash',
    completedAt: new Date('2026-08-28T15:00:00.000Z'),
    signers: [{
      id: 'signed-1', name: 'Ana', declaredSignerName: 'Ana', status: 'ASSINADO',
      signedAt: new Date('2026-08-28T14:00:00.000Z')
    }]
  };
  await assert.rejects(
    () => documentForOwnerOrThrow({ signatureDocument: { async findFirst() { return null; } } }, completed.id, 'former-owner'),
    error => error?.statusCode === 404
  );
  const validation = await validateByCode({
    signatureDocument: { async findUnique() { return completed; } }
  }, completed.validationCode);
  assert.equal(validation.status, 'VALID');
  assert.equal(validation.document.requesterNameSnapshot, 'Responsável histórico');
  const invite = {
    ...completed.signers[0],
    tokenHash: 'hash',
    tokenExpiresAt: new Date('2026-09-28T15:00:00.000Z'),
    document: completed
  };
  assert.equal(assertInviteUsable(invite, new Date('2026-08-28T16:00:00.000Z')), invite);
});
