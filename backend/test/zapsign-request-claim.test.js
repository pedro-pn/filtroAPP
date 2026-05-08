import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimZapSignRequest,
  claimZapSignRequests,
  persistZapSignRequest,
  releaseZapSignRequestClaim,
  releaseZapSignRequestClaims,
  staleZapSignClaimBefore
} from '../src/lib/zapsign-request-claim.js';

test('staleZapSignClaimBefore uses a 15 minute default window', () => {
  assert.equal(
    staleZapSignClaimBefore(new Date('2026-05-08T12:00:00.000Z')).toISOString(),
    '2026-05-08T11:45:00.000Z'
  );
});

test('claimZapSignRequest claims only approved reports without active signature token', async () => {
  const now = new Date('2026-05-08T12:00:00.000Z');
  let updateManyArgs;
  const prismaClient = {
    report: {
      updateMany: async args => {
        updateManyArgs = args;
        return { count: 1 };
      }
    }
  };

  const claim = await claimZapSignRequest(prismaClient, 'report-1', now);

  assert.deepEqual(claim, { claimed: true, claimTime: now });
  assert.deepEqual(updateManyArgs, {
    where: {
      id: 'report-1',
      status: 'APPROVED',
      zapsignDocToken: null,
      zapsignSignedAt: null,
      OR: [
        { zapsignRequestedAt: null },
        { zapsignRequestedAt: { lt: new Date('2026-05-08T11:45:00.000Z') } }
      ]
    },
    data: {
      zapsignRequestedAt: now
    }
  });
});

test('claimZapSignRequest reports an in-flight concurrent request', async () => {
  const prismaClient = {
    report: {
      updateMany: async () => ({ count: 0 })
    }
  };

  const claim = await claimZapSignRequest(prismaClient, 'report-1', new Date('2026-05-08T12:00:00.000Z'));

  assert.equal(claim.claimed, false);
});

test('persistZapSignRequest only writes the ZapSign token for the matching claim', async () => {
  const claimTime = new Date('2026-05-08T12:00:00.000Z');
  let updateManyArgs;
  const prismaClient = {
    report: {
      updateMany: async args => {
        updateManyArgs = args;
        return { count: 1 };
      }
    }
  };

  const persisted = await persistZapSignRequest(prismaClient, 'report-1', claimTime, {
    zapsignDocToken: 'doc-token'
  });

  assert.equal(persisted, true);
  assert.deepEqual(updateManyArgs, {
    where: {
      id: 'report-1',
      status: 'APPROVED',
      zapsignDocToken: null,
      zapsignSignedAt: null,
      zapsignRequestedAt: claimTime
    },
    data: {
      zapsignDocToken: 'doc-token'
    }
  });
});

test('claimZapSignRequests claims every selected approved report before batch signing', async () => {
  const now = new Date('2026-05-08T12:00:00.000Z');
  let updateManyArgs;
  const prismaClient = {
    report: {
      updateMany: async args => {
        updateManyArgs = args;
        return { count: 2 };
      }
    }
  };

  const claim = await claimZapSignRequests(prismaClient, ['report-1', 'report-2', 'report-1'], now);

  assert.deepEqual(claim, { claimed: true, claimTime: now, claimedCount: 2 });
  assert.deepEqual(updateManyArgs, {
    where: {
      id: { in: ['report-1', 'report-2'] },
      status: 'APPROVED',
      zapsignDocToken: null,
      zapsignSignedAt: null,
      OR: [
        { zapsignRequestedAt: null },
        { zapsignRequestedAt: { lt: new Date('2026-05-08T11:45:00.000Z') } }
      ]
    },
    data: {
      zapsignRequestedAt: now
    }
  });
});

test('claimZapSignRequests reports a partial batch claim as not claimed', async () => {
  const prismaClient = {
    report: {
      updateMany: async () => ({ count: 1 })
    }
  };

  const claim = await claimZapSignRequests(prismaClient, ['report-1', 'report-2'], new Date('2026-05-08T12:00:00.000Z'));

  assert.equal(claim.claimed, false);
  assert.equal(claim.claimedCount, 1);
});

test('releaseZapSignRequestClaims clears only matching batch claims', async () => {
  const claimTime = new Date('2026-05-08T12:00:00.000Z');
  let updateManyArgs;
  const prismaClient = {
    report: {
      updateMany: async args => {
        updateManyArgs = args;
        return { count: 2 };
      }
    }
  };

  await releaseZapSignRequestClaims(prismaClient, ['report-1', 'report-2', 'report-1'], claimTime);

  assert.deepEqual(updateManyArgs, {
    where: {
      id: { in: ['report-1', 'report-2'] },
      zapsignDocToken: null,
      zapsignRequestedAt: claimTime
    },
    data: {
      zapsignRequestedAt: null
    }
  });
});

test('releaseZapSignRequestClaim only clears the matching in-flight claim', async () => {
  const claimTime = new Date('2026-05-08T12:00:00.000Z');
  let updateManyArgs;
  const prismaClient = {
    report: {
      updateMany: async args => {
        updateManyArgs = args;
        return { count: 1 };
      }
    }
  };

  await releaseZapSignRequestClaim(prismaClient, 'report-1', claimTime);

  assert.deepEqual(updateManyArgs, {
    where: {
      id: 'report-1',
      zapsignDocToken: null,
      zapsignRequestedAt: claimTime
    },
    data: {
      zapsignRequestedAt: null
    }
  });
});
