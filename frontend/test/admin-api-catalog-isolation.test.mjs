import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('API catalog loads without backend packages, even when they are installed locally', () => {
  const catalogUrl = new URL('../../backend/src/lib/api-credentials/catalog.js', import.meta.url).href;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
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
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
