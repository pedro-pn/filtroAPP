import { PrismaClient } from '@prisma/client';

import env from '../config/env.js';
import { databaseUrlWithConnectionLimit } from './prisma-url.js';

function prismaClientOptions() {
  const options = {};
  const databaseUrl = databaseUrlWithConnectionLimit(env.databaseUrl, env.databaseConnectionLimit);

  if (databaseUrl) {
    options.datasources = { db: { url: databaseUrl } };
  }
  if (env.prismaSlowQueryMs > 0) {
    options.log = [{ emit: 'event', level: 'query' }];
  }

  return options;
}

const prisma = new PrismaClient(prismaClientOptions());

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
