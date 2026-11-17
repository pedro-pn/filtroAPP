import { expect, test, type Page } from '@playwright/test';

const defaults = ['P', 'M', 'G', 'GG', 'XG', 'Especial'];
const account = {
  id: 'epi-admin', username: 'epi-admin', name: 'Técnico EPI', email: 'epi@example.com',
  role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['epi:technician'],
  reportEmissionPermissions: [], isActive: true
};

type CatalogItem = { id: string; name: string; ca: string; isActive: boolean; hasSizes: boolean; sizes: string[] };
type RecordPayload = { catalogItemId: string | null; epiName: string; ca: string; size: string | null; quantity: number; lendDate: string;
  newCatalogItem?: { hasSizes: boolean; sizes: string[] } };

async function fixtures(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('filtrovali-react-token', 'synthetic-epi-sizes-token');
    localStorage.setItem('filtrovali-theme', 'light');
  });
  const catalog: CatalogItem[] = [
    { id: 'catalog-sized', name: 'Luva de proteção', ca: '123', isActive: true, hasSizes: true, sizes: [...defaults] },
    { id: 'catalog-other', name: 'Botina', ca: '456', isActive: true, hasSizes: true, sizes: ['38', '40', '42'] },
    { id: 'catalog-plain', name: 'Protetor auricular', ca: '789', isActive: true, hasSizes: false, sizes: [] }
  ];
  const records: Array<RecordPayload & { id: string; collaboratorId: string; archivedAt: string | null; signedAt: string | null; createdAt: string; updatedAt: string }> = [];
  const collaborator = {
    id: 'collaborator-1', code: 'C-001', name: 'Marina Operações', cpf: '', registrationNumber: '', admissionDate: null,
    currentJobRole: { id: 'role-1', name: 'Técnica', order: 1, isActive: true }, roleOverrideJobRole: null,
    effectiveRole: { jobRoleId: 'role-1', name: 'Técnica', source: 'CANONICAL' }, epiRecords: records
  };
  const submissions: RecordPayload[] = [];
  const catalogSubmissions: CatalogItem[] = [];
  const catalogUpdates: Array<Partial<CatalogItem>> = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    let body: unknown = {};
    let status = 200;
    if (pathname === '/api/auth/me') body = { user: account };
    else if (pathname === '/api/notifications') body = { items: [], unreadCount: 0, nextCursor: null, snapshotAt: '2026-11-16T12:00:00Z' };
    else if (pathname === '/api/epi/job-roles') body = [collaborator.currentJobRole];
    else if (pathname === '/api/epi/collaborators') body = [collaborator];
    else if (pathname === '/api/epi/public-sign/size-token') body = {
      status: 'ACTIVE', expiresAt: '2026-11-20',
      collaborator: { id: collaborator.id, name: collaborator.name, role: collaborator.currentJobRole.name },
      records
    };
    else if (pathname === '/api/epi/catalog') {
      if (request.method() === 'POST') {
        const payload = request.postDataJSON() as CatalogItem;
        const item = { ...payload, id: `catalog-new-${catalogSubmissions.length}` };
        catalogSubmissions.push(item);
        catalog.push(item);
        body = item;
        status = 201;
      } else body = catalog;
    } else if (pathname.startsWith('/api/epi/catalog/') && request.method() === 'PUT') {
      const payload = request.postDataJSON() as Partial<CatalogItem>;
      const item = catalog.find(item => item.id === pathname.split('/').at(-1))!;
      catalogUpdates.push(payload);
      Object.assign(item, payload);
      body = item;
    } else if (pathname === '/api/epi/collaborators/collaborator-1/records' && request.method() === 'POST') {
      const payload = request.postDataJSON() as RecordPayload;
      submissions.push(payload);
      let catalogItem = catalog.find(item => payload.catalogItemId ? item.id === payload.catalogItemId : item.name === payload.epiName && item.ca === payload.ca);
      if (!catalogItem) {
        catalogItem = { id: `catalog-inline-${catalog.length}`, name: payload.epiName, ca: payload.ca, isActive: true,
          hasSizes: payload.newCatalogItem?.hasSizes || false, sizes: payload.newCatalogItem?.sizes || [] };
        catalog.push(catalogItem);
      }
      const item = {
        ...payload, catalogItemId: catalogItem.id, id: `record-${records.length}`, collaboratorId: collaborator.id,
        archivedAt: null, signedAt: null, createdAt: '2026-11-16', updatedAt: '2026-11-16'
      };
      records.push(item);
      body = item;
      status = 201;
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { catalog, records, submissions, catalogSubmissions, catalogUpdates };
}

