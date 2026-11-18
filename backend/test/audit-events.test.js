import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIT_ENTITY_TYPES,
  AUDIT_MODULES,
  normalizeAuditEvent,
  recordAuditEvent
} from '../src/lib/audit/events.js';
import {
  anonymizeDocumentAccessEvidence,
  recordDocumentEvent
} from '../src/lib/assinaturas/audit.js';

test('normalizeAuditEvent trims required fields and evidence', () => {
  assert.deepEqual(
    normalizeAuditEvent({
      module: ' rdo ',
      entityType: ' report ',
      entityId: ' report-1 ',
      relatedEntityId: ' version-1 ',
      actorUserId: ' user-1 ',
      action: ' SIGNED ',
      description: ' Assinatura registrada ',
      evidence: {
        ipAddress: ' 8.8.8.8 ',
        userAgent: ' Browser '
      }
    }),
    {
      module: 'rdo',
      entityType: 'report',
      entityId: 'report-1',
      relatedEntityId: 'version-1',
      actorUserId: 'user-1',
      action: 'SIGNED',
      description: 'Assinatura registrada',
      evidence: {
        ipAddress: '8.8.8.8',
        userAgent: 'Browser'
      }
    }
  );
});

test('recordAuditEvent writes report audit logs through the common contract', async () => {
  const calls = [];
  const client = {
    reportAuditLog: {
      async create(args) {
        calls.push(args);
        return args.data;
      }
    }
  };

  await recordAuditEvent(client, {
    module: AUDIT_MODULES.RDO,
    entityType: AUDIT_ENTITY_TYPES.REPORT,
    entityId: 'report-1',
    relatedEntityId: 'version-1',
    actorUserId: 'user-1',
    action: 'SIGNED',
    description: 'Assinatura registrada.',
    evidence: { ipAddress: '8.8.8.8', userAgent: 'Unit Test' }
  });

  assert.deepEqual(calls[0], {
    data: {
      reportId: 'report-1',
      versionId: 'version-1',
      userId: 'user-1',
      action: 'SIGNED',
      description: 'Assinatura registrada.',
      ipAddress: '8.8.8.8',
      userAgent: 'Unit Test'
    }
  });
});

test('recordAuditEvent writes EPI signature request audit logs through the common contract', async () => {
  const calls = [];
  const client = {
    epiSignatureRequestAuditLog: {
      async create(args) {
        calls.push(args);
        return args.data;
      }
    }
  };

  await recordAuditEvent(client, {
    module: AUDIT_MODULES.EPI,
    entityType: AUDIT_ENTITY_TYPES.EPI_SIGNATURE_REQUEST,
    entityId: 'request-1',
    action: 'SIGNED',
    evidence: { ipAddress: '8.8.4.4' }
  });

  assert.deepEqual(calls[0], {
    data: {
      requestId: 'request-1',
      action: 'SIGNED',
      ipAddress: '8.8.4.4',
      userAgent: null
    }
  });
});

test('recordAuditEvent writes standalone signature document audit logs', async () => {
  const calls = [];
  const client = {
    signatureDocumentAuditLog: {
      async create(args) {
        calls.push(args);
        return args.data;
      }
    }
  };

  await recordAuditEvent(client, {
    module: AUDIT_MODULES.ASSINATURAS,
    entityType: AUDIT_ENTITY_TYPES.SIGNATURE_DOCUMENT,
    entityId: 'document-1',
    relatedEntityId: 'signer-1',
    actorUserId: 'user-1',
    action: 'CONVITE_CRIADO',
    description: 'Convite criado.',
    evidence: { ipAddress: '127.0.0.1', userAgent: 'Unit Test' }
  });

  assert.deepEqual(calls[0], {
    data: {
      documentId: 'document-1',
      signerId: 'signer-1',
      actorUserId: 'user-1',
      action: 'CONVITE_CRIADO',
      description: 'Convite criado.',
      ipAddress: '127.0.0.1',
      userAgent: 'Unit Test'
    }
  });
});

test('recordAuditEvent keeps rejecting unknown audit targets', async () => {
  await assert.rejects(
    () => recordAuditEvent({}, {
      module: 'desconhecido',
      entityType: 'registro',
      entityId: '1',
      action: 'TESTE'
    }),
    TypeError
  );
});

test('recordDocumentEvent maps document and signer without exposing semantic mutation', async () => {
  const calls = [];
  const client = {
    signatureDocumentAuditLog: {
      async create(args) {
        calls.push(args);
        return args.data;
      }
    }
  };

  await recordDocumentEvent(client, {
    document: { id: 'document-1' },
    signer: { id: 'signer-1' },
    actorUserId: 'user-1',
    action: 'LINK_RECUPERADO'
  });

  assert.equal(calls[0].data.documentId, 'document-1');
  assert.equal(calls[0].data.signerId, 'signer-1');
  assert.equal(calls[0].data.actorUserId, 'user-1');
});

test('anonymização altera só IP/UA e acrescenta evento observável', async () => {
  const updates = [];
  const creates = [];
  const client = {
    signatureDocumentAuditLog: {
      async updateMany(args) {
        updates.push(args);
        return { count: 2 };
      },
      async create(args) {
        creates.push(args);
        return args.data;
      }
    }
  };
  const cutoff = new Date('2026-01-01T00:00:00.000Z');

  assert.equal(await anonymizeDocumentAccessEvidence(client, {
    documentId: 'document-1',
    cutoff
  }), 2);
  assert.deepEqual(updates[0].data, { ipAddress: null, userAgent: null });
  assert.equal(creates[0].data.action, 'DADOS_ACESSO_ANONIMIZADOS');
  assert.equal(creates[0].data.documentId, 'document-1');
});
