import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import env from '../config/env.js';
import { databaseUrlWithConnectionLimit } from './prisma-url.js';

export function createPrismaClient() {
  const databaseUrl = databaseUrlWithConnectionLimit(env.databaseUrl, env.databaseConnectionLimit);
  const options = {
    adapter: new PrismaPg({ connectionString: databaseUrl })
  };

  if (env.prismaSlowQueryMs > 0) {
    options.log = [{ emit: 'event', level: 'query' }];
  }

  return new PrismaClient(options);
}

const prisma = createPrismaClient();

if (env.prismaSlowQueryMs > 0) {
  prisma.$on('query', event => {
    if (event.duration < env.prismaSlowQueryMs) return;
    console.warn('[SLOW PRISMA QUERY]', {
      durationMs: event.duration,
      target: event.target
    });
  });
}

export default prisma;
