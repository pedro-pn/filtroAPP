import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIT_ENTITY_TYPES,
  AUDIT_MODULES,
  normalizeAuditEvent,
  recordAuditEvent
} from '../src/lib/audit/events.js';

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
