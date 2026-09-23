import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('new maintenance services omit empty IDs while existing IDs survive an edit', async () => {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });

  try {
    const { buildMaintenanceProfilePayload } = await server.ssrLoadModule(
      '/src/utils/maintenanceProfilePayload.ts'
    );
    const { maintenanceProfileFormSchema } = await server.ssrLoadModule(
      '/src/schemas/operationalReport.ts'
    );
    const formValues = maintenanceProfileFormSchema.parse({
      name: '  Bombas  ',
      isActive: true,
      items: [
        { id: 'item-1', label: '  Inspeção  ', order: 2, isActive: false },
        { id: '', label: '  Lubrificação  ', order: 1, isActive: true }
      ]
    });
    const payload = buildMaintenanceProfilePayload(formValues);

    assert.deepEqual(payload, {
      name: 'Bombas',
      isActive: true,
      items: [
        { id: 'item-1', label: 'Inspeção', order: 1, isActive: false },
        { label: 'Lubrificação', order: 2, isActive: true }
      ]
    });
  } finally {
    await server.close();
  }
});
