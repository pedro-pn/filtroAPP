import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  demoCredentials,
  expectComfortableTapTargets,
  expectManagerRdoShell,
  loginAs
} from './support/rdo';

const MANAGER_TEAM_URL = '/rdo/gestor?tab=equipe';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type DdsThemesAppearance = 'legacy' | 'design-system';

const expectedAppearance: DdsThemesAppearance = (() => {
  const value = process.env.RDO_B8_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(
    `RDO_B8_EXPECT_APPEARANCE inválido: ${value}. Use legacy ou design-system.`
  );
})();

interface DdsThemeResponse {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
}

function themeRows(surface: Locator) {
  return expectedAppearance === 'design-system'
    ? surface.locator(
        '.fv-data-table__desktop tbody tr:has([data-dds-theme-name])'
      )
    : surface.locator('ul.admin-stack > li');
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

async function expectLauncherFocus(
  page: Page,
  launcher: Locator,
  shouldRestore: boolean
) {
  if (shouldRestore) {
    await expect(launcher).toBeFocused();
    return;
  }
  await expect
    .poll(() => page.evaluate(() => document.activeElement === document.body))
    .toBe(true);
}

test('B.8 caracteriza Temas de DDS reais sem criar, renomear ou alterar status', async ({
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

  const managerTab = page
    .locator('.fv-sidebar')
    .getByRole('link', { name: 'Equipe', exact: true });
  const teamTabs = page.getByRole('tablist', { name: 'Seções da equipe' });
  const themesTab = teamTabs.getByRole('tab', {
    name: 'Temas de DDS',
    exact: true
  });
  const search = page.getByRole('searchbox', { name: 'Buscar na equipe' });

  const mutatingAttempts: string[] = [];
  let releaseThemesResponse: (() => void) | undefined;
  const themesResponseGate = new Promise<void>((resolve) => {
    releaseThemesResponse = resolve;
  });
  let observeThemes: ((themes: DdsThemeResponse[]) => void) | undefined;
  const themesPayload = new Promise<DdsThemeResponse[]>((resolve) => {
    observeThemes = resolve;
  });
  let heldThemesRequest = false;

  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const isReadOnlyReportCount =
      method === 'POST' && url.pathname.endsWith('/rdo/reports/counts');

    if (MUTATING_METHODS.has(method) && !isReadOnlyReportCount) {
      mutatingAttempts.push(`${method} ${request.url()}`);
      await route.abort('blockedbyclient');
      return;
    }

    if (
      !heldThemesRequest &&
      method === 'GET' &&
      url.pathname.endsWith('/rdo/dds-themes') &&
      url.searchParams.get('all') === 'true'
    ) {
      heldThemesRequest = true;
      const response = await route.fetch();
      const themes = (await response.json()) as DdsThemeResponse[];
      observeThemes?.(themes);
      await themesResponseGate;
      await route.fulfill({ response });
      return;
    }

    await route.continue();
  });

  await page.goto(MANAGER_TEAM_URL);
  await expectManagerRdoShell(page);
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=equipe$/);
  await expect(managerTab).toHaveAttribute('aria-current', 'page');
  await expect(search).toBeVisible();

  await themesTab.click();
  await expect(themesTab).toHaveAttribute('aria-selected', 'true');
  const themes = await themesPayload;
  expect(
    themes.length,
    'O backend real deve fornecer ao menos um tema de DDS'
  ).toBeGreaterThan(0);

  const loading = page.getByText('Carregando temas…', { exact: true });
  await expect(loading).toBeAttached();
  releaseThemesResponse?.();
  await expect(loading).toHaveCount(0);

  const surface =
    expectedAppearance === 'design-system'
      ? page.locator('.rdo-dds-themes.fv-ds')
      : page.locator('.page-card').filter({ hasText: 'Temas de DDS' }).first();
  await expect(surface).toBeVisible();
  if (expectedAppearance === 'design-system') {
    await expect(surface).not.toHaveClass(/page-card/);
    await expect(surface.locator('.fv-data-table__desktop')).toBeVisible();
    await expect(
      surface.getByRole('heading', { name: 'Temas de DDS', level: 2 })
    ).toBeVisible();
  } else {
    await expect(surface).not.toHaveClass(/fv-ds/);
    await expect(surface.locator('.fv-data-table')).toHaveCount(0);
  }

  const rows = themeRows(surface);
  await expect(rows).toHaveCount(themes.length);
  const renderedNames = await rows.evaluateAll((items) =>
    items.map(
      (item) =>
        item
          .querySelector('[data-dds-theme-name]')
          ?.getAttribute('data-dds-theme-name') ?? ''
    )
  );
  if (expectedAppearance === 'design-system') {
    expect(renderedNames).toEqual(themes.map((theme) => theme.name));
  } else {
    const legacyNames = await rows.evaluateAll((items) =>
      items.map((item) => item.querySelector('span')?.textContent ?? '')
    );
    expect(legacyNames).toEqual(
      themes.map(
        (theme) => `${theme.name}${theme.isActive ? '' : ' (inativo)'}`
      )
    );
  }

  // A busca compartilhada da Equipe filtra a superfície atualmente selecionada.
  const absentTerm = `tema-b8-inexistente-${Date.now()}`;
  await search.fill(absentTerm);
  await expect(rows).toHaveCount(0);
  await expect(page.getByText('Nenhum tema de DDS encontrado.')).toBeVisible();
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=equipe$/);
  await page.getByRole('button', { name: 'Limpar busca' }).click();
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(themes.length);

  const newThemeLauncher =
    expectedAppearance === 'design-system'
      ? page.getByRole('button', { name: 'Novo tema', exact: true })
      : surface.getByRole('button', { name: /Novo tema$/ });
  await newThemeLauncher.click();
  const createInput = surface.getByRole('textbox', { name: 'Nome do tema' });
  await expect(createInput).toHaveValue('');
  await expect(createInput).toHaveAttribute('required', '');
  await expect(
    surface.getByRole('button', { name: 'Salvar' }).first()
  ).toBeDisabled();
  if (expectedAppearance === 'design-system') {
    await expect(createInput).toBeFocused();

    // O anel de foco é desenhado apenas pelo control shell (conflito da B.6).
    const focusRings = await createInput.evaluate((element) => {
      const shell = element.closest('.fv-control-shell');
      const styles = window.getComputedStyle(element);
      const shellStyles = shell ? window.getComputedStyle(shell) : null;
      return {
        input: styles.outlineStyle,
        shell: shellStyles ? shellStyles.outlineStyle : null
      };
    });
    expect(focusRings.input).toBe('none');
    expect(focusRings.shell).toBe('solid');
  } else {
    await expect
      .poll(() => page.evaluate(() => document.activeElement === document.body))
      .toBe(true);
  }

  await createInput.fill('Tema temporário que não será salvo');
  await expect(
    surface.getByRole('button', { name: 'Salvar' }).first()
  ).toBeEnabled();
  await surface.getByRole('button', { name: 'Cancelar' }).first().click();
  await expect(createInput).toHaveCount(0);
  await expectLauncherFocus(
    page,
    newThemeLauncher,
    expectedAppearance === 'design-system'
  );

  await newThemeLauncher.click();
  await expect(createInput).toHaveValue('');
  await page.keyboard.press('Escape');
  if (expectedAppearance === 'design-system') {
    await expect(createInput).toHaveCount(0);
    await expect(newThemeLauncher).toBeFocused();
  } else {
    await expect(createInput).toBeVisible();
    await surface.getByRole('button', { name: 'Cancelar' }).first().click();
  }

  const firstTheme = themes[0];
  expect(
    firstTheme,
    'A lista real de temas de DDS não pode estar vazia'
  ).toBeDefined();
  const firstRow =
    expectedAppearance === 'design-system'
      ? surface.locator('.fv-data-table__desktop tbody tr').first()
      : themeRows(surface).first();
  const renameLauncher = firstRow.getByRole('button', {
    name: 'Renomear',
    exact: true
  });
  await renameLauncher.click();
  const renameInput = firstRow.locator('input');
  await expect(renameInput).toHaveValue(firstTheme.name);
  if (expectedAppearance === 'design-system') {
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveAccessibleName(
      `Novo nome para ${firstTheme.name}`
    );
    await renameInput.fill('   ');
    await expect(
      firstRow.getByRole('button', { name: 'Salvar', exact: true })
    ).toBeDisabled();
    await renameInput.fill(firstTheme.name);
  } else {
    await expect(renameInput).not.toBeFocused();
    await expect(renameInput).toHaveAccessibleName('');
  }

  await page.keyboard.press('Escape');
  if (expectedAppearance === 'design-system') {
    await expect(renameInput).toHaveCount(0);
    await expect(renameLauncher).toBeFocused();
  } else {
    await expect(renameInput).toBeVisible();
    await firstRow.getByRole('button', { name: 'Cancelar' }).click();
  }

  await renameLauncher.click();
  await firstRow.getByRole('button', { name: 'Cancelar' }).click();
  await expect(renameInput).toHaveCount(0);
  if (expectedAppearance === 'design-system') {
    await expect(renameLauncher).toBeFocused();
  }

  // Nada foi renomeado: os nomes reais continuam intactos.
  await expect(rows).toHaveCount(themes.length);

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoDocumentOverflow(page);
  if (expectedAppearance === 'design-system') {
    await expect(surface.locator('table')).toHaveCount(0);
    await expect(surface.locator('.fv-data-table__desktop')).toHaveCount(0);
    await expect(surface.locator('.fv-mobile-list')).toBeVisible();

    // As ações compactas desenham uma caixa menor de propósito; o que precisa
    // ser garantido é a área de toque efetiva, não o tamanho da caixa.
    await expectComfortableTapTargets(page, '.rdo-dds-themes.fv-ds');

    const undersizedInputs = await surface
      .locator('input')
      .evaluateAll((elements) =>
        elements.flatMap((element) => {
          const target = element as HTMLElement;
          const rect = target.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return [];
          return rect.height >= 44
            ? []
            : [target.getAttribute('aria-label') || target.tagName];
        })
      );
    expect(undersizedInputs).toEqual([]);

    await newThemeLauncher.click();
    await expect(createInput).toBeVisible();
    const mobileInputFontSizes = await surface
      .locator('input')
      .evaluateAll((elements) =>
        elements.map((element) =>
          parseFloat(window.getComputedStyle(element).fontSize)
        )
      );
    for (const fontSize of mobileInputFontSizes) {
      expect(fontSize).toBeGreaterThanOrEqual(16);
    }
    await expectNoDocumentOverflow(page);
    await surface.getByRole('button', { name: 'Cancelar' }).first().click();
    await expect(createInput).toHaveCount(0);
  }

  await page.setViewportSize({ width: 768, height: 1024 });
  await expectNoDocumentOverflow(page);
  if (expectedAppearance === 'design-system') {
    await expect(surface.locator('.fv-mobile-list')).toHaveCount(0);
    await expect(surface.locator('.fv-data-table__desktop')).toBeVisible();
  }

  // Light e dark: a superfície acompanha o tema real do AppShell.
  await page.setViewportSize({ width: 1280, height: 900 });
  if (expectedAppearance === 'design-system') {
    const themeToggle = page.locator('.fv-theme-toggle').first();
    for (const wanted of ['dark', 'light'] as const) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const current = await page.evaluate(() =>
          document.documentElement.getAttribute('data-theme')
        );
        if (current === wanted) break;
        await themeToggle.click();
      }
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.documentElement.getAttribute('data-theme')
          )
        )
        .toBe(wanted);

      // O nome do tema precisa contrastar com o fundo real do cartão.
      const contrast = await surface.evaluate((element) => {
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

        const name = element.querySelector('[data-dds-theme-name]');
        if (!name) return null;
        let backgroundElement: Element | null = name;
        let backgroundColor: number[] = [];
        while (backgroundElement) {
          backgroundColor = parse(
            window.getComputedStyle(backgroundElement).backgroundColor
          );
          if (backgroundColor.length >= 3 && backgroundColor[3] !== 0) break;
          backgroundElement = backgroundElement.parentElement;
        }
        const background = relativeLuminance(backgroundColor);
        const foreground = relativeLuminance(
          parse(window.getComputedStyle(name).color)
        );
        return (
          (Math.max(background, foreground) + 0.05) /
          (Math.min(background, foreground) + 0.05)
        );
      });
      expect(contrast, `contraste insuficiente em ${wanted}`).toBeGreaterThan(
        4.5
      );
      await expectNoDocumentOverflow(page);
    }
  }

  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=equipe$/);
  await expect(managerTab).toHaveAttribute('aria-current', 'page');
  await expect(themesTab).toHaveAttribute('aria-selected', 'true');
  expect(mutatingAttempts).toEqual([]);
  expect(downloads).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.unroute('**/*');
});
