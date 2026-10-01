import { expect, test, type Page } from '@playwright/test';

const account = {
  id: 'admin-1', username: 'admin', name: 'Administrador', email: 'admin@example.com',
  role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['qualidade:manager', 'epi:technician'],
  reportEmissionPermissions: [], isActive: true
};

const nature = {
  id: 'nature-1', name: 'Documentação', isActive: true, position: 0,
  inUse: true, recordCount: 1, createdAt: '2026-09-01', updatedAt: '2026-09-01'
};

const qualityRecord = {
  id: 'record-1', number: 'Q-001', type: 'DESVIO', seq: 1, year: 2026,
  registeredAt: '2026-09-01', origin: 'Inspeção', projectId: 'project-1',
  project: { id: 'project-1', code: '5917', name: 'Ilha Solteira' },
  eventDate: '2026-09-01', natureId: 'nature-1', nature: { id: 'nature-1', name: 'Documentação' },
  description: 'Documento pendente', impact: 'MEDIO', occurrences12m: 2, recurrent: true,
  linkedRnc: null, disposition: 'TRATAR', definedAction: null, actionOwner: null,
  actionDeadline: null, evidence: null, evidenceAttachment: null, evidences: [],
  resultVerification: null, status: 'ABERTO', createdAt: '2026-09-01', updatedAt: '2026-09-01'
};

const collaborator = {
  id: 'collaborator-1', code: 'C-001', name: 'Marina Operações', cpf: '',
  registrationNumber: '', admissionDate: null,
  currentJobRole: { id: 'role-1', name: 'Técnica', order: 1, isActive: true },
  roleOverrideJobRole: null,
  effectiveRole: { jobRoleId: 'role-1', name: 'Técnica', source: 'CANONICAL' },
  epiRecords: [{ id: 'epi-record-1', collaboratorId: 'collaborator-1', epiName: 'Capacete',
    ca: '123', quantity: 1, lendDate: '2026-09-01', devolutionDate: null,
    signedAt: null, archivedAt: null, createdAt: '2026-09-01', updatedAt: '2026-09-01' }]
};

async function useFixtures(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(selectedTheme => {
    localStorage.setItem('filtrovali-react-token', 'synthetic-quality-epi-token');
    localStorage.setItem('filtrovali:qualidade-tutorial:v1:manager:admin@example.com', '1');
    localStorage.setItem('filtrovali-theme', selectedTheme);
  }, theme);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    let body: unknown = {};
    if (path === '/api/auth/me') body = { user: account };
    else if (path === '/api/qualidade/registros') body = { items: [qualityRecord], total: 1, page: 1, pageSize: 50 };
    else if (path === '/api/qualidade/projetos') body = [{ id: 'project-1', code: '5917', name: 'Ilha Solteira', isActive: true }];
    else if (path === '/api/qualidade/naturezas') body = [nature];
    else if (path === '/api/epi/collaborators') body = [collaborator];
    else if (path === '/api/epi/catalog') body = [{ id: 'catalog-1', name: 'Capacete', ca: '123', isActive: true }];
    else if (path === '/api/epi/job-roles') body = [collaborator.currentJobRole];
    else if (path === '/api/epi/public-sign/test-token') body = {
      status: 'ACTIVE', expiresAt: '2026-10-15',
      collaborator: { id: collaborator.id, name: collaborator.name, role: 'Técnica' },
      records: collaborator.epiRecords
    };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

for (const viewport of [
  { name: 'mobile', width: 390, height: 844, theme: 'light' },
  { name: 'tablet', width: 768, height: 1024, theme: 'dark' },
  { name: 'desktop', width: 1280, height: 900, theme: 'light' }
] as const) {
  test(`Qualidade e EPI · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await useFixtures(page, viewport.theme);

    await page.goto('/qualidade');
    await expect(page.getByRole('heading', { name: 'Registros de qualidade' })).toBeVisible();
    await expect(page.getByText('Q-001')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`quality-${viewport.name}.png`, { fullPage: true });
    if (viewport.name === 'mobile') {
      const filterToggle = page.locator('.quality-filter-details > summary');
      await filterToggle.click();
      await expect(page.getByRole('combobox', { name: 'Filtrar tipo' })).toBeVisible();
      await filterToggle.click();
    }
    await page.getByRole('button', { name: 'Registrar' }).click();
    await expect(page.getByRole('dialog')).toContainText('Novo registro');
    await expect(page.getByRole('dialog').getByLabel('Obra/Projeto')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
    const selectSection = async (label: string) => {
      if (viewport.name === 'tablet') {
        await page.getByRole('button', { name: 'Abrir menu' }).click();
        await page.locator('.fv-navigation-drawer').getByRole('link', { name: label }).click();
      } else {
        await page.locator(viewport.name === 'desktop' ? '.fv-app-shell__sidebar' : '.fv-bottom-bar').getByRole('link', { name: label }).click();
      }
    };
    await selectSection('Naturezas');
    await expect(page.getByRole('heading', { name: 'Naturezas' })).toBeVisible();
    await expect(page.getByText('Documentação')).toBeVisible();
    if (viewport.name === 'mobile') await expect(page).toHaveScreenshot('quality-natures-mobile.png', { fullPage: true });
    await page.getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByRole('dialog')).toContainText('Editar Natureza');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

    await page.goto('/epi');
    await expect(page.getByRole('heading', { name: 'Fichas por colaborador' })).toBeVisible();
    await page.getByRole('button', { name: /Marina Operações/ }).click();
    await expect(page.locator('.epi-record-row').getByText('Capacete', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await selectSection('Catálogo');
    await expect(page.getByRole('heading', { name: 'Catálogo de EPIs' })).toBeVisible();
    await expect(page.locator('.epi-catalog-row').getByText('Capacete', { exact: true })).toBeVisible();
    await page.locator('.epi-catalog-row').getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByRole('textbox', { name: 'Nome de Capacete' })).toBeVisible();
    await page.locator('.epi-catalog-edit-form').getByRole('button', { name: 'Cancelar' }).click();
    await expect(page).toHaveScreenshot(`epi-catalog-${viewport.name}.png`, { fullPage: true });

    await page.goto('/epi/assinar/test-token');
    await expect(page.getByText('Assinatura de EPI', { exact: true })).toBeVisible();
    await expect(page.getByText('Marina Operações')).toBeVisible();
    await expect(page.locator('.epi-public-row').getByText('Capacete')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`epi-public-${viewport.name}.png`, { fullPage: true });
  });
}
