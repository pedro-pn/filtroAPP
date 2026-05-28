import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clientCanAccessProject,
  clientProjectAccessWhere,
  clientProjectAccessWhereWithSigners,
  trustedClientAccessEmailsForUser,
  trustedClientAccessScopeForUser
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

test('client access allows provisioned email usernames for signer-only projects', () => {
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
      clientEmailCc: [],
      clientSigners: [{ name: 'Fiscal', email: 'signer@example.com' }]
    }),
    true
  );
});

test('client access allows provisioned email usernames for primary projects', () => {
  const auth = {
    user: {
      username: 'client@example.com',
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

test('client project query filter includes signer-only projects for email usernames', async () => {
  const prisma = {
    project: {
      findMany: async () => [
        {
          id: 'project-signer',
          clientSigners: [{ name: 'Fiscal', email: 'signer@example.com' }]
        },
        {
          id: 'project-other',
          clientSigners: [{ name: 'Fiscal', email: 'other@example.com' }]
        }
      ]
    }
  };

  assert.deepEqual(
    await clientProjectAccessWhereWithSigners(prisma, {
      user: {
        username: 'signer@example.com',
        email: 'changed@example.com'
      }
    }),
    {
      managerOnly: false,
      OR: [
        { clientEmailPrimary: { equals: 'signer@example.com', mode: 'insensitive' } },
        { clientEmailCc: { hasSome: ['signer@example.com'] } },
        { id: { in: ['project-signer'] } }
      ]
    }
  );
});

test('client access allows verified provisioned email on legacy CNPJ username accounts', () => {
  const auth = {
    user: {
      username: '11222333000144',
      email: 'client@example.com',
      emailVerifiedAt: new Date('2026-05-28T12:00:00.000Z'),
      role: 'CLIENT',
      accountType: 'CLIENT'
    }
  };

  assert.equal(
    clientCanAccessProject(auth, {
      managerOnly: false,
      clientCnpj: '99888777000166',
      clientEmailPrimary: 'client@example.com',
      clientEmailCc: []
    }),
    true
  );
  assert.equal(
    clientCanAccessProject(auth, {
      managerOnly: false,
      clientCnpj: '99888777000166',
      clientEmailPrimary: 'other@example.com',
      clientEmailCc: ['client@example.com']
    }),
    true
  );
});

test('client access allows archived projects linked to the client', () => {
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
    true
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
        { clientCnpj: { in: ['11222333000144'] } }
      ]
    }
  );
});

test('client project query filter includes primary and cc projects for email usernames', () => {
  assert.deepEqual(
    clientProjectAccessWhere({
      user: {
        username: 'client@example.com',
        email: 'changed@example.com'
      }
    }),
    {
      managerOnly: false,
      OR: [
        { clientEmailPrimary: { equals: 'client@example.com', mode: 'insensitive' } },
        { clientEmailCc: { hasSome: ['client@example.com'] } }
      ]
    }
  );
});

test('client project query filter includes verified provisioned email for legacy CNPJ username accounts', () => {
  assert.deepEqual(
    clientProjectAccessWhere({
      user: {
        username: '11222333000144',
        email: 'client@example.com',
        emailVerifiedAt: new Date('2026-05-28T12:00:00.000Z'),
        role: 'CLIENT',
        accountType: 'CLIENT'
      }
    }),
    {
      managerOnly: false,
      OR: [
        { clientCnpj: { in: ['11222333000144'] } },
        { clientEmailPrimary: { equals: 'client@example.com', mode: 'insensitive' } },
        { clientEmailCc: { hasSome: ['client@example.com'] } }
      ]
    }
  );
});

test('client project query filter trusts legacy CNPJ account email when a project links that CNPJ and email', async () => {
  const calls = [];
  const prisma = {
    project: {
      findMany: async args => {
        calls.push(args);
        if (args.where?.clientCnpj) {
          return [{
            clientEmailPrimary: 'legacy@example.com',
            clientEmailCc: [],
            clientSigners: []
          }];
        }
        return [];
      }
    }
  };

  assert.deepEqual(
    await clientProjectAccessWhereWithSigners(prisma, {
      user: {
        username: '11222333000144',
        email: 'legacy@example.com',
        role: 'CLIENT',
        accountType: 'CLIENT'
      }
    }),
    {
      managerOnly: false,
      OR: [
        { clientCnpj: { in: ['11222333000144'] } },
        { clientEmailPrimary: { equals: 'legacy@example.com', mode: 'insensitive' } },
        { clientEmailCc: { hasSome: ['legacy@example.com'] } }
      ]
    }
  );
  assert.deepEqual(calls[0].where.clientCnpj, { in: ['11222333000144'] });
});

test('client project access can use trusted emails populated by authentication middleware', () => {
  const auth = {
    user: {
      username: '11222333000144',
      email: 'legacy@example.com',
      trustedClientEmails: ['legacy@example.com'],
      role: 'CLIENT',
      accountType: 'CLIENT'
    }
  };

  assert.equal(
    clientCanAccessProject(auth, {
      managerOnly: false,
      clientCnpj: '99888777000166',
      clientEmailPrimary: 'legacy@example.com',
      clientEmailCc: []
    }),
    true
  );
});

test('client project access can use trusted CNPJs from duplicate email accounts', () => {
  const auth = {
    user: {
      username: 'client@example.com',
      email: 'client@example.com',
      trustedClientCnpjs: ['11222333000144', '99888777000166'],
      role: 'CLIENT',
      accountType: 'CLIENT'
    }
  };

  assert.equal(
    clientCanAccessProject(auth, {
      managerOnly: false,
      clientCnpj: '99888777000166',
      clientEmailPrimary: 'other@example.com',
      clientEmailCc: []
    }),
    true
  );
});

test('trusted client scope includes CNPJs from duplicate client users with the same trusted email', async () => {
  const prisma = {
    user: {
      findMany: async args => {
        assert.equal(args.where.OR[1].email.equals, 'client@example.com');
        return [
          { username: 'client@example.com', clientCnpj: '11222333000144' },
          { username: '99888777000166', clientCnpj: '99888777000166' }
        ];
      }
    }
  };

  assert.deepEqual(
    await trustedClientAccessScopeForUser(prisma, {
      username: 'client@example.com',
      email: 'client@example.com',
      role: 'CLIENT',
      accountType: 'CLIENT'
    }),
    {
      emails: ['client@example.com'],
      cnpjs: ['11222333000144', '99888777000166']
    }
  );
});

test('trusted client emails exclude self-edited email when no project links the account CNPJ to it', async () => {
  const prisma = {
    project: {
      findMany: async () => [{
        clientEmailPrimary: 'real@example.com',
        clientEmailCc: [],
        clientSigners: []
      }]
    }
  };

  assert.deepEqual(
    await trustedClientAccessEmailsForUser(prisma, {
      username: '11222333000144',
      email: 'victim@example.com',
      role: 'CLIENT',
      accountType: 'CLIENT'
    }),
    []
  );
});
