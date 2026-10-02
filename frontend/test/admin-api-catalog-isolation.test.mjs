import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('API catalog loads without backend packages, even when they are installed locally', async () => {
  const catalogUrl = new URL('../../backend/src/lib/api-credentials/catalog.js', import.meta.url).href;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  await execFileAsync(process.execPath, ['--input-type=module', '--eval', `
    import { registerHooks, isBuiltin } from 'node:module';
    import assert from 'node:assert/strict';
    registerHooks({
      resolve(specifier, context, nextResolve) {
        assert.ok(isBuiltin(specifier) || /^(?:\\.{1,2}\\/|\\/|file:)/.test(specifier),
          'API catalog must not load an external package: ' + specifier);
        return nextResolve(specifier, context);
      }
    });
    const { assertApiCatalogIntegrity, publicApiOperations } = await import(${JSON.stringify(catalogUrl)});
    assertApiCatalogIntegrity();
    assert.ok(publicApiOperations().some(item => item.operationId === 'operational.ReportService.list'));
  `], { encoding: 'utf8', timeout: 10000, env });
});
