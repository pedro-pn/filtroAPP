import assert from 'node:assert/strict';
import test from 'node:test';

import { collaboratorSchema } from '../src/routes/resources/collaborators.js';

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
