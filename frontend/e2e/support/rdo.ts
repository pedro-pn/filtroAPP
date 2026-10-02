import { expect, type Page } from '@playwright/test';

type DemoCredentials = {
  username: string;
  password: string;
};

export const demoCredentials = {
  manager: {
    username: process.env.RDO_E2E_MANAGER_USERNAME ?? 'gestor',
    password: process.env.RDO_E2E_MANAGER_PASSWORD ?? 'gestor123'
  },
  collaborator: {
    username: process.env.RDO_E2E_COLLABORATOR_USERNAME ?? 'colaborador1',
    password: process.env.RDO_E2E_COLLABORATOR_PASSWORD ?? 'colab123'
  },
  client: {
    username: process.env.RDO_E2E_CLIENT_USERNAME ?? '12345678000190',
    password: process.env.RDO_E2E_CLIENT_PASSWORD ?? '123456'
  }
} satisfies Record<string, DemoCredentials>;

export async function loginAs(page: Page, credentials: DemoCredentials) {
  await page.goto('/login');

  await page
    .getByRole('textbox', { name: 'Usuário', exact: true })
    .fill(credentials.username);
  await page
    .getByRole('textbox', { name: 'Senha', exact: true })
    .fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).not.toHaveURL(/\/login(?:\?.*)?$/);
}

export async function expectLegacyRdoShell(page: Page) {
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('[data-testid="fv-app-shell"]')).toHaveCount(0);
  await expect(page.locator('.fv-sidebar')).toHaveCount(0);
  await expect(page.locator('.fv-navigation-drawer')).toHaveCount(0);
  await expect(page.locator('.fv-bottom-bar')).toHaveCount(0);
  await expect(page.locator('.fv-theme-toggle')).toHaveCount(0);
}

export async function expectManagerRdoShell(page: Page) {
  await expect(page.locator('[data-testid="fv-app-shell"]')).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  await expect(page.locator('.fv-sidebar')).toBeVisible();
  await expect(page.locator('.fv-topbar')).toBeVisible();
  await expect(page.locator('.fv-theme-toggle')).toBeVisible();
  await expect(page.locator('.rdo-manager-tabs-wrap')).toHaveCount(0);
  await expect(
    page.locator('.fv-sidebar').getByRole('link', {
      name: /^Relatórios e Projetos/
    })
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.fv-sidebar .fv-navigation-subitem')).toHaveCount(
    8
  );
  await expect(page.locator('.rdo-section-navigation')).toBeHidden();
}

export async function expectManagerRdoMobileNavigation(page: Page) {
  await expect(page.locator('[data-testid="fv-app-shell"]')).toBeVisible();
  await expect(page.locator('.fv-sidebar')).toBeHidden();
  await expect(page.locator('.fv-topbar')).toBeVisible();
  await expect(page.locator('.fv-topbar .fv-topbar__brand')).toBeVisible();
  await expect(page.locator('.fv-theme-toggle')).toBeVisible();
  await expect(page.locator('.rdo-manager-tabs-wrap')).toHaveCount(0);
  await expect(page.locator('.rdo-section-navigation')).toBeHidden();
}

export async function logoutFromRdo(page: Page) {
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
}

/**
 * Verifica que cada botão visível da superfície oferece uma área de toque de ao
 * menos 44x44px, testando o hit-testing real (`elementFromPoint`) em vez do
 * tamanho da caixa desenhada.
 *
 * Nas superfícies RDO com ações compactas, a caixa é menor de propósito e o
 * alvo é reposto por um pseudo-elemento; medir apenas `getBoundingClientRect`
 * não provaria nada sobre a área efetivamente clicável.
 *
 * Pontos cobertos por chrome de posição fixa/sticky (barra inferior, topbar)
 * são ignorados: eles não dizem respeito ao tamanho do botão.
 */
export async function expectComfortableTapTargets(
  page: Page,
  surfaceSelector: string
) {
  const failures = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return ['superfície não encontrada: ' + selector];

    const isChrome = (element: Element | null) => {
      for (let node = element; node; node = node.parentElement) {
        const position = window.getComputedStyle(node).position;
        if (position === 'fixed' || position === 'sticky') return true;
      }
      return false;
    };

    const bad: string[] = [];
    for (const button of Array.from(root.querySelectorAll('.fv-button'))) {
      const rect = button.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (cy - 22 < 0 || cy + 22 > window.innerHeight) continue;
      if (cx - 22 < 0 || cx + 22 > window.innerWidth) continue;

      const centre = document.elementFromPoint(cx, cy);
      if (!(centre === button || button.contains(centre))) continue;

      const covers = ([x, y]: readonly [number, number]) => {
        const element = document.elementFromPoint(x, y);
        if (!element) return false;
        if (element === button || button.contains(element)) return true;
        return isChrome(element);
      };

      const probes: ReadonlyArray<readonly [number, number]> = [
        [cx, cy - 21],
        [cx, cy + 21],
        [cx - 21, cy],
        [cx + 21, cy]
      ];
      if (!probes.every(covers)) {
        bad.push(
          `${(button.textContent || '').trim().slice(0, 20)} ` +
            `(${Math.round(rect.width)}x${Math.round(rect.height)})`
        );
      }
    }
    return bad;
  }, surfaceSelector);

  expect(failures, 'alvos menores que 44x44px').toEqual([]);
}
