import fs from 'node:fs/promises';
import prisma from '../src/lib/prisma.js';
import { reportJobRunVolume } from '../src/lib/operations/job-run-volume.js';

const arg = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
try {
  const report = await reportJobRunVolume({ days: Number(arg('days') ?? 7) });
  if (arg('output')) await fs.writeFile(arg('output'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch {
  // SQL/driver errors can contain paths and connection details. Keep CLI output
  // safe to attach to operational evidence, and never emit an empty success.
  if (arg('output')) await fs.writeFile(arg('output'), JSON.stringify({ complete: false, readOnly: null,
    error: 'JOB_VOLUME_REPORT_FAILED' }, null, 2) + '\n').catch(() => {});
  console.error('Não foi possível gerar o volume de JobRun. Use --days=1..90 e confira a conexão/permissão de leitura.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
