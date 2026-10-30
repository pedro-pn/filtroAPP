import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

import env from '../config/env.js';
import { buildDatabasePoolConfig } from './prisma-pool-config.js';
import { projectAccessExtension } from './projects/access-scope.js';

const { Pool } = pg;

export function createPrismaClient({ pool = new Pool(buildDatabasePoolConfig(env)) } = {}) {
  const options = {
    adapter: new PrismaPg(pool, { disposeExternalPool: true })
  };

  if (env.prismaSlowQueryMs > 0) {
    options.log = [{ emit: 'event', level: 'query' }];
  }

  const client = new PrismaClient(options);
  if (env.prismaSlowQueryMs > 0) {
    client.$on('query', event => {
      if (event.duration < env.prismaSlowQueryMs) return;
      console.warn('[SLOW PRISMA QUERY]', { durationMs: event.duration, target: event.target });
    });
  }
  return client.$extends(projectAccessExtension);
}

const databasePool = new Pool(buildDatabasePoolConfig(env));
const prisma = createPrismaClient({ pool: databasePool });

export function getDatabasePoolMetrics() {
  return {
    total: databasePool.totalCount,
    idle: databasePool.idleCount,
    waiting: databasePool.waitingCount,
    max: databasePool.options.max
  };
}

export default prisma;
