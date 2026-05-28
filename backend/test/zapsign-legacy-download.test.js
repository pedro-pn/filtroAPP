import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ReportStatus, ReportType } from '@prisma/client';

import env from '../src/config/env.js';
import { resolveSignedPdf } from '../src/routes/resources/reports.js';
import { downloadSignedZapSignDocument } from '../src/lib/zapsign.js';

const completePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

test('downloadSignedZapSignDocument falls back to direct download when legacy auth is not configured', async t => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async url => {
    calls.push(String(url));
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  };

  const buffer = await downloadSignedZapSignDocument('https://signed.example.com/report.pdf');

  assert.deepEqual(calls, ['https://signed.example.com/report.pdf']);
  assert.deepEqual([...buffer], [1, 2, 3]);
});

test('resolveSignedPdf uses cached legacy ZapSign PDF before calling ZapSign', async t => {
  const originalReportsDir = env.reportsDir;
  const originalFetch = globalThis.fetch;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zapsign-cache-test-'));
  env.reportsDir = dir;
  t.after(async () => {
    env.reportsDir = originalReportsDir;
    globalThis.fetch = originalFetch;
    await fs.rm(dir, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(dir, '_zapsign-assinados'), { recursive: true });
  await fs.writeFile(path.join(dir, '_zapsign-assinados', 'legacy-report-1.pdf'), completePdf);
  globalThis.fetch = async () => {
    throw new Error('ZapSign não deve ser chamada quando existe cache local.');
  };

  const file = await resolveSignedPdf({
    id: 'legacy-report-1',
    status: ReportStatus.SIGNED,
    reportType: ReportType.RDO,
    sequenceNumber: 42,
    reportDate: '2026-05-20',
    zapsignDocToken: 'legacy-token',
    zapsignDocUrl: 'https://signed.example.com/expired.pdf',
    project: {
      code: 'P-1',
      name: 'Projeto 1'
    }
  });

  assert.match(file.fileName, /\.pdf$/);
  assert.deepEqual(file.buffer, completePdf);
});
