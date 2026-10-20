import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

test('successful report submission refreshes inactive draft lists before returning to the home page', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  t.after(() => server.close());
  const { useReportMutations } = await server.ssrLoadModule('/src/hooks/useReports.ts');
  const { AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.ts');
  const { apiClient } = await server.ssrLoadModule('/src/api/client.ts');
  const { queryKeys } = await server.ssrLoadModule('/src/hooks/queryKeys.ts');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  t.after(() => client.clear());
  const draftKey = queryKeys.drafts('user-1');
  let submitted = false;
  await client.fetchQuery({ queryKey: draftKey, queryFn: async () => submitted ? [] : [{ id: 'active' }] });
  client.setQueryData(queryKeys.drafts('user-2'), [{ id: 'another-user' }]);
  let mutations;
  function Fixture() { mutations = useReportMutations(); return null; }
  renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(AuthContext.Provider, { value: { user: { id: 'user-1' } } }, createElement(Fixture))));
  const requests = [];
  t.mock.method(apiClient, 'post', async (url, payload) => {
    requests.push({ url, draftId: payload.draftId });
    submitted = true;
    const report = { id: 'submitted', reportType: 'RDO', status: 'PENDING' };
    return { data: url.endsWith('/service-only') ? [report] : report };
  });

  for (const mutation of [mutations.createReport, mutations.createServiceOnlyReports]) {
    submitted = false;
    client.setQueryData(draftKey, [{ id: 'active' }]);
    await mutation.mutateAsync({ draftId: 'active' });
    assert.deepEqual(client.getQueryData(draftKey), []);
    assert.deepEqual(client.getQueryData(queryKeys.drafts('user-2')), [{ id: 'another-user' }]);
  }
  assert.deepEqual(requests.map(request => request.draftId), ['active', 'active']);

  client.setQueryData(draftKey, [{ id: 'retained' }]);
  apiClient.post = async () => { throw new Error('Submission failed'); };
  await assert.rejects(mutations.createReport.mutateAsync({ draftId: 'retained' }), /Submission failed/);
  assert.deepEqual(client.getQueryData(draftKey), [{ id: 'retained' }]);
});
