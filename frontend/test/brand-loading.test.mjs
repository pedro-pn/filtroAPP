import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('loading logo preserves accessible status, honest progress and compact shared controls', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { BrandLoading } = await server.ssrLoadModule('/src/components/brand/BrandLoading.tsx');
    const { Spinner } = await server.ssrLoadModule('/src/components/ui/ds/Spinner.tsx');
    const render = props => renderToStaticMarkup(createElement(BrandLoading, props));
    const spin = render({ mode: 'spin', label: 'Carregando projeto' });
    assert.match(spin, /role="status"/);
    assert.match(spin, /aria-label="Carregando projeto"/);
    assert.match(spin, /fv-brand-loading__spin-ring/);
    assert.doesNotMatch(spin, /aria-valuenow/);
    const automatic = render({});
    assert.match(automatic, /fv-brand-loading__spin-ring/);
    assert.doesNotMatch(automatic, /aria-valuenow/);
    const indeterminate = render({ mode: 'progress' });
    assert.match(indeterminate, /progress-color--indeterminate/);
    assert.doesNotMatch(indeterminate, /aria-valuenow/);
    const progress = render({ mode: 'spin', progress: 140 });
    assert.match(progress, /role="progressbar"/);
    assert.match(progress, /aria-valuenow="100"/);
    assert.doesNotMatch(progress, /progress-color--indeterminate/);
    assert.match(progress, /--fv-brand-loading-fill:100%/);
    assert.match(render({ progress: 33 }), /--fv-brand-loading-fill:33%/);
    assert.match(render({ progress: 0 }), /aria-valuenow="0"/);
    assert.match(render({ progress: -3 }), /aria-valuenow="0"/);
    for (const progress of [NaN, Infinity, -Infinity]) {
      const unknown = render({ progress });
      assert.match(unknown, /fv-brand-loading__spin-ring/);
      assert.doesNotMatch(unknown, /aria-valuenow/);
    }
    assert.doesNotMatch(render({ decorative: true }), /role="status"/);
    const compact = renderToStaticMarkup(createElement(Spinner, { decorative: true, size: 'sm' }));
    assert.match(compact, /fv-brand-loading--inline/);
    assert.doesNotMatch(compact, /role="status"/);
  } finally { await server.close(); }
});
