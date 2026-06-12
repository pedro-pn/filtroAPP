import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearPendingProjectLegacyExternalSignatureState,
  shouldProvisionProjectClientAccounts,
  withoutProjectLegacyExternalSignatureState
} from '../src/lib/project-visibility.js';

test('shouldProvisionProjectClientAccounts skips manager-only projects', () => {
  assert.equal(shouldProvisionProjectClientAccounts({ managerOnly: true }), false);
  assert.equal(shouldProvisionProjectClientAccounts({ managerOnly: false, registrationPending: true }), false);
  assert.equal(shouldProvisionProjectClientAccounts({ managerOnly: false }), true);
});

test('withoutProjectLegacyExternalSignatureState removes legacy external signature markers', () => {
  assert.deepEqual(
    withoutProjectLegacyExternalSignatureState({
      keep: 'value',
      __zapSignSigners: [{ email: 'client@example.com' }],
      __zapSignSignatureProgress: { total: 1 },
      __zapSignBatchMainDocToken: 'main-token',
      __zapSignBatchDocTokens: ['main-token', 'extra-token']
    }),
    { keep: 'value' }
  );
});

test('clearPendingProjectLegacyExternalSignatureState clears pending external signing data for project reports', async () => {
  const updates = [];
  const tx = {
    report: {
      findMany: async args => {
        assert.deepEqual(args.where, {
          projectId: 'project-1',
          zapsignSignedAt: null,
          OR: [
            { zapsignDocToken: { not: null } },
            { zapsignSignerToken: { not: null } },
            { zapsignRequestedAt: { not: null } },
            { zapsignDocUrl: { not: null } }
          ]
        });
        return [
          {
            id: 'report-1',
            specialConditions: {
              keep: 'value',
              __zapSignSignatureProgress: { total: 1 }
            }
          }
        ];
      },
      update: async args => {
        updates.push(args);
        return {};
      }
    }
  };

  const count = await clearPendingProjectLegacyExternalSignatureState(tx, 'project-1');

  assert.equal(count, 1);
  assert.deepEqual(updates, [
    {
      where: { id: 'report-1' },
      data: {
        zapsignDocToken: null,
        zapsignSignerToken: null,
        zapsignRequestedAt: null,
        zapsignSignedAt: null,
        zapsignDocUrl: null,
        specialConditions: { keep: 'value' }
      }
    }
  ]);
});
