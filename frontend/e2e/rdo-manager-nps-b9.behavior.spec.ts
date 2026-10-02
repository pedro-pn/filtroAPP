import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  demoCredentials,
  expectComfortableTapTargets,
  expectManagerRdoShell,
  loginAs
} from './support/rdo';

const MANAGER_NPS_URL = '/rdo/gestor?tab=nps';
const EXPECTED_SURVEY_COUNT = 30;
const EXPECTED_GROUP_COUNT = 26;
const MUTATING_METHODS = new Set(['PUT', 'PATCH', 'DELETE']);
// O bootstrap do Gestor usa um POST de leitura; só ele pode passar.
const READ_ONLY_POSTS = [/\/reports\/counts$/];

type NpsAppearance = 'legacy' | 'design-system';

const expectedAppearance: NpsAppearance = (() => {
  const value = process.env.RDO_B9_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(
    `RDO_B9_EXPECT_APPEARANCE inválido: ${value}. Use legacy ou design-system.`
  );
})();

const designSystem = expectedAppearance === 'design-system';
const SURFACE = designSystem ? '.fv-ds.rdo-nps' : '.nps-tab-content';

function groups(surface: Locator) {
  return designSystem
    ? surface.locator('[data-nps-group]')
    : surface.locator('article.admin-card');
}

function surveys(surface: Locator) {
  return designSystem
    ? surface.locator('[data-nps-survey]')
    : surface.locator('.report-type-group');
}

function toggles(surface: Locator) {
  return designSystem
    ? surface.locator('.rdo-nps__toggle')
    : surface.locator('.client-account-group-toggle');
}

async function expectNoDocumentOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.body.scrollWidth <= window.innerWidth
      )
    )
    .toBe(true);
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  const toggle = page.locator('.fv-theme-toggle').first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );
    if (current === theme) return;
    await toggle.click();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.getAttribute('data-theme'))
      )
      .toBeTruthy();
  }
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    )
    .toBe(theme);
}

