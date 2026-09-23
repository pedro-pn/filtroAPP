import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('resposta obrigatória de finalização identifica e sinaliza as opções do serviço', async () => {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });

  try {
    const { ServiceFields } = await server.ssrLoadModule('/src/components/reports/ServiceFields.tsx');
    const props = {
      serviceType: 'limpeza',
      data: {},
      onChange() {},
      units: [],
      manometers: [],
      groupKey: 'servico-1',
      hideUploads: true,
      hideNotes: true
    };

    const invalid = renderToStaticMarkup(createElement(ServiceFields, { ...props, invalidKey: 'finalized' }));
    assert.match(invalid, /field-group field-invalid service-finalized-field/);
    assert.match(invalid, /role="radiogroup"[^>]*aria-labelledby="svc-servico-1-finalized-label"/);
    assert.match(invalid, /data-invalid-target="servico-1:finalized"[^>]*aria-invalid="true"/);
    assert.match(invalid, /Selecione Sim ou Não\./);

    const answeredNo = renderToStaticMarkup(createElement(ServiceFields, { ...props, data: { finalized: false } }));
    assert.match(answeredNo, /name="finalizado-servico-1"[^>]*checked=""[^>]*\/><span>Não/);
    assert.doesNotMatch(answeredNo, /Selecione Sim ou Não\./);
  } finally {
    await server.close();
  }
});