test('EPI: configura tamanhos padrão e personalizados e preserva edição', async ({ page }) => {
  const state = await fixtures(page);
  await page.goto('/epi?tab=catalog');
  const form = page.locator('.epi-catalog-form');
  await form.getByLabel('Nome do EPI', { exact: true }).fill('Camisa de proteção');
  await form.getByRole('checkbox', { name: /Este EPI possui tamanhos/ }).check();
  await expect(form.getByRole('button', { name: /^Remover tamanho / })).toHaveCount(defaults.length);
  for (const size of defaults) await expect(form.getByRole('button', { name: `Remover tamanho ${size}`, exact: true })).toBeVisible();
  await form.getByLabel('Novo tamanho').fill('XXG');
  await form.getByRole('button', { name: 'Acrescentar tamanho' }).click();
  await form.getByLabel('Novo tamanho').fill('xxg');
  await form.getByRole('button', { name: 'Acrescentar tamanho' }).click();
  await expect(form.getByRole('alert')).toHaveText('Este tamanho já está na lista.');
  await form.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect.poll(() => state.catalogSubmissions).toMatchObject([{ name: 'Camisa de proteção', hasSizes: true, sizes: [...defaults, 'XXG'] }]);
  await expect(form.getByRole('checkbox', { name: /Este EPI possui tamanhos/ })).not.toBeChecked();

  const row = page.locator('.epi-catalog-row').filter({ hasText: 'Camisa de proteção' });
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  const editor = row.locator('.epi-catalog-edit-form');
  await expect(editor.getByRole('checkbox', { name: /Este EPI possui tamanhos/ })).toBeChecked();
  await expect(editor.getByRole('button', { name: 'Remover tamanho XXG', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Remover tamanho P', exact: true }).click();
  await editor.getByLabel('Novo tamanho').fill('Sob medida');
  await editor.getByRole('button', { name: 'Acrescentar tamanho' }).click();
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect.poll(() => state.catalogUpdates).toMatchObject([{ hasSizes: true, sizes: [...defaults.slice(1), 'XXG', 'Sob medida'] }]);
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Remover tamanho Sob medida', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Remover tamanho P', exact: true })).toHaveCount(0);
});

