import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { PROJECT_DISTRIBUTION_CHANNELS, projectDistributionSettings } from '../../shared/modules/project-distribution.js';

test('os três modos aplicam seus padrões; reabrir preserva exceções por projeto', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { applyProjectVisibilityMode, projectToForm } = await server.ssrLoadModule('/src/pages/gestor/GestorPage.shared.tsx');
    for (const mode of ['manager-only', 'manager-coordinator', 'all-authorized']) {
      const form = applyProjectVisibilityMode(mode);
      assert.equal(form.managerOnly, mode === 'manager-only');
      assert.equal(form.visibleToCollaborators, mode === 'all-authorized');
      for (const { key } of PROJECT_DISTRIBUTION_CHANNELS) assert.equal(form.distributionSettings[key], mode !== 'manager-only');
    }
    const project = { ...applyProjectVisibilityMode('manager-only'), distributionSettings: {
      ...projectDistributionSettings({ managerOnly: true }), api: true, acompanhamento: true
    } };
    assert.deepEqual(projectToForm(project).distributionSettings, project.distributionSettings);
    assert.equal(applyProjectVisibilityMode('manager-coordinator').distributionSettings.api, true);
  } finally {
    await server.close();
  }
});
