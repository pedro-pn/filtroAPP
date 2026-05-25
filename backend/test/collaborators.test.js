import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCollaboratorSignatureNoticeData,
  collaboratorSchema
} from '../src/routes/resources/collaborators.js';

test('collaborator schema accepts empty nullable contact fields', () => {
  const parsed = collaboratorSchema.parse({
    name: 'Colaborador',
    role: 'Operador',
    email: null,
    signatureImage: null
  });

  assert.equal(parsed.email, null);
  assert.equal(parsed.signatureImage, null);
});

test('collaborator schema normalizes blank contact fields to null', () => {
  const parsed = collaboratorSchema.parse({
    name: 'Colaborador',
    role: 'Operador',
    email: '',
    signatureImage: ''
  });

  assert.equal(parsed.email, null);
  assert.equal(parsed.signatureImage, null);
});

test('collaborator schema rejects invalid email values', () => {
  assert.throws(() => collaboratorSchema.parse({
    name: 'Colaborador',
    role: 'Operador',
    email: 'email-invalido'
  }));
});

test('collaborator signature notice is required for new signature images', () => {
  assert.throws(
    () => buildCollaboratorSignatureNoticeData({ signatureImage: 'data:image/png;base64,abc' }),
    /Aceite o aviso de privacidade/
  );

  const now = new Date('2026-05-22T12:00:00.000Z');
  const result = buildCollaboratorSignatureNoticeData({
    signatureImage: 'data:image/png;base64,abc',
    signatureNoticeAccepted: true,
    signatureNoticeVersion: 'collaborator_signature_v1'
  }, null, now);

  assert.equal(result.shouldLogNotice, true);
  assert.equal(result.noticeVersion, 'collaborator_signature_v1');
  assert.equal(result.data.signatureNoticeAcceptedAt, now);
  assert.equal(result.data.signatureNoticeVersion, 'collaborator_signature_v1');
});

test('collaborator signature notice is not re-logged for unchanged current signature', () => {
  const result = buildCollaboratorSignatureNoticeData(
    { signatureImage: 'data:image/png;base64,abc' },
    {
      signatureImage: 'data:image/png;base64,abc',
      signatureNoticeAcceptedAt: new Date('2026-05-22T12:00:00.000Z'),
      signatureNoticeVersion: 'collaborator_signature_v1'
    }
  );

  assert.equal(result.shouldLogNotice, false);
  assert.equal(result.data.signatureImage, 'data:image/png;base64,abc');
});

test('collaborator signature notice fields are cleared when signature image is removed', () => {
  const result = buildCollaboratorSignatureNoticeData({
    signatureImage: null
  });

  assert.equal(result.shouldLogNotice, false);
  assert.equal(result.data.signatureImage, null);
  assert.equal(result.data.signatureNoticeAcceptedAt, null);
  assert.equal(result.data.signatureNoticeVersion, null);
});
