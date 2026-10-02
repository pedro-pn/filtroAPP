import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  demoCredentials,
  expectComfortableTapTargets,
  expectManagerRdoMobileNavigation,
  expectManagerRdoShell,
  loginAs
} from './support/rdo';

const MANAGER_PROJECTS_URL = '/rdo/gestor?tab=projetos';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function setTheme(page: Page, theme: 'light' | 'dark') {
  const toggle = page.locator('.fv-theme-toggle').first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );
    if (current === theme) return;
    await toggle.click();
  }
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    )
    .toBe(theme);
}

async function expectNoHorizontalOverflow(page: Page, surface: Locator) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.body.scrollWidth <= window.innerWidth
      )
    )
    .toBe(true);
  await expect
    .poll(() =>
      surface.evaluate((element) => element.scrollWidth <= element.clientWidth)
    )
    .toBe(true);
}

async function dismissProjectNoveltyIfVisible(page: Page) {
  const next = page.getByRole('button', {
    name: 'Ver pendências',
    exact: true
  });
  try {
    await next.waitFor({ state: 'visible', timeout: 1_500 });
    await next.click();
    await page.getByRole('button', { name: 'Entendi', exact: true }).click();
  } catch {
    // A novidade só aparece enquanto houver uma pendência ainda não vista.
  }
}

async function openProjectsPage(page: Page) {
  await page.goto(MANAGER_PROJECTS_URL);
  await expect(
    page.getByRole('heading', { name: 'Projetos', level: 1 })
  ).toBeVisible();
  await dismissProjectNoveltyIfVisible(page);
  const surface = page.locator('.rdo-manager-projects');
  await expect(surface).toBeVisible();
  return surface;
}

async function readyProject(surface: Locator) {
  const candidate = surface
    .locator('.rdo-active-project-card:not(.rdo-active-project-card--pending)')
    .first();
  await expect(
    candidate,
    'O backend real precisa fornecer ao menos um projeto ativo liberado'
  ).toBeVisible();
  const projectId = await candidate.getAttribute('data-active-project-id');
  expect(projectId).toBeTruthy();
  return surface.locator(`[data-active-project-id="${projectId}"]`);
}