test('B.9 caracteriza a aba NPS real sem reenviar pesquisas', async ({
  page
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const downloads: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('download', (download) => downloads.push(download.url()));

  await loginAs(page, demoCredentials.manager);
  await page.goto(MANAGER_NPS_URL);
  await expectManagerRdoShell(page);
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=nps$/);

  const managerTab = page
    .locator('.fv-sidebar')
    .getByRole('link', { name: 'NPS', exact: true });
  await expect(managerTab).toHaveAttribute('aria-current', 'page');

  const surface = page.locator(SURFACE);
  await expect(surface).toBeVisible();

  // O bloqueio entra depois do bootstrap, que precisa do POST de contagem.
  const mutatingAttempts: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = request.url();
    const isReadOnlyPost =
      method === 'POST' && READ_ONLY_POSTS.some((rule) => rule.test(url));

    if (
      MUTATING_METHODS.has(method) ||
      (method === 'POST' && !isReadOnlyPost)
    ) {
      mutatingAttempts.push(`${method} ${url}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  if (designSystem) {
    await expect(surface).not.toHaveClass(/page-card/);
    await expect(
      surface.getByRole('heading', { name: 'NPS', level: 1 })
    ).toBeVisible();
    await expect(surface.locator('.fv-metric-card')).toHaveCount(4);
    await expect(surface.locator('.status-pill')).toHaveCount(0);
  } else {
    await expect(surface).not.toHaveClass(/fv-ds/);
    await expect(surface.locator('h2, h3')).toHaveCount(0);
  }

  // Quantidade e ordem reais.
  await expect(groups(surface)).toHaveCount(EXPECTED_GROUP_COUNT);
  await expect(surveys(surface)).toHaveCount(EXPECTED_SURVEY_COUNT);

  const titleSelector = designSystem
    ? '.rdo-nps__group-title'
    : '.admin-card-title';
  const readTitles = () =>
    surface
      .locator(titleSelector)
      .evaluateAll((nodes) =>
        nodes.map((node) => node.textContent?.trim() ?? '')
      );

  const ascending = await readTitles();
  const sortedAscending = [...ascending].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
  );
  expect(ascending).toEqual(sortedAscending);

  // Ordenação Z→A e volta para A→Z.
  const sortButton = surface.getByRole('button', {
    name: /^Ordenar projetos de [AZ] a [AZ]$/
  });
  await sortButton.click();
  await expect
    .poll(async () => (await readTitles()).join('|'))
    .not.toBe(ascending.join('|'));
  const descending = await readTitles();
  expect(descending).toEqual([...ascending].reverse());
  await sortButton.click();
  await expect
    .poll(async () => (await readTitles()).join('|'))
    .toBe(ascending.join('|'));

  // Busca do Gestor filtra a aba NPS (contrato distinto de Cargos/DDS).
  const search = page.getByRole('searchbox', {
    name: 'Buscar em pesquisas NPS'
  });
  await expect(search).toBeVisible();
  const absentTerm = `nps-b9-inexistente-${Date.now()}`;
  await search.fill(absentTerm);
  await expect(groups(surface)).toHaveCount(0);
  await expect(
    surface.getByText('Nenhuma pesquisa encontrada.', { exact: true })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=nps$/);
  await page.getByRole('button', { name: 'Limpar busca' }).click();
  await expect(search).toHaveValue('');
  await expect(groups(surface)).toHaveCount(EXPECTED_GROUP_COUNT);

  // Acordeão: expansão, atributos ARIA e nome acessível distinguível.
  const firstToggle = toggles(surface).first();
  const secondToggle = toggles(surface).nth(1);

  if (designSystem) {
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
    const controls = await firstToggle.getAttribute('aria-controls');
    expect(controls).toMatch(/^rdo-nps-panel-/);

    const firstName = await firstToggle.getAttribute('aria-label');
    const secondName = await secondToggle.getAttribute('aria-label');
    expect(firstName).toMatch(/^Pesquisa #\d+ — .+/);
    expect(firstName).not.toBe(secondName);

    const allNames = await toggles(surface).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? '')
    );
    expect(new Set(allNames).size).toBe(allNames.length);
  }

  await firstToggle.click();
  if (designSystem) {
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
    const controls = await firstToggle.getAttribute('aria-controls');
    await expect(page.locator(`#${controls}`)).toBeVisible();
  }

  // Somente uma pesquisa permanece expandida.
  await secondToggle.click();
  if (designSystem) {
    await expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(
      surface.locator('.rdo-nps__toggle[aria-expanded="true"]')
    ).toHaveCount(1);
  }

  // Fechamento pelo próprio toggle.
  await secondToggle.click();
  if (designSystem) {
    await expect(secondToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(
      surface.locator('.rdo-nps__toggle[aria-expanded="true"]')
    ).toHaveCount(0);
  }

  // "Reenviar pesquisa" só aparece para pesquisa sem resposta de projeto
  // inativo — e nunca é acionada.
  const resend = surface.getByRole('button', { name: 'Reenviar pesquisa' });
  const resendCount = await resend.count();
  const eligible = await surveys(surface).evaluateAll(
    (nodes) =>
      nodes.filter((node) => {
        const meta = node.textContent ?? '';
        return /Respondida:\s*-/.test(meta);
      }).length
  );
  expect(resendCount).toBeLessThanOrEqual(eligible);
  for (let index = 0; index < resendCount; index += 1) {
    await expect(resend.nth(index)).toBeEnabled();
  }

  // Sem persistência: recarregar volta ao estado inicial do acordeão.
  await firstToggle.click();
  await page.reload();
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=nps$/);
  const reloadedSurface = page.locator(SURFACE);
  await expect(reloadedSurface).toBeVisible();
  if (designSystem) {
    await expect(
      reloadedSurface.locator('.rdo-nps__toggle[aria-expanded="true"]')
    ).toHaveCount(0);
  }
  await expect(groups(reloadedSurface)).toHaveCount(EXPECTED_GROUP_COUNT);

  // Responsividade e temas.
  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setTheme(page, theme);

    for (const width of [375, 480, 768, 1024, 1280, 1536]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoDocumentOverflow(page);
      await expect(groups(reloadedSurface)).toHaveCount(EXPECTED_GROUP_COUNT);
    }

    if (designSystem) {
      await page.setViewportSize({ width: 1280, height: 900 });
      const contrast = await reloadedSurface.evaluate((element) => {
        const relativeLuminance = (rgb: number[]) => {
          const [r, g, b] = rgb.slice(0, 3).map((channel) => {
            const value = channel / 255;
            return value <= 0.03928
              ? value / 12.92
              : Math.pow((value + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const parse = (color: string) =>
          (color.match(/\d+(\.\d+)?/g) ?? []).map(Number);

        const group = element.querySelector('[data-nps-group]');
        const title = group?.querySelector('.rdo-nps__group-title');
        if (!group || !title) return null;
        const background = relativeLuminance(
          parse(window.getComputedStyle(group).backgroundColor)
        );
        const foreground = relativeLuminance(
          parse(window.getComputedStyle(title).color)
        );
        return (
          (Math.max(background, foreground) + 0.05) /
          (Math.min(background, foreground) + 0.05)
        );
      });
      expect(contrast, `contraste insuficiente em ${theme}`).toBeGreaterThan(
        4.5
      );
    }
  }

  await setTheme(page, 'light');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoDocumentOverflow(page);
  if (designSystem) {
    await expectComfortableTapTargets(page, SURFACE);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  if (designSystem) {
    await expectComfortableTapTargets(page, SURFACE);

    // O dashboard detalhado usa o mesmo DS, sem alterar o fluxo de entrada
    // da aba nem disparar as ações de acompanhamento dos detratores.
    const dashboardLauncher = reloadedSurface.getByRole('button', {
      name: 'Abrir dashboard NPS'
    });
    await dashboardLauncher.click();

    const dashboardDialog = page.getByRole('dialog', {
      name: 'Dashboard NPS'
    });
    await expect(dashboardDialog).toBeVisible();
    await expect(
      dashboardDialog.locator('.rdo-nps-dashboard')
    ).toBeVisible();
    await expect(
      dashboardDialog.getByRole('heading', { name: 'Visão executiva' })
    ).toBeVisible();
    await expect(dashboardDialog.locator('.fv-metric-card')).toHaveCount(4);
    await expect(dashboardDialog.getByRole('combobox')).toHaveCount(2);

    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoDocumentOverflow(page);
      await expect(dashboardDialog).toBeVisible();
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await dashboardDialog.getByRole('button', { name: 'Voltar' }).click();
    await expect(dashboardDialog).toBeHidden();
    await expect(dashboardLauncher).toBeFocused();
  }

  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=nps$/);
  await expect(managerTab).toHaveAttribute('aria-current', 'page');
  expect(mutatingAttempts).toEqual([]);
  expect(downloads).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.unroute('**/*');
});
