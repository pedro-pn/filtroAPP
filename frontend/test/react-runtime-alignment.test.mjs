import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('react e react-dom usam a mesma versão de runtime', () => {
  assert.equal(
    packageJson.dependencies.react,
    packageJson.dependencies['react-dom'],
    'package.json deve manter react e react-dom na mesma versão'
  );
  assert.equal(
    packageLock.packages['node_modules/react'].version,
    packageLock.packages['node_modules/react-dom'].version,
    'package-lock.json deve resolver react e react-dom para a mesma versão'
  );
});