test('Projetos preserva busca, ordenação, detalhes e abertura dos formulários sem mutar dados', async ({
  page
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, demoCredentials.manager);
  const surface = await openProjectsPage(page);
  await expectManagerRdoShell(page);

  const mutationAttempts: string[] = [];
  page.on('request', (request) => {
    if (
      MUTATING_METHODS.has(request.method().toUpperCase()) &&
      !request.url().endsWith('/api/rdo/reports/counts')
    ) {
      mutationAttempts.push(`${request.method()} ${request.url()}`);
    }
  });

  const project = await readyProject(surface);
  await expect(project.getByText('Ativo', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Resumo dos projetos ativos' })
      .getByText('Com responsável', { exact: true })
  ).toBeVisible();
  await expect(
    project.getByRole('button', { name: 'Arquivar', exact: true })
  ).toBeVisible();

  const detailsToggle = project.locator(
    '.rdo-active-project-card__details-toggle'
  );
  const projectTitleToggle = project.locator('.rdo-project-card__title-toggle');
  if ((await detailsToggle.getAttribute('aria-expanded')) === 'true') {
    await detailsToggle.click();
    await expect(detailsToggle).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(project).toHaveClass(/rdo-active-project-card--compact/);
  await projectTitleToggle.click();
  await expect(projectTitleToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(detailsToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(project).toHaveClass(/rdo-active-project-card--expanded/);
  await detailsToggle.click();
  await expect(projectTitleToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(project).toHaveClass(/rdo-active-project-card--compact/);
  await detailsToggle.click();
  await expect(projectTitleToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(project).toHaveClass(/rdo-active-project-card--expanded/);
  await expect(
    project.locator('.rdo-active-project-card__detail-panel--overview > dl')
  ).toBeVisible();
  await expect(
    project.getByRole('navigation', { name: /^Seções de / })
  ).toHaveCount(0);
  await expect(
    project.getByRole('heading', { name: 'Operação', level: 4 })
  ).toBeVisible();
  await expect(
    project.getByRole('heading', { name: 'Resumo', level: 4 })
  ).toBeVisible();
  await expect(
    project.getByRole('heading', { name: 'Ações rápidas', level: 4 })
  ).toBeVisible();

  const editTrigger = project.getByRole('button', { name: /^Editar:/ });
  await editTrigger.click();
  const saveProject = project.getByRole('button', {
    name: 'Salvar projeto',
    exact: true
  });
  await expect(saveProject).toBeVisible();
  await expect(saveProject).toHaveClass(/\bfv-button--primary\b/);
  await expect(saveProject).toHaveClass(/\bfv-button--md\b/);
  const cancelEdit = project.getByRole('button', {
    name: 'Cancelar edição',
    exact: true
  });
  await expect(cancelEdit).toHaveClass(/\bfv-button--md\b/);
  await editTrigger.click();
  await expect(saveProject).toHaveCount(0);
  await editTrigger.click();
  await expect(saveProject).toBeVisible();
  const addButtons = project.getByRole('button', {
    name: '+ Adicionar',
    exact: true
  });
  await expect(addButtons).toHaveCount(2);
  await expect(addButtons.first()).toHaveClass(/\bfv-button--primary\b/);
  await expect(addButtons.nth(1)).toHaveClass(/\bfv-button--primary\b/);
  await expect(
    project.getByRole('button', {
      name: '+ Adicionar segmento',
      exact: true
    })
  ).toHaveClass(/\bfv-button--secondary\b/);
  await expect(
    surface.locator('.project-revision-picker .mini-btn')
  ).toHaveCount(0);
  await cancelEdit.click();
  await expect(project.getByRole('button', { name: /^Editar:/ })).toBeVisible();

  await project
    .getByRole('button', { name: 'Gerenciar equipe', exact: true })
    .click();
  const teamDialog = page.getByRole('dialog', { name: 'Gerenciar equipe' });
  await expect(teamDialog).toBeVisible();
  await expect(
    teamDialog.getByRole('combobox', { name: 'Operador responsável' })
  ).toBeFocused();
  await expect(
    teamDialog.getByRole('combobox', { name: 'Usuários internos autorizados' })
  ).toBeVisible();
  await expect(
    teamDialog.getByRole('button', { name: 'Salvar equipe', exact: true })
  ).toHaveClass(/\bfv-button--md\b/);
  await teamDialog
    .getByRole('button', { name: 'Cancelar', exact: true })
    .click();
  await expect(teamDialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  const newProjectForm = surface.locator('.rdo-manager-projects__legacy-form');
  await expect(newProjectForm).toBeVisible();
  await expect(
    newProjectForm.getByRole('textbox', { name: 'Número da missão' })
  ).toBeVisible();
  await expect(
    newProjectForm.getByRole('button', {
      name: '+ Adicionar segmento',
      exact: true
    })
  ).toHaveClass(/\bfv-button--secondary\b/);
  await expect(
    newProjectForm.getByRole('button', { name: 'Criar projeto', exact: true })
  ).toHaveClass(/\bfv-button--primary\b/);
  await expect(newProjectForm.locator('.mini-btn')).toHaveCount(0);
  await newProjectForm
    .getByRole('button', { name: 'Cancelar', exact: true })
    .click();
  await expect(newProjectForm).toHaveCount(0);

  const filters = page.locator('.rdo-manager-projects__filters');
  const sortButton = filters.getByRole('button', {
    name: 'Ordenar projetos de Z a A',
    exact: true
  });
  await sortButton.click();
  await expect(
    filters.getByRole('button', {
      name: 'Ordenar projetos de A a Z',
      exact: true
    })
  ).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Buscar em projetos' });
  await search.fill('projeto-inexistente-b13');
  await expect(
    surface.locator(
      '.rdo-active-project-card:not(.rdo-active-project-card--pending)'
    )
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
  await expect(
    surface.locator(
      '.rdo-active-project-card:not(.rdo-active-project-card--pending)'
    )
  ).not.toHaveCount(0);

  expect(mutationAttempts).toEqual([]);
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=projetos$/);
});

test('Ação Ver relatórios abre Aprovados com a busca do projeto preenchida', async ({
  page
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, demoCredentials.manager);
  const surface = await openProjectsPage(page);
  const project = await readyProject(surface);
  const detailsToggle = project.locator(
    '.rdo-active-project-card__details-toggle'
  );
  if ((await detailsToggle.getAttribute('aria-expanded')) !== 'true') {
    await detailsToggle.click();
  }

  await project
    .getByRole('button', { name: 'Ver relatórios', exact: true })
    .click();

  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=aprovados$/);
  await expect(
    page.getByRole('heading', { name: 'Relatórios aprovados', level: 1 })
  ).toBeVisible();
  const approvedSearch = page.getByRole('searchbox', {
    name: 'Buscar em aprovados'
  });
  await expect(approvedSearch).not.toHaveValue('');
});

test('Projetos valida desktop/mobile em light/dark e formulário sem overflow', async ({
  page
}) => {
  test.setTimeout(180_000);
  const scenarios = [
    {
      name: 'desktop light',
      width: 1280,
      height: 900,
      theme: 'light' as const
    },
    { name: 'desktop dark', width: 1280, height: 900, theme: 'dark' as const },
    { name: 'mobile light', width: 390, height: 844, theme: 'light' as const },
    { name: 'mobile dark', width: 390, height: 844, theme: 'dark' as const }
  ];

  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, demoCredentials.manager);
  const surface = await openProjectsPage(page);
  const project = await readyProject(surface);

  for (const scenario of scenarios) {
    await page.setViewportSize({
      width: scenario.width,
      height: scenario.height
    });
    if (scenario.width >= 1024) {
      await expectManagerRdoShell(page);
    } else {
      await expectManagerRdoMobileNavigation(page);
    }
    await setTheme(page, scenario.theme);

    await expectNoHorizontalOverflow(page, surface);
    await expectComfortableTapTargets(page, '.rdo-manager-projects');
    await expect(project).toHaveCSS(
      'background-color',
      scenario.theme === 'dark' ? 'rgb(22, 33, 27)' : 'rgb(255, 255, 255)'
    );
    await expect(surface).not.toHaveClass(/(?:^|\s)page-card(?:\s|$)/);
    await expect(
      surface.locator(
        ':scope > .rdo-manager-projects__list > .admin-card, ' + '.mini-btn'
      )
    ).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  const newProjectForm = surface.locator('.rdo-manager-projects__legacy-form');
  await expect(newProjectForm).toBeVisible();
  await expectNoHorizontalOverflow(page, surface);
  await expect(
    newProjectForm.getByRole('button', { name: 'Criar projeto', exact: true })
  ).toHaveClass(/\bfv-button--primary\b/);
  await expect(newProjectForm.locator('.mini-btn')).toHaveCount(0);
});
