import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  demoCredentials,
  expectComfortableTapTargets,
  expectManagerRdoMobileNavigation,
  expectManagerRdoShell,
  loginAs
} from './support/rdo';

const MANAGER_ARCHIVED_URL = '/rdo/gestor?tab=arquivados';
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

async function openArchivedPage(page: Page) {
  await page.goto(MANAGER_ARCHIVED_URL);
  await expect(
    page.getByRole('heading', { name: 'Arquivados', level: 1 })
  ).toBeVisible();
  const surface = page.locator('.rdo-archived-projects');
  await expect(surface).toBeVisible();
  return surface;
}

async function projectWithReports(page: Page, surface: Locator) {
  const candidate = surface
    .locator('.rdo-archived-project-card')
    .filter({ has: page.locator('.rdo-archived-project-card__meta').filter({ hasText: /\b[1-9]\d* relatórios?\b/ }) })
    .first();
  await expect(
    candidate,
    'O backend real precisa fornecer um projeto arquivado com relatórios'
  ).toBeVisible();
  const projectId = await candidate.getAttribute('data-archived-project-id');
  expect(projectId).toBeTruthy();
  return surface.locator(`[data-archived-project-id="${projectId}"]`);
}

test('Arquivados preserva busca, agrupamentos, seleção e ações sem mutar dados', async ({
  page
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, demoCredentials.manager);
  const surface = await openArchivedPage(page);
  await expectManagerRdoShell(page);

  const mutationAttempts: string[] = [];
  page.on('request', (request) => {
    if (MUTATING_METHODS.has(request.method().toUpperCase())) {
      mutationAttempts.push(`${request.method()} ${request.url()}`);
    }
  });

  await expect(surface.locator('.rdo-archived-project-card')).not.toHaveCount(
    0
  );
  await expect(
    surface.locator(
      '.rdo-archived-project-card__reports-toggle[aria-haspopup="dialog"]'
    )
  ).not.toHaveCount(0);
  const project = await projectWithReports(page, surface);
  const projectToggle = project.locator(
    '.rdo-archived-project-card__reports-toggle'
  );
  const projectTitleToggle = project.locator('.rdo-project-card__title-toggle');
  const reportsDialog = page.getByRole('dialog', { name: 'Relatórios do projeto', exact: true });
  await expect(projectToggle).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(projectToggle).not.toHaveAttribute('aria-expanded');
  await expect(surface.locator('.rdo-archived-report-type')).toHaveCount(0);
  const cardBefore = await project.boundingBox();
  await projectToggle.click();
  await expect(reportsDialog).toBeVisible();
  expect((await project.boundingBox())?.height).toBe(cardBefore?.height);
  await page.keyboard.press('Escape');
  await expect(reportsDialog).toBeHidden();
  await expect(projectToggle).toBeFocused();

  const detailsToggle = project.getByRole('button', {
    name: /^(Mostrar|Ocultar) detalhes$/
  });
  if ((await detailsToggle.getAttribute('aria-expanded')) === 'true') {
    await detailsToggle.click();
    await expect(
      project.getByRole('button', { name: 'Mostrar detalhes', exact: true })
    ).toHaveAttribute('aria-expanded', 'false');
  }
  await project
    .getByRole('button', { name: 'Mostrar detalhes', exact: true })
    .click();
  await expect(
    project.getByRole('button', { name: 'Ocultar detalhes', exact: true })
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    project.locator('.rdo-archived-project-card__details dl')
  ).toBeVisible();

  await expect(
    project.locator('.rdo-archived-project-card__meta .fv-badge')
  ).toHaveCount(0);
  await expect(project.getByText('Apto para restaurar', { exact: true })).toHaveCount(0);
  await expect(
    project.locator('.rdo-archived-project-card__selection')
  ).toHaveCount(0);

  await projectTitleToggle.click();
  await expect(reportsDialog).toBeVisible();
  const typeToggle = reportsDialog.locator('.rdo-archived-report-type__toggle').first();
  if ((await typeToggle.getAttribute('aria-expanded')) !== 'true') await typeToggle.click();
  await typeToggle.click();
  await expect(typeToggle).toHaveAttribute('aria-expanded', 'false');
  await typeToggle.click();
  await expect(typeToggle).toHaveAttribute('aria-expanded', 'true');
  const reportTypeSection = reportsDialog
    .locator('.rdo-archived-report-type')
    .first();
  const batchToolbar = reportTypeSection.locator(
    '.rdo-manager-listing__batch-toolbar'
  );
  await expect(
    batchToolbar.getByRole('button', { name: 'Selecionar todos', exact: true })
  ).toBeVisible();

  const reportCheckbox = reportTypeSection
    .getByRole('checkbox', { name: /^Selecionar (?!todos)/ })
    .first();
  await reportCheckbox.check();
  await expect(batchToolbar).toBeVisible();
  await expect(batchToolbar.getByText(/selecionado\(s\)/)).toBeVisible();
  await expect(
    batchToolbar.getByRole('button', { name: 'Baixar PDF', exact: true })
  ).toBeVisible();
  await expect(
    batchToolbar.getByRole('button', { name: 'Baixar DOCX', exact: true })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(reportsDialog).toBeHidden();
  await expect(projectTitleToggle).toBeFocused();

  const filters = page.locator('.rdo-archived-projects__filters');
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

  const search = page.getByRole('searchbox', { name: 'Buscar em arquivados' });
  await search.fill('projeto-inexistente-b12');
  await expect(
    surface.getByText('Nenhum projeto arquivado encontrado.', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
  await expect(surface.locator('.rdo-archived-project-card')).not.toHaveCount(
    0
  );

  expect(mutationAttempts).toEqual([]);
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=arquivados$/);
});

test('Arquivados valida desktop/mobile em light/dark sem overflow', async ({
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
  const surface = await openArchivedPage(page);
  const project = await projectWithReports(page, surface);

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
    await expectComfortableTapTargets(page, '.rdo-archived-projects');
    await expect(project).toHaveCSS(
      'background-color',
      scenario.theme === 'dark' ? 'rgb(22, 33, 27)' : 'rgb(255, 255, 255)'
    );
    await expect(surface).not.toHaveClass(/(?:^|\s)page-card(?:\s|$)/);
    await expect(
      surface.locator(
        ':scope > .rdo-archived-projects__list > .admin-card, ' +
          '.rdo-archived-project-card > .fv-card__footer .mini-btn, ' +
          '.rdo-archived-report-type > .report-type-header, ' +
          '.rdo-archived-report-type .rtype-badge'
      )
    ).toHaveCount(0);

    if (scenario.width < 768) {
      const quickActions = project.locator(
        ':scope > .fv-card__header > .fv-card__actions'
      );
      const reportsButton = project.locator(
        '.rdo-archived-project-card__reports-toggle'
      );
      await expect(quickActions).toBeVisible();
      await expect
        .poll(() =>
          quickActions.evaluate(
            element => element.scrollWidth <= element.clientWidth
          )
        )
        .toBe(true);
      const quickActionsBox = await quickActions.boundingBox();
      const reportsButtonBox = await reportsButton.boundingBox();
      expect(quickActionsBox).toBeTruthy();
      expect(reportsButtonBox).toBeTruthy();
      const quickActionsCenterY = (quickActionsBox?.y || 0) + (quickActionsBox?.height || 0) / 2;
      const reportsButtonCenterY = (reportsButtonBox?.y || 0) + (reportsButtonBox?.height || 0) / 2;
      expect(Math.abs(quickActionsCenterY - reportsButtonCenterY)).toBeLessThan(2);
      expect((reportsButtonBox?.x || 0) < (quickActionsBox?.x || 0)).toBe(true);
    }
    await project.locator('.rdo-archived-project-card__reports-toggle').click();
    const dialog = page.getByRole('dialog', { name: 'Relatórios do projeto', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.fv-data-table__mobile').first()).toBeVisible();
    await expect(dialog.locator('.fv-data-table__desktop')).toHaveCount(0);
    await expectNoHorizontalOverflow(page, dialog);
    const box = await dialog.boundingBox();
    expect(box?.height).toBeLessThan(scenario.height);
    expect(box?.width).toBeLessThan(scenario.width);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});
