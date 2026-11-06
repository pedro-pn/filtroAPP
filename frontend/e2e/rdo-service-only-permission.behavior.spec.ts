import { expect, test, type Page } from '@playwright/test';
import type { AuthUser } from '../src/types/auth';

const coordinator: AuthUser = {
  id: 'service-only-coordinator', username: 'coordinator', name: 'Coordenador teste', email: null,
  role: 'COORDINATOR', accountType: 'INTERNAL', moduleRoles: ['rdo:coordinator'],
  reportEmissionPermissions: ['SITE_RDO'], rdoExtraPermissions: [], isActive: true
};
const manager: AuthUser = { ...coordinator, id: 'service-only-manager', role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['rdo:manager'] };

async function mockAccount(page: Page, user: AuthUser) {
  await page.addInitScript(({ id }) => {
    localStorage.setItem('filtrovali-react-token', 'service-only-test-token');
    localStorage.setItem(`filtrovali:rdo-dds-novelty:v2:${id}`, '1');
    localStorage.setItem(`filtrovali:hub-first-login-tutorial:${id}`, '1');
  }, user);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    let body: unknown = [];
    if (path === '/api/auth/me') body = { user };
    if (path === '/api/notifications') body = {
      items: [], criticalItems: [], unreadCount: 0, nextCursor: null, snapshotAt: new Date().toISOString()
    };
    if (path === '/api/admin/accounts') body = [coordinator];
    if (path === '/api/rdo/bootstrap/new-report') body = {
      projects: [], collaborators: [], units: [], manometers: [], counters: [], equipments: [],
      rdoSlotMap: {}, inhibitionOptions: {}, drafts: []
    };
    return route.fulfill({ json: body });
  });
}

test('coordenador usa Somente serviço com permissão e consulta a ajuda por mouse e teclado', async ({ page }) => {
  await mockAccount(page, { ...coordinator, rdoExtraPermissions: ['CREATE_SERVICE_ONLY_REPORTS'] });
  await page.goto('/rdo/relatorio/novo?tipo=obra');
  const toggle = page.getByRole('checkbox', { name: /Somente serviço/ });
  await expect(toggle).toBeVisible();
  const help = page.getByLabel(/^Ajuda: Cria relatórios de serviço sem gerar um RDO de obra/);
  await help.hover();
  await expect(page.getByRole('tooltip')).toContainText('aprovados e liberados diretamente para o cliente');
  await expect(toggle).not.toBeChecked();
  await page.mouse.move(0, 0);
  await help.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await toggle.check();
  await expect(page.getByRole('tab', { name: /Finalização/ })).toHaveCount(0);
  await toggle.uncheck();
  await expect(page.getByRole('tab', { name: /Finalização/ })).toBeVisible();
});

test('revisão isolada não exibe Somente serviço e administrador mantém acesso automático', async ({ page }) => {
  await mockAccount(page, { ...coordinator, rdoExtraPermissions: ['REVIEW_REPORTS'] });
  await page.goto('/rdo/relatorio/novo?tipo=obra');
  await expect(page.getByRole('heading', { name: 'Novo relatório', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Somente serviço/ })).toHaveCount(0);
  await page.unroute('**/api/**');
  await mockAccount(page, manager);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Somente serviço/ })).toBeVisible();
});

test('permissões da conta são independentes e a nova permissão é enviada ao salvar', async ({ page }) => {
  await mockAccount(page, manager);
  let savedPermissions: string[] | undefined;
  await page.route(`**/api/admin/accounts/${coordinator.id}`, async route => {
    const body = route.request().postDataJSON();
    savedPermissions = body.rdoExtraPermissions;
    await route.fulfill({ json: { ...coordinator, ...body } });
  });
  await page.goto('/admin/accounts');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const review = page.getByRole('checkbox', { name: /^Revisar relatórios/ });
  const serviceOnly = page.getByRole('checkbox', { name: /^Criar relatórios somente de serviço/ });
  await serviceOnly.check();
  await review.check();
  await expect(serviceOnly).toBeChecked();
  await serviceOnly.uncheck();
  await expect(review).toBeChecked();
  await serviceOnly.check();
  await review.uncheck();
  await expect(serviceOnly).toBeChecked();
  await page.getByLabel(/^Ajuda: Permite usar a opção Somente serviço/).hover();
  await expect(page.getByRole('tooltip')).toContainText('sem gerar um RDO de obra');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect.poll(() => savedPermissions).toEqual(['CREATE_SERVICE_ONLY_REPORTS']);
});

