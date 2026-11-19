import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

// Guarda: nenhuma jornada real pode simular a API (page.route / route.fulfill).
test('jornadas reais não simulam a API', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith('.ts') && !name.endsWith('no-mocks.guard.real.spec.ts'));
  expect(files.length).toBeGreaterThan(0);
  for (const name of files) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    expect(source, name).not.toMatch(/\.route\(|routeFromHAR|\.fulfill\(/);
  }
});
