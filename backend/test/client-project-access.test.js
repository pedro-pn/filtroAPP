import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clientCanAccessProject,
  clientProjectAccessWhere
} from '../src/lib/client-project-access.js';

test('client access uses account username, not self-editable email', () => {
  const auth = {
    user: {
      username: '11222333000144',
      email: 'victim@example.com'
    }
  };

  assert.equal(
    clientCanAccessProject(auth, {
      managerOnly: false,
      clientCnpj: '00999888000177',
      clientEmailPrimary: 'victim@example.com',
      clientEmailCc: []
    }),
    false
  );
});

test('client access allows the provisioned CNPJ account for its projects', () => {
  const auth = {
    user: {
      username: '11.222.333/0001-44',
      email: 'changed@example.com'
    }
  };

  assert.equal(
    clientCanAccessProject(auth, {
      managerOnly: false,
      clientCnpj: '11222333000144',
      clientEmailPrimary: 'client@example.com',
      clientEmailCc: []
    }),
    true
  );
});

test('client access allows provisioned email usernames for signer/cc projects', () => {
  const auth = {
    user: {
      username: 'signer@example.com',
      email: 'changed@example.com'
    }
  };

  assert.equal(
    clientCanAccessProject(auth, {
      managerOnly: false,
      clientCnpj: '11222333000144',
      clientEmailPrimary: 'client@example.com',
      clientEmailCc: ['signer@example.com']
    }),
    true
  );
});

test('client access rejects soft-deleted projects', () => {
  const auth = {
    user: {
      username: 'signer@example.com',
      email: 'changed@example.com'
    }
  };

  assert.equal(
    clientCanAccessProject(auth, {
      deletedAt: new Date(),
      managerOnly: false,
      clientCnpj: '11222333000144',
      clientEmailPrimary: 'client@example.com',
      clientEmailCc: ['signer@example.com']
    }),
    false
  );
});

test('client project query filter ignores self-editable email', () => {
  assert.deepEqual(
    clientProjectAccessWhere({
      user: {
        username: '11222333000144',
        email: 'victim@example.com'
      }
    }),
    {
      managerOnly: false,
      OR: [
        { clientCnpj: '11222333000144' }
      ]
    }
  );
});
