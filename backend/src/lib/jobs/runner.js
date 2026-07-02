import os from 'node:os';

import { Prisma } from '@prisma/client';

import prisma from '../prisma.js';

export const JOB_RUN_STATUS = {
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'
};

const DEFAULT_LOCK_TTL_MS = 60 * 60 * 1000;
const runningJobs = new Set();

function defaultLockOwner() {
  return `${os.hostname()}:${process.pid}`;
}

function nowFrom(options) {
  return typeof options.nowFn === 'function' ? options.nowFn() : new Date();
}

function durationMs(startedAt, finishedAt) {
  return Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

export function jobErrorText(error, maxLength = 4000) {
  return String(error?.stack || error?.message || error || 'Falha no job.').slice(0, maxLength);
}

function jsonValue(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_key, item) => (
    typeof item === 'bigint' ? item.toString() : item
  )));
}

function isUniqueConstraintError(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function acquireJobLock(name, {
  prismaClient = prisma,
  ttlMs = DEFAULT_LOCK_TTL_MS,
  owner = defaultLockOwner(),
  now = new Date()
} = {}) {
  if (!name) throw new TypeError('Job lock name is required.');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return { acquired: true, owner, expiresAt: null, disabled: true };
  }

  const expiresAt = new Date(now.getTime() + ttlMs);
  const update = await prismaClient.jobLock.updateMany({
    where: {
      name,
      OR: [
        { expiresAt: { lte: now } },
        { owner }
      ]
    },
    data: {
      owner,
      lockedAt: now,
      expiresAt
    }
  });
  if (update.count === 1) return { acquired: true, owner, expiresAt };

  try {
    await prismaClient.jobLock.create({
      data: {
        name,
        owner,
        lockedAt: now,
        expiresAt
      }
    });
    return { acquired: true, owner, expiresAt };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { acquired: false, owner, expiresAt: null };
    }
    throw error;
  }
}

export async function releaseJobLock(name, {
  prismaClient = prisma,
  owner
} = {}) {
  if (!name || !owner) return 0;
  const result = await prismaClient.jobLock.deleteMany({
    where: { name, owner }
  });
  return result.count;
}

async function recordSkippedJobRun(name, {
  prismaClient,
  metadata,
  reason,
  now
}) {
  return prismaClient.jobRun.create({
    data: {
      name,
      status: JOB_RUN_STATUS.SKIPPED,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      metadata: jsonValue(metadata),
      result: { skipped: true, reason }
    }
  });
}

export async function runTrackedJob(name, runFn, {
  prismaClient = prisma,
  metadata = null,
  lock = true,
  lockTtlMs = DEFAULT_LOCK_TTL_MS,
  recordSkipped = true,
  logger = console,
  nowFn
} = {}) {
  if (!name) throw new TypeError('Job name is required.');
  if (typeof runFn !== 'function') throw new TypeError('Job runner must be a function.');

  const startedAt = nowFrom({ nowFn });
  if (runningJobs.has(name)) {
    if (recordSkipped) {
      await recordSkippedJobRun(name, {
        prismaClient,
        metadata,
        reason: 'in-process',
        now: startedAt
      });
    }
    return { status: JOB_RUN_STATUS.SKIPPED, skipped: true, reason: 'in-process' };
  }

  runningJobs.add(name);
  let lockState = null;
  let run = null;

  try {
    if (lock) {
      lockState = await acquireJobLock(name, {
        prismaClient,
        ttlMs: lockTtlMs,
        now: startedAt
      });
      if (!lockState.acquired) {
        if (recordSkipped) {
          await recordSkippedJobRun(name, {
            prismaClient,
            metadata,
            reason: 'lock-held',
            now: startedAt
          });
        }
        return { status: JOB_RUN_STATUS.SKIPPED, skipped: true, reason: 'lock-held' };
      }
    }

    run = await prismaClient.jobRun.create({
      data: {
        name,
        status: JOB_RUN_STATUS.RUNNING,
        startedAt,
        metadata: jsonValue(metadata)
      }
    });

    const result = await runFn();
    const finishedAt = nowFrom({ nowFn });
    await prismaClient.jobRun.update({
      where: { id: run.id },
      data: {
        status: JOB_RUN_STATUS.COMPLETED,
        finishedAt,
        durationMs: durationMs(startedAt, finishedAt),
        result: jsonValue(result),
        error: null
      }
    });
    return { status: JOB_RUN_STATUS.COMPLETED, result };
  } catch (error) {
    const finishedAt = nowFrom({ nowFn });
    if (run) {
      await prismaClient.jobRun.update({
        where: { id: run.id },
        data: {
          status: JOB_RUN_STATUS.FAILED,
          finishedAt,
          durationMs: durationMs(startedAt, finishedAt),
          error: jobErrorText(error)
        }
      }).catch(updateError => {
        logger.error('Falha ao registrar execução de job com erro.', updateError);
      });
    }
    throw error;
  } finally {
    runningJobs.delete(name);
    if (lock && lockState?.owner && !lockState.disabled) {
      await releaseJobLock(name, {
        prismaClient,
        owner: lockState.owner
      }).catch(error => {
        logger.error('Falha ao liberar lock de job.', { name, error });
      });
    }
  }
}
