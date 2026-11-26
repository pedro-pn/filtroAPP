import { expect, test, type Page } from '@playwright/test';

import { loginThroughUi, skipOnboarding } from './support/login';
import { e2eSeed } from './support/seed';

// Jornada do Efetivo (spec 040): o admin define a equipe inicial de um projeto
// em Preparação, a missão é gravada no banco e a mesma pessoa só entra numa
// segunda missão no mesmo período com a sobreposição confirmada.

const MISSIONS_PATH = '/api/efetivo/planning/missions';

// Guias do Efetivo (driver.js) ficam por id do usuário; já vistos, não cobrem os botões.
async function skipEfetivoGuides(page: Page, userId: string) {
  await page.addInitScript(id => {
    for (const key of ['efetivo-tutorial-done:v2', 'efetivo-planning-novelty:v1', 'project-workflow-novelty:v8', 'allocation-review-novelty:v1']) {
      localStorage.setItem(`filtrovali:${key}:${id}`, '1');
    }
  }, userId);
}

function missionPost(page: Page) {
  return page.waitForResponse(response =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === MISSIONS_PATH
  );
}

async function openBoard(page: Page) {
  await page.goto('/efetivo?section=evolucao');
  await expect(page.locator('[data-project-workflow-board]')).toBeVisible();
}

function projectCard(page: Page, projectId: string) {
  return page.locator(`[data-project-kanban-card][data-project-id="${projectId}"]`);
}

test('admin define a equipe inicial no Efetivo e a sobreposição de missões exige confirmação', async ({ page }) => {
  const seed = e2eSeed();
  const { admin } = seed.accounts;
  const ana = seed.collaborators.ana;
  await skipOnboarding(page, admin.username);
  await skipEfetivoGuides(page, seed.users.adminId);
  await loginThroughUi(page, admin);

  await test.step('equipe inicial do projeto A vira missão gravada', async () => {
    await openBoard(page);
    const card = projectCard(page, seed.projects.a.id);
    await card.getByRole('button', { name: 'Definir equipe inicial' }).click();
    const dialog = page.getByRole('dialog', { name: 'Colaboradores por disponibilidade' });
    await dialog.getByRole('checkbox', { name: new RegExp(ana.name) }).check();
    const created = missionPost(page);
    await dialog.getByRole('button', { name: 'Aplicar equipe' }).click();
    expect((await created).status(), 'POST da missão no backend real').toBe(201);
    await expect(page.getByText('Equipe inicial definida.')).toBeVisible();

    await openBoard(page);
    const saved = projectCard(page, seed.projects.a.id);
    await expect(saved.getByRole('button', { name: 'Editar equipe inicial' })).toBeVisible();
    await saved.getByRole('button', { name: 'Equipe (1)' }).click();
    await expect(saved.getByText(ana.name)).toBeVisible();
  });

  await test.step('a mesma pessoa no projeto B pede confirmação; cancelar não grava nada', async () => {
    const card = projectCard(page, seed.projects.b.id);
    await card.getByRole('button', { name: 'Definir equipe inicial' }).click();
    const dialog = page.getByRole('dialog', { name: 'Colaboradores por disponibilidade' });
    await expect(dialog.getByText('Exige confirmação de sobreposição.')).toBeVisible();
    await dialog.getByRole('checkbox', { name: new RegExp(ana.name) }).check();
    let posted = false;
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === MISSIONS_PATH) posted = true;
    });
    await dialog.getByRole('button', { name: 'Aplicar equipe' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Confirmar colaborador em mais de uma missão?' })
      .or(page.getByRole('dialog', { name: 'Confirmar colaborador em mais de uma missão?' }));
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    await expect(confirm).toBeHidden();
    expect(posted, 'cancelar a confirmação não chama a API').toBe(false);
    await page.keyboard.press('Escape');
  });

  await test.step('sem a confirmação, a API real recusa a sobreposição (409)', async () => {
    const response = await page.request.post(MISSIONS_PATH, {
      headers: { 'X-Filtrovali-Request': '1' },
      data: {
        projectId: seed.projects.b.id,
        scheduleStatus: 'CONFIRMED',
        headquartersResponsibleUserId: seed.users.adminId,
        mobilizationDate: seed.efetivo.mobilizationDate,
        executionStartDate: seed.efetivo.executionStartDate,
        executionEndDate: seed.efetivo.executionEndDate,
        collaboratorIds: [ana.id]
      }
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe('PLANNING_CONFLICT');
  });

  await test.step('confirmada a sobreposição, a segunda missão é gravada', async () => {
    await openBoard(page);
    const card = projectCard(page, seed.projects.b.id);
    await card.getByRole('button', { name: 'Definir equipe inicial' }).click();
    const dialog = page.getByRole('dialog', { name: 'Colaboradores por disponibilidade' });
    await dialog.getByRole('checkbox', { name: new RegExp(ana.name) }).check();
    await dialog.getByRole('button', { name: 'Aplicar equipe' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Confirmar colaborador em mais de uma missão?' })
      .or(page.getByRole('dialog', { name: 'Confirmar colaborador em mais de uma missão?' }));
    const created = missionPost(page);
    await confirm.getByRole('button', { name: 'Confirmar sobreposição' }).click();
    expect((await created).status()).toBe(201);
    await expect(page.getByText('Equipe inicial definida.')).toBeVisible();
  });
});
