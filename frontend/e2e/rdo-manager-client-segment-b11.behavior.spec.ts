import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  demoCredentials,
  expectComfortableTapTargets,
  expectManagerRdoMobileNavigation,
  expectManagerRdoShell,
  loginAs
} from './support/rdo';

const MANAGER_PROJECTS_URL = '/rdo/gestor?tab=projetos';

interface ClientSegment {
  id: string;
  label: string;
  slug: string;
  isActive: boolean;
  order: number;
}

interface GestorBootstrapResponse {
  projectSegments: ClientSegment[];
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
    // A novidade só aparece quando há projeto pendente para o usuário atual.
  }
}

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

async function expectNoHorizontalOverflow(page: Page, dialog: Locator) {
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
      dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)
    )
    .toBe(true);
}

async function openNewProjectForm(page: Page) {
  await page
    .getByRole('button', { name: /Novo projeto/, exact: false })
    .click();
  const projectForm = page.locator('form.admin-inline-grid').filter({
    has: page.locator('#project-segment')
  });
  await expect(projectForm).toBeVisible();
  return projectForm;
}

async function openSegmentDialog(page: Page, projectForm: Locator) {
  const launcher = projectForm.getByRole('button', {
    name: /Adicionar segmento/,
    exact: false
  });
  await launcher.click();

  const dialog = page.getByRole('dialog', { name: 'Adicionar segmento' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/\bfv-modal\b/);
  await expect(dialog).toHaveClass(/\brdo-manager-segment-dialog\b/);
  await expect(dialog).toHaveAttribute(
    'aria-labelledby',
    'client-segment-title'
  );
  await expect(
    dialog.getByRole('heading', { name: 'Adicionar segmento', level: 2 })
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Fechar', exact: true })
  ).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Nome' })).toBeFocused();
  return { dialog, launcher };
}

test('B.11 preserva validação, Escape, Cancelar e restauração de foco', async ({
  page
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const mutationAttempts: string[] = [];

  page.on('request', (request) => {
    if (
      request.method() !== 'GET' &&
      new URL(request.url()).pathname.endsWith('/project-segments')
    ) {
      mutationAttempts.push(`${request.method()} ${request.url()}`);
    }
  });

  await loginAs(page, demoCredentials.manager);
  await page.goto(MANAGER_PROJECTS_URL);
  await expectManagerRdoShell(page);
  await dismissProjectNoveltyIfVisible(page);
  const projectForm = await openNewProjectForm(page);

  let { dialog, launcher } = await openSegmentDialog(page, projectForm);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launcher).toBeFocused();

  ({ dialog, launcher } = await openSegmentDialog(page, projectForm));
  const input = dialog.getByRole('textbox', { name: 'Nome' });
  await dialog
    .getByRole('button', { name: 'Salvar segmento', exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(input).toHaveJSProperty('validity.valueMissing', true);
  expect(mutationAttempts).toEqual([]);

  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=projetos$/);
});

test('B.11 envia o payload preservado, invalida bootstrap e seleciona o segmento', async ({
  page
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });

  let bootstrap: GestorBootstrapResponse | undefined;
  let bootstrapRequests = 0;
  let created = false;
  const createdSegment: ClientSegment = {
    id: 'segment-b11-e2e',
    label: 'Óleo & Gás 2026',
    slug: 'oleo_gas_2026',
    isActive: true,
    order: 0
  };

  await page.route('**/bootstrap/gestor', async (route) => {
    bootstrapRequests += 1;
    if (!bootstrap) {
      const response = await route.fetch();
      bootstrap = (await response.json()) as GestorBootstrapResponse;
      await route.fulfill({ response, json: bootstrap });
      return;
    }

    await route.fulfill({
      json: {
        ...bootstrap,
        projectSegments: created
          ? [...bootstrap.projectSegments, createdSegment]
          : bootstrap.projectSegments
      }
    });
  });

  let releaseCreate: (() => void) | undefined;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  let submittedPayload: unknown;
  await page.route('**/project-segments', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    submittedPayload = route.request().postDataJSON();
    await createGate;
    created = true;
    await route.fulfill({ status: 201, json: createdSegment });
  });

  await loginAs(page, demoCredentials.manager);
  await page.goto(MANAGER_PROJECTS_URL);
  await expectManagerRdoShell(page);
  await dismissProjectNoveltyIfVisible(page);
  const projectForm = await openNewProjectForm(page);
  const { dialog } = await openSegmentDialog(page, projectForm);
  createdSegment.order = (bootstrap?.projectSegments.length ?? 0) + 1;

  await dialog
    .getByRole('textbox', { name: 'Nome' })
    .fill(createdSegment.label);
  const submit = dialog.locator('button[type="submit"]');
  await submit.click();

  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect(
    dialog.getByRole('button', { name: 'Cancelar', exact: true })
  ).toBeDisabled();
  expect(submittedPayload).toEqual({
    label: createdSegment.label,
    slug: createdSegment.slug,
    isActive: true,
    order: createdSegment.order
  });

  releaseCreate?.();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText('Segmento criado.', { exact: true })
  ).toBeVisible();
  await expect(projectForm.locator('#project-segment')).toHaveValue(
    createdSegment.slug
  );
  await expect.poll(() => bootstrapRequests).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=projetos$/);
});

test('B.11 valida desktop/mobile em light/dark sem overflow', async ({
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
  await page.goto(MANAGER_PROJECTS_URL);
  await dismissProjectNoveltyIfVisible(page);
  const projectForm = await openNewProjectForm(page);

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
    const { dialog, launcher } = await openSegmentDialog(page, projectForm);

    await expectNoHorizontalOverflow(page, dialog);
    await expectComfortableTapTargets(page, '.rdo-manager-segment-dialog');
    await expect(dialog).toHaveCSS(
      'background-color',
      scenario.theme === 'dark' ? 'rgb(22, 33, 27)' : 'rgb(255, 255, 255)'
    );
    await page.keyboard.press('Escape');
    await expect(dialog, `${scenario.name}: diálogo fechou`).toHaveCount(0);
    await expect(launcher, `${scenario.name}: foco restaurado`).toBeFocused();
  }
});
