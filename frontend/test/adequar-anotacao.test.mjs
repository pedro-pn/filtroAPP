import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

async function carregar() {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const { AdequarAnotacaoButton } = await server.ssrLoadModule('/src/components/anotacoes/AdequarAnotacaoButton.tsx');
  const { AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.ts');
  return { server, AdequarAnotacaoButton, AuthContext };
}

function renderizar({ AdequarAnotacaoButton, AuthContext }, { roles, config, valor = 'Sistema 52300 step 01' }) {
  const client = new QueryClient();
  if (config) client.setQueryData(['anotacoes', 'config'], config);
  const auth = roles ? { user: { id: 'u1', name: 'Teste', moduleRoles: roles } } : null;
  const botao = createElement(AdequarAnotacaoButton, { valor, campo: 'Atividades do dia', onAplicar: () => {} });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    auth ? createElement(AuthContext.Provider, { value: auth }, botao) : botao));
}

test('"Adequar para relatório": só gestor/coordenador do RDO e só com a OpenAI configurada no servidor', async () => {
  const mod = await carregar();
  try {
    const config = { disponivel: true, maxCaracteres: 4000 };
    for (const roles of [['rdo:manager'], ['rdo:coordinator']]) {
      assert.match(renderizar(mod, { roles, config }), /Adequar para relatório/, roles[0]);
    }
    for (const roles of [['rdo:collaborator'], ['rdo:client'], ['acompanhamento:manager']]) {
      assert.equal(renderizar(mod, { roles, config }), '', roles[0]);
    }
    assert.equal(renderizar(mod, { roles: null, config }), '', 'sem AuthProvider não quebra a tela');
    assert.equal(renderizar(mod, { roles: ['rdo:manager'], config: { disponivel: false, maxCaracteres: 4000 } }), '');
  } finally {
    await mod.server.close();
  }
});

test('"Adequar para relatório": desabilitado sem texto e acima do limite de caracteres', async () => {
  const mod = await carregar();
  try {
    const config = { disponivel: true, maxCaracteres: 10 };
    assert.match(renderizar(mod, { roles: ['rdo:manager'], config, valor: '   ' }), /disabled=""[^>]*>Adequar para relatório|<button[^>]*disabled/);
    const grande = renderizar(mod, { roles: ['rdo:manager'], config, valor: 'x'.repeat(11) });
    assert.match(grande, /Limite de 10 caracteres/);
    assert.doesNotMatch(renderizar(mod, { roles: ['rdo:manager'], config, valor: 'ok' }), /disabled/);
  } finally {
    await mod.server.close();
  }
});
