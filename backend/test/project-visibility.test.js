import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearPendingProjectZapSignState,
  shouldIgnoreExternalSigningForReport,
  shouldProvisionProjectClientAccounts,
  withoutProjectZapSignState
} from '../src/lib/project-visibility.js';
import {
  ZAPSIGN_BATCH_DOC_TOKENS_KEY,
  ZAPSIGN_BATCH_MAIN_DOC_TOKEN_KEY,
  ZAPSIGN_SIGNATURE_PROGRESS_KEY,
  ZAPSIGN_SIGNERS_KEY
} from '../src/lib/zapsign-progress.js';

test('shouldProvisionProjectClientAccounts skips manager-only projects', () => {
  assert.equal(shouldProvisionProjectClientAccounts({ managerOnly: true }), false);
  assert.equal(shouldProvisionProjectClientAccounts({ managerOnly: false }), true);
});

test('shouldIgnoreExternalSigningForReport blocks manager-only reports', () => {
  assert.equal(shouldIgnoreExternalSigningForReport({ project: { managerOnly: true } }), true);
  assert.equal(shouldIgnoreExternalSigningForReport({ project: { managerOnly: false } }), false);
});

test('withoutProjectZapSignState removes every ZapSign marker', () => {
  assert.deepEqual(
    withoutProjectZapSignState({
      keep: 'value',
      [ZAPSIGN_SIGNERS_KEY]: [{ email: 'client@example.com' }],
      [ZAPSIGN_SIGNATURE_PROGRESS_KEY]: { total: 1 },
      [ZAPSIGN_BATCH_MAIN_DOC_TOKEN_KEY]: 'main-token',
      [ZAPSIGN_BATCH_DOC_TOKENS_KEY]: ['main-token', 'extra-token']
    }),
    { keep: 'value' }
  );
});

test('clearPendingProjectZapSignState clears pending signing data for project reports', async () => {
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
              [ZAPSIGN_SIGNATURE_PROGRESS_KEY]: { total: 1 }
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

  const count = await clearPendingProjectZapSignState(tx, 'project-1');

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
