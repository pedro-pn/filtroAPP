import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  demoCredentials,
  expectComfortableTapTargets,
  expectManagerRdoShell,
  loginAs
} from './support/rdo';

const MANAGER_PROJECTS_URL = '/rdo/gestor?tab=projetos';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type ArchiveDialogAppearance = 'legacy' | 'design-system';

const expectedAppearance: ArchiveDialogAppearance = (() => {
  const value = process.env.RDO_B10_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(
    `RDO_B10_EXPECT_APPEARANCE inválido: ${value}. Use legacy ou design-system.`
  );
})();

const designSystem = expectedAppearance === 'design-system';
const screenshotDirectory = process.env.RDO_B10_SCREENSHOT_DIR;

interface BootstrapProject {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  clientEmailPrimary: string;
}

interface GestorBootstrapResponse {
  activeProjects: BootstrapProject[];
}

function projectTitle(project: BootstrapProject) {
  const name = String(project.name || '').trim();
  return name ? `${project.code} - ${name}` : `Missão ${project.code}`;
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
    // O tutorial só existe enquanto houver novidade pendente para este usuário.
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

async function expectDialogAppearance(dialog: Locator) {
  if (designSystem) {
    await expect(dialog).toHaveClass(/\bfv-modal\b/);
    await expect(dialog).toHaveClass(/\brdo-manager-archive-project-dialog\b/);
    await expect(dialog).not.toHaveClass(/\bmodal-card\b/);
    await expect(
      dialog.getByRole('heading', { name: 'Arquivar projeto', level: 2 })
    ).toBeVisible();
    return;
  }

  await expect(dialog).toHaveClass(/\bmodal-card\b/);
  await expect(dialog).not.toHaveClass(/\bfv-modal\b/);
  await expect(dialog.getByRole('heading')).toHaveCount(0);
}

test('B.10 caracteriza o diálogo de arquivamento sem alterar projetos', async ({
  page
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const downloads: string[] = [];
  const mutatingAttempts: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('download', (download) => downloads.push(download.url()));

  await loginAs(page, demoCredentials.manager);

  const bootstrapResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname.endsWith('/rdo/bootstrap/gestor')
  );
  await page.goto(MANAGER_PROJECTS_URL);
  const bootstrap = (await (
    await bootstrapResponse
  ).json()) as GestorBootstrapResponse;

  const eligibleProjects = bootstrap.activeProjects
    .filter(
      (project) =>
        project.isActive && Boolean(project.clientEmailPrimary?.trim())
    )
    .sort((left, right) =>
      projectTitle(left).localeCompare(projectTitle(right), 'pt-BR', {
        numeric: true,
        sensitivity: 'base'
      })
    );
  const eligibleProject = eligibleProjects[0];
  expect(
    eligibleProject,
    'O backend real precisa fornecer ao menos um projeto ativo com e-mail principal'
  ).toBeDefined();

  await expectManagerRdoShell(page);
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=projetos$/);
  await expect(
    page.locator('.fv-sidebar').getByRole('link', {
      name: 'Projetos',
      exact: true
    })
  ).toHaveAttribute('aria-current', 'page');
  await dismissProjectNoveltyIfVisible(page);

  const title = projectTitle(eligibleProject);
  const projectCard = page.locator('.rdo-active-project-card').filter({
    has: page.locator('.rdo-archived-project-card__title', { hasText: title })
  });
  await expect(projectCard).toHaveCount(1);
  const launcher = projectCard.getByRole('button', {
    name: 'Arquivar',
    exact: true
  });
  await expect(launcher).toBeVisible();

  // O bloqueio entra somente após login/bootstrap e antes da abertura. Assim,
  // qualquer efeito de domínio disparado pelo diálogo falha o teste sem tocar o
  // banco real.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (MUTATING_METHODS.has(method)) {
      mutatingAttempts.push(`${method} ${request.url()}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const openDialog = async () => {
    await launcher.scrollIntoViewIfNeeded();
    await launcher.click();
    const dialog = page.getByRole('dialog', { name: 'Arquivar projeto' });
    await expect(dialog).toBeVisible();
    await expectDialogAppearance(dialog);
    await expect(dialog).toHaveAttribute(
      'aria-labelledby',
      'archive-survey-title'
    );
    await expect(dialog).toHaveAttribute(
      'aria-describedby',
      'archive-survey-description'
    );
    await expect(
      dialog.getByText(
        'Deseja arquivar o projeto e enviar a pesquisa de satisfação ao cliente?',
        { exact: true }
      )
    ).toBeVisible();
    for (const name of ['Cancelar', 'Arquivar sem enviar', 'Enviar pesquisa']) {
      await expect(
        dialog.getByRole('button', { name, exact: true })
      ).toBeEnabled();
    }
    await expect(
      dialog.getByRole('button', { name: 'Cancelar', exact: true })
    ).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe('hidden');
    await expect(page).toHaveURL(/\/rdo\/gestor\?tab=projetos$/);
    return dialog;
  };

  // Escape preserva fechamento e restaura o gatilho determinístico.
  let dialog = await openDialog();
  const cancelButton = dialog.getByRole('button', {
    name: 'Cancelar',
    exact: true
  });
  const sendButton = dialog.getByRole('button', {
    name: 'Enviar pesquisa',
    exact: true
  });
  await page.keyboard.press('Shift+Tab');
  if (designSystem) {
    const closeButton = dialog.getByRole('button', {
      name: 'Fechar',
      exact: true
    });
    await expect(closeButton).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(sendButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();
  } else {
    await expect(sendButton).toBeFocused();
  }

  // O backdrop é somente scrim: clicar fora não fecha o diálogo.
  const backdrop = designSystem
    ? page.locator('.fv-modal-backdrop')
    : page.locator('.modal-backdrop');
  await backdrop.click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeVisible();
  await cancelButton.focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe('');

  // Cancelar preserva o mesmo contrato.
  dialog = await openDialog();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(launcher).toBeFocused();

  // O botão Fechar pertence apenas ao chrome DS e também restaura o foco.
  dialog = await openDialog();
  const closeButton = dialog.getByRole('button', {
    name: 'Fechar',
    exact: true
  });
  if (designSystem) {
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
  } else {
    await expect(closeButton).toHaveCount(0);
    await page.keyboard.press('Escape');
  }

  // Matriz responsiva e temática, sempre fechando sem confirmar ações.
  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setTheme(page, theme);

    for (const width of [375, 480, 768, 1280, 1536]) {
      await page.setViewportSize({
        width,
        height: width < 768 ? 812 : 900
      });
      dialog = await openDialog();
      await expectNoHorizontalOverflow(page, dialog);

      if (screenshotDirectory) {
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `arquivar-projeto-${width}-${theme}.png`
          ),
          animations: 'disabled'
        });
      }

      if (designSystem) {
        const actionButtons = dialog.getByRole('button').filter({
          hasNot: page.locator('[aria-label="Fechar"]')
        });
        await expect(
          dialog.getByRole('button', { name: 'Cancelar', exact: true })
        ).toHaveClass(/\bfv-button--sm\b/);
        await expect(
          dialog.getByRole('button', {
            name: 'Arquivar sem enviar',
            exact: true
          })
        ).toHaveClass(/\bfv-button--sm\b/);
        await expect(
          dialog.getByRole('button', { name: 'Enviar pesquisa', exact: true })
        ).toHaveClass(/\bfv-button--sm\b/);
        const footerAlignment = await dialog
          .locator('.fv-modal__footer .fv-button')
          .evaluateAll((buttons) => {
            const rectangles = buttons.map((button) =>
              button.getBoundingClientRect()
            );
            const tops = rectangles.map((rectangle) => rectangle.top);
            const bottoms = rectangles.map((rectangle) => rectangle.bottom);
            return {
              topSpread: Math.max(...tops) - Math.min(...tops),
              bottomSpread: Math.max(...bottoms) - Math.min(...bottoms)
            };
          });
        expect(footerAlignment.topSpread).toBeLessThanOrEqual(2);
        expect(footerAlignment.bottomSpread).toBeLessThanOrEqual(2);
        expect(await actionButtons.count()).toBeGreaterThanOrEqual(3);
        await expectComfortableTapTargets(
          page,
          '.rdo-manager-archive-project-dialog'
        );

        const contrast = await dialog.evaluate((element) => {
          const parse = (color: string) =>
            (color.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
          const luminance = (color: string) => {
            const [red, green, blue] = parse(color)
              .slice(0, 3)
              .map((part) => {
                const value = part / 255;
                return value <= 0.03928
                  ? value / 12.92
                  : Math.pow((value + 0.055) / 1.055, 2.4);
              });
            return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          };
          const contrastRatio = (foreground: string, background: string) => {
            const foregroundLuminance = luminance(foreground);
            const backgroundLuminance = luminance(background);
            return (
              (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
              (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
            );
          };
          const candidates = [
            element.querySelector('#archive-survey-title'),
            element.querySelector('#archive-survey-description'),
            ...Array.from(
              element.querySelectorAll('.fv-modal__footer .fv-button')
            )
          ].filter((candidate): candidate is Element => Boolean(candidate));
          return Math.min(
            ...candidates.map((candidate) => {
              const styles = window.getComputedStyle(candidate);
              const background =
                styles.backgroundColor === 'rgba(0, 0, 0, 0)'
                  ? window.getComputedStyle(element).backgroundColor
                  : styles.backgroundColor;
              return contrastRatio(styles.color, background);
            })
          );
        });
        expect(
          contrast,
          `contraste insuficiente em ${theme}/${width}`
        ).toBeGreaterThanOrEqual(4.5);
      }

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(launcher).toBeFocused();
    }
  }

  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=projetos$/);
  await expect(
    page.locator('.fv-sidebar').getByRole('link', {
      name: 'Projetos',
      exact: true
    })
  ).toHaveAttribute('aria-current', 'page');
  expect(mutatingAttempts).toEqual([]);
  expect(downloads).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.unroute('**/*');
});
