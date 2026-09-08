import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('lista Omie permite ao admin ocultar categorias das demais contas', () => {
  const panel = fs.readFileSync(new URL('../src/components/projects/OmieCostCategoriesPanel.tsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/api/acompanhamentoCusto.ts', import.meta.url), 'utf8');
  const route = fs.readFileSync(new URL('../../backend/src/routes/resources/acompanhamento-custo.js', import.meta.url), 'utf8');
  const commercialRoute = fs.readFileSync(new URL('../../backend/src/routes/resources/acompanhamento-comercial.js', import.meta.url), 'utf8');

  assert.match(panel, /user\?\.accountType === 'ADMIN'/);
  assert.match(panel, /Ocultar das demais contas/);
  assert.match(panel, /Liberar para todos/);
  assert.match(panel, /setOmieCostCategoryAdminOnly/);
  assert.match(api, /categorias-omie\/\$\{encodeURIComponent\(codigo\)\}\/visibilidade/);
  assert.match(route, /where: isAdmin \? undefined : \{ adminOnly: false \}/);
  assert.match(route, /categorias-omie\/:codigo\/visibilidade', requireAuth, requireHubAdmin/);
  assert.match(commercialRoute, /includeAdminOnlyCategories = req\.auth\?\.user\?\.accountType === 'ADMIN'/);
});