async function prepareSubmission(page: Page, user: AuthUser, serviceOnly = true) {
  await mockAccount(page, user);
  await page.route('**/api/rdo/bootstrap/new-report', route => route.fulfill({ json: {
    projects: [{ id: 'project', code: '101', name: 'Projeto teste', location: 'Oficina', isActive: true, plannedServices: [] }],
    collaborators: [{ id: 'collaborator', name: 'Técnico teste', isActive: true }],
    units: [], manometers: [], counters: [], equipments: [], rdoSlotMap: {}, inhibitionOptions: {}, drafts: []
  } }));
  await page.route('**/api/rdo/drafts**', route => route.fulfill({
    json: route.request().method() === 'GET' ? [] : {
      id: 'submission-draft', ...route.request().postDataJSON()
    }
  }));
  await page.route('**/api/rdo/reports/planning-context**', route => route.fulfill({ json: null }));
  await page.route('**/api/rdo/reports/collaborator-prefill**', route => route.fulfill({ json: null }));
  const submissions: unknown[] = [];
  await page.route(`**/api/rdo/reports${serviceOnly ? '/service-only' : ''}`, route => {
    if (route.request().method() !== 'POST') return route.fallback();
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: 'Envio interceptado pelo teste.' } });
  });
  await page.goto('/rdo/relatorio/novo?tipo=obra');
  await expect(page.getByRole('heading', { name: 'Novo relatório', exact: true })).toBeVisible();
  await page.evaluate(async ({ serviceOnly }) => {
    const modulePath = '/src/store/rdoStore.ts';
    const { useRdoStore } = await import(modulePath);
    useRdoStore.getState().hydrate({
      serviceOnly, projectId: 'project', reportDate: '2026-11-06',
      arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00:00',
      collaboratorIds: ['collaborator'],
      services: [{ id: 'service', type: 'mecanica', data: {
        equipmentId: 'EQ-1', system: 'Sistema', material: 'Aço carbono',
        startTime: '08:00', endTime: '17:00', serviceCollaboratorIds: ['collaborator'],
        etapas: ['Preparação'], finalized: true
      } }]
    });
  }, { serviceOnly });
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  if (!serviceOnly) await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  return submissions;
}

test('coordenador confirma o envio direto ao cliente e pode cancelar sem perder o formulário', async ({ page }) => {
  const submissions = await prepareSubmission(page, { ...coordinator, rdoExtraPermissions: ['CREATE_SERVICE_ONLY_REPORTS'] });
  const send = page.getByRole('button', { name: 'Enviar relatório', exact: true });
  await send.click();
  const warning = page.getByRole('dialog', { name: 'Enviar relatório diretamente para o cliente?' });
  await expect(warning).toContainText('aprovados automaticamente e disponibilizados diretamente para o cliente, sem aprovação de um administrador');
  expect(submissions).toHaveLength(0);
  await warning.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(warning).toHaveCount(0);
  expect(submissions).toHaveLength(0);
  await expect(page.locator('input[id^="service-equipment-"]')).toHaveValue('EQ-1');
  await expect(send).toBeEnabled();
  await send.click();
  await warning.getByRole('button', { name: 'Confirmar envio', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  await expect(warning).toHaveCount(0);
});

for (const scenario of [
  { name: 'RDO comum do coordenador', user: coordinator, serviceOnly: false },
  { name: 'Somente serviço do administrador', user: manager, serviceOnly: true }
]) {
  test(`${scenario.name} mantém o envio sem a confirmação específica do coordenador`, async ({ page }) => {
    const submissions = await prepareSubmission(page, scenario.user, scenario.serviceOnly);
    await page.getByRole('button', { name: 'Enviar relatório', exact: true }).click();
    await expect.poll(() => submissions.length).toBe(1);
    await expect(page.getByRole('dialog', { name: 'Enviar relatório diretamente para o cliente?' })).toHaveCount(0);
  });
}
