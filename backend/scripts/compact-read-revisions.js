import prisma from '../src/lib/prisma.js';
import { previewReadRevisionCompaction, compactReadRevisions } from '../src/lib/operations/read-revision-maintenance.js';

const argument = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
const input = {
  ...(argument('min-age-hours') === undefined ? {} : { minAgeHours: Number(argument('min-age-hours')) }),
  ...(argument('batch-size') === undefined ? {} : { batchSize: Number(argument('batch-size')) })
};
const apply = process.argv.includes('--apply');
try {
  const result = apply ? await compactReadRevisions(input) : await previewReadRevisionCompaction(input);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', result }, null, 2));
} finally { await prisma.$disconnect(); }
