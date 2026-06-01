import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import env from '../src/config/env.js';
import { organizePhotos } from '../src/lib/report-docx.js';
import { readStoredImageAsset, resolveStoredUploadPath, uploadRelativePathFromSource } from '../src/lib/stored-image.js';

test('stored upload resolver rejects traversal outside reports volume', async t => {
  const originalReportsDir = env.reportsDir;
  const originalUploadDir = env.uploadDir;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rdo-upload-root-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'rdo-upload-outside-'));
  const outsideFile = path.join(outside, 'package.json');
  await fs.writeFile(outsideFile, '{"secret":true}');
  env.reportsDir = root;
  env.uploadDir = root;
  t.after(async () => {
    env.reportsDir = originalReportsDir;
    env.uploadDir = originalUploadDir;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  const traversalUrl = `/relatorios/../${path.basename(outside)}/package.json`;
  const encodedTraversalUrl = `/relatorios/%2e%2e/${path.basename(outside)}/package.json`;
  const report = {
    reportType: 'RDO',
    sequenceNumber: 7,
    reportDate: '2026-06-01',
    specialConditions: {
      generalUploads: [{ url: traversalUrl }]
    },
    services: []
  };

  assert.equal(uploadRelativePathFromSource(traversalUrl), '');
  assert.equal(uploadRelativePathFromSource(encodedTraversalUrl), '');
  assert.equal(resolveStoredUploadPath(traversalUrl), null);
  assert.equal(resolveStoredUploadPath(encodedTraversalUrl), null);
  assert.equal(await readStoredImageAsset(traversalUrl), null);

  const urlMap = await organizePhotos(report, 'Missao Segura');
  const outsideStillExists = await fs.stat(outsideFile).then(stat => stat.isFile()).catch(() => false);
  const organizedDir = path.join(root, 'Missao Segura', 'Registros Fotográficos', 'RDO');
  const organizedFiles = await fs.readdir(organizedDir).catch(() => []);

  assert.equal(outsideStillExists, true);
  assert.equal(urlMap.size, 0);
  assert.deepEqual(organizedFiles, []);
});