for (const width of [1280, 390]) {
  test(`EPI: cria catálogo com tamanhos diretamente na ficha em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixtures(page);
    await page.goto('/epi');
    await page.getByRole('button', { name: /Marina Operações/ }).click();
    const form = page.locator('.epi-record-form');
    const toggle = form.getByRole('checkbox', { name: 'Este EPI possui tamanhos' });
    const size = form.getByLabel('Tamanho', { exact: true });
    await form.getByLabel('Nome do EPI', { exact: true }).fill('Botina personalizada');
    await form.getByLabel('C.A', { exact: true }).fill('9876');
    await toggle.check();
    await expect(form.getByRole('button', { name: /^Remover tamanho / })).toHaveCount(defaults.length);
    await expect(size).toHaveAttribute('required', '');
    await form.getByRole('button', { name: 'Adicionar EPI', exact: true }).click();
    expect(state.submissions).toHaveLength(0);
    for (const option of defaults) await form.getByRole('button', { name: `Remover tamanho ${option}`, exact: true }).click();
    await form.getByRole('button', { name: 'Adicionar EPI', exact: true }).click();
    expect(state.submissions).toHaveLength(0);
    await expect(form.getByText('Acrescente ao menos um tamanho antes de salvar.')).toBeVisible();
    await form.getByLabel('Novo tamanho').fill('42');
    await form.getByRole('button', { name: 'Acrescentar tamanho' }).click();
    await size.selectOption('42');
    await form.getByRole('button', { name: 'Remover tamanho 42', exact: true }).click();
    await expect(size).toHaveValue('');
    for (const option of ['42', '43']) {
      await form.getByLabel('Novo tamanho').fill(option);
      await form.getByRole('button', { name: 'Acrescentar tamanho' }).click();
    }
    await size.selectOption('42');
    await toggle.uncheck();
    await expect(size).toHaveCount(0);
    await toggle.check();
    await expect(size).toHaveValue('');
    await size.selectOption('42');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await form.getByRole('button', { name: 'Adicionar EPI', exact: true }).click();
    await expect.poll(() => state.submissions).toMatchObject([{ catalogItemId: null, size: '42',
      newCatalogItem: { hasSizes: true, sizes: ['42', '43'] } }]);
    expect(state.catalogSubmissions).toHaveLength(0);
    await expect(toggle).not.toBeChecked();
    await expect(size).toHaveCount(0);
    await expect(page.locator('.epi-record-row').filter({ hasText: 'Botina personalizada' })).toContainText('Tam. 42');

    await form.getByLabel('EPI cadastrado').fill('9876');
    await page.getByRole('option', { name: 'Botina personalizada · C.A 9876', exact: true }).click();
    await expect(toggle).toHaveCount(0);
    await expect(size.locator('option')).toHaveText(['Selecione o tamanho', '42', '43']);
    await size.selectOption('43');
    await form.getByRole('button', { name: 'Adicionar EPI', exact: true }).click();
    await expect.poll(() => state.submissions).toHaveLength(2);
    expect(state.submissions[1].newCatalogItem).toBeUndefined();

    await toggle.check();
    await size.selectOption('M');
    await form.getByLabel('EPI cadastrado').fill('auricular');
    await page.getByRole('option', { name: 'Protetor auricular · C.A 789', exact: true }).click();
    await expect(size).toHaveCount(0);
    await form.getByLabel('Nome do EPI', { exact: true }).fill('Outro EPI sem tamanho');
    await form.getByLabel('C.A', { exact: true }).fill('');
    await expect(toggle).not.toBeChecked();
    await form.getByRole('button', { name: 'Adicionar EPI', exact: true }).click();
    await expect.poll(() => state.submissions).toHaveLength(3);
    expect(state.submissions[2]).toMatchObject({ size: null, newCatalogItem: { hasSizes: false, sizes: [] } });
  });

  test(`EPI: exige tamanho, limpa seleção e exibe tamanho na ficha e assinatura em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixtures(page);
    await page.goto('/epi');
    await page.getByRole('button', { name: /Marina Operações/ }).click();
    const catalogSelect = page.getByLabel('EPI cadastrado');
    await catalogSelect.fill('Luva');
    await page.getByRole('option', { name: 'Luva de proteção · C.A 123', exact: true }).click();
    const size = page.getByLabel('Tamanho', { exact: true });
    await expect(size).toHaveValue('');
    await expect(size).toHaveAttribute('required', '');
    await page.getByRole('button', { name: 'Adicionar EPI', exact: true }).click();
    expect(state.submissions).toHaveLength(0);
    expect(await size.evaluate((element: HTMLSelectElement) => element.validity.valueMissing)).toBe(true);
    await size.selectOption('GG');
    await catalogSelect.fill('456');
    await page.getByRole('option', { name: 'Botina · C.A 456', exact: true }).click();
    await expect(size).toHaveValue('');
    await expect(size.locator('option')).toHaveText(['Selecione o tamanho', '38', '40', '42']);
    await size.selectOption('42');
    await catalogSelect.fill('auricular');
    await page.getByRole('option', { name: 'Protetor auricular · C.A 789', exact: true }).click();
    await expect(size).toHaveCount(0);
    await page.getByRole('button', { name: 'Adicionar EPI', exact: true }).click();
    await expect.poll(() => state.submissions).toMatchObject([{ catalogItemId: 'catalog-plain', size: null }]);

    await catalogSelect.fill('Luva');
    await page.getByRole('option', { name: 'Luva de proteção · C.A 123', exact: true }).click();
    await size.selectOption('Especial');
    await page.getByRole('button', { name: 'Adicionar EPI', exact: true }).click();
    await expect.poll(() => state.submissions).toHaveLength(2);
    expect(state.submissions[1]).toMatchObject({ catalogItemId: 'catalog-sized', size: 'Especial' });
    const record = page.locator('.epi-record-row').filter({ hasText: 'Luva de proteção' });
    await expect(record).toContainText('Tam. Especial');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    await page.goto('/epi/assinar/size-token');
    await expect(page.locator('.epi-public-row').filter({ hasText: 'Luva de proteção' })).toContainText('Tam. Especial');
    await expect(page.locator('.epi-public-row').filter({ hasText: 'Protetor auricular' })).not.toContainText('Tam.');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}
