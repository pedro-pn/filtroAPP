import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureClientAccountForProject,
  ensureClientCcAccounts
} from '../src/lib/client-account.js';

function emailEquals(actual, expected) {
  return String(actual || '').trim().toLowerCase() === String(expected || '').trim().toLowerCase();
}

function createPrismaMock(initialUsers = [], options = {}) {
  const users = initialUsers.map(user => ({
    isActive: true,
    accountType: 'CLIENT',
    moduleRoles: [],
    ...user
  }));
  const calls = {
    created: [],
    updated: [],
    updateMany: [],
    projectFindFirst: []
  };

  return {
    calls,
    users,
    user: {
      findFirst: async args => {
        const where = args.where || {};
        let matches = users.filter(user => {
          if (where.role && user.role !== where.role) return false;
          if (where.username?.equals) return emailEquals(user.username, where.username.equals);
          if (where.email?.equals) return emailEquals(user.email, where.email.equals);
          return true;
        });
        if (Array.isArray(args.orderBy)) {
          matches = matches.sort((a, b) => Number(b.isActive) - Number(a.isActive));
        }
        return matches[0] || null;
      },
      create: async args => {
        const user = {
          id: `created-${users.length + 1}`,
          role: 'CLIENT',
          isActive: true,
          accountType: 'CLIENT',
          moduleRoles: [],
          ...args.data
        };
        users.push(user);
        calls.created.push(args);
        return user;
      },
      update: async args => {
        const user = users.find(item => item.id === args.where.id);
        assert.ok(user, `Usuário ${args.where.id} deveria existir`);
        Object.assign(user, args.data);
        calls.updated.push(args);
        return user;
      },
      updateMany: async args => {
        calls.updateMany.push(args);
        let count = 0;
        for (const user of users) {
          if (args.where.role && user.role !== args.where.role) continue;
          if (args.where.id?.not && user.id === args.where.id.not) continue;
          const or = args.where.OR || [];
          if (or.length && !or.some(condition => (
            (condition.username?.equals && emailEquals(user.username, condition.username.equals))
            || (condition.email?.equals && emailEquals(user.email, condition.email.equals))
          ))) continue;
          Object.assign(user, args.data);
          count += 1;
        }
        return { count };
      }
    },
    project: {
      findFirst: async args => {
        calls.projectFindFirst.push(args);
        return options.projectFindFirstResult || null;
      }
    }
  };
}

const baseProject = {
  id: 'project-1',
  code: 'P-1',
  name: 'Projeto 1',
  contractCode: 'C-1',
  clientName: 'Cliente',
  clientCnpj: '11222333000144',
  clientEmailPrimary: ' Cliente@Example.com ',
  clientEmailCc: []
};

test('primary client account is created with email as the single login username', async () => {
  const prisma = createPrismaMock();

  const result = await ensureClientAccountForProject(prisma, baseProject, { notify: false });

  assert.equal(result.created, true);
  assert.equal(result.user.username, 'cliente@example.com');
  assert.equal(result.user.email, 'cliente@example.com');
  assert.equal(result.user.clientCnpj, '11222333000144');
  assert.equal(prisma.calls.created.length, 1);
  assert.equal(prisma.calls.created[0].data.username, 'cliente@example.com');
});

test('primary project reuses an existing cc/signer client account with the same email', async () => {
  const prisma = createPrismaMock([{
    id: 'user-cc',
    username: 'cliente@example.com',
    email: 'cliente@example.com',
    name: 'Cliente em cópia',
    role: 'CLIENT'
  }]);

  const result = await ensureClientAccountForProject(prisma, baseProject, { notify: false });

  assert.equal(result.created, false);
  assert.equal(result.user.id, 'user-cc');
  assert.equal(result.user.username, 'cliente@example.com');
  assert.equal(result.user.name, 'Cliente');
  assert.equal(prisma.calls.created.length, 0);
});

test('primary project migrates an old CNPJ client account to the email login', async () => {
  const prisma = createPrismaMock([{
    id: 'user-cnpj',
    username: '11222333000144',
    email: 'cliente@example.com',
    name: 'Cliente antigo',
    role: 'CLIENT'
  }]);

  const result = await ensureClientAccountForProject(prisma, baseProject, { notify: false });

  assert.equal(result.created, false);
  assert.equal(result.user.id, 'user-cnpj');
  assert.equal(result.user.username, 'cliente@example.com');
  assert.equal(result.user.email, 'cliente@example.com');
});

test('linking one email deactivates duplicate client accounts for that same email', async () => {
  const prisma = createPrismaMock([{
    id: 'keep',
    username: 'cliente@example.com',
    email: 'cliente@example.com',
    role: 'CLIENT'
  }, {
    id: 'duplicate',
    username: '99888777000166',
    email: 'cliente@example.com',
    role: 'CLIENT'
  }]);

  const result = await ensureClientAccountForProject(prisma, baseProject, { notify: false });

  assert.equal(result.user.id, 'keep');
  assert.equal(prisma.users.find(user => user.id === 'keep').isActive, true);
  assert.equal(prisma.users.find(user => user.id === 'duplicate').isActive, false);
});

test('removed cc account stays active when the email is primary on another project', async () => {
  const prisma = createPrismaMock([{
    id: 'cc-user',
    username: 'cliente@example.com',
    email: 'cliente@example.com',
    role: 'CLIENT'
  }], {
    projectFindFirstResult: { id: 'other-project' }
  });

  await ensureClientCcAccounts(prisma, {
    ...baseProject,
    clientEmailPrimary: 'other@example.com',
    clientEmailCc: []
  }, {
    notify: false,
    previousProject: {
      clientEmailCc: ['cliente@example.com']
    }
  });

  assert.equal(prisma.calls.updateMany.length, 0);
  assert.deepEqual(prisma.calls.projectFindFirst[0].where.OR, [
    { clientEmailPrimary: { equals: 'cliente@example.com', mode: 'insensitive' } },
    { clientEmailCc: { has: 'cliente@example.com' } }
  ]);
});

test('old primary client account is deactivated when no project still uses that email', async () => {
  const prisma = createPrismaMock([{
    id: 'old-primary',
    username: 'old@example.com',
    email: 'old@example.com',
    role: 'CLIENT'
  }]);

  await ensureClientAccountForProject(prisma, {
    ...baseProject,
    clientEmailPrimary: 'new@example.com'
  }, {
    notify: false,
    previousProject: {
      clientEmailPrimary: 'old@example.com',
      clientEmailCc: []
    }
  });

  assert.equal(prisma.users.find(user => user.id === 'old-primary').isActive, false);
  assert.deepEqual(prisma.calls.projectFindFirst[0].where.OR, [
    { clientEmailPrimary: { equals: 'old@example.com', mode: 'insensitive' } },
    { clientEmailCc: { has: 'old@example.com' } }
  ]);
});
