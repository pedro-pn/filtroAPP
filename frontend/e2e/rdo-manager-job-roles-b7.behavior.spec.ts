import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  demoCredentials,
  expectComfortableTapTargets,
  expectManagerRdoShell,
  loginAs
} from './support/rdo';

const MANAGER_TEAM_URL = '/rdo/gestor?tab=equipe';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type JobRolesAppearance = 'legacy' | 'design-system';

const expectedAppearance: JobRolesAppearance = (() => {
  const value = process.env.RDO_B7_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(
    `RDO_B7_EXPECT_APPEARANCE inválido: ${value}. Use legacy ou design-system.`
  );
})();

interface JobRoleResponse {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
}

function roleRows(surface: Locator) {
  return expectedAppearance === 'design-system'
    ? surface.locator(
        '.fv-data-table__desktop tbody tr:has([data-job-role-name])'
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

test('B.7 caracteriza Cargos reais sem criar, renomear ou alterar status', async ({
  page
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await loginAs(page, demoCredentials.manager);

  const managerTab = page
    .locator('.fv-sidebar')
    .getByRole('link', { name: 'Equipe', exact: true });
  const teamTabs = page.getByRole('tablist', { name: 'Seções da equipe' });
  const rolesTab = teamTabs.getByRole('tab', { name: 'Cargos', exact: true });
  const search = page.getByRole('searchbox', { name: 'Buscar na equipe' });

  const mutatingAttempts: string[] = [];
  let releaseRolesResponse: (() => void) | undefined;
  const rolesResponseGate = new Promise<void>((resolve) => {
    releaseRolesResponse = resolve;
  });
  let observeRoles: ((roles: JobRoleResponse[]) => void) | undefined;
  const rolesPayload = new Promise<JobRoleResponse[]>((resolve) => {
    observeRoles = resolve;
  });
  let heldRolesRequest = false;

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
      !heldRolesRequest &&
      method === 'GET' &&
      url.pathname.endsWith('/rdo/job-roles') &&
      url.searchParams.get('all') === 'true'
    ) {
      heldRolesRequest = true;
      const response = await route.fetch();
      const roles = (await response.json()) as JobRoleResponse[];
      observeRoles?.(roles);
      await rolesResponseGate;
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

  await rolesTab.click();
  await expect(rolesTab).toHaveAttribute('aria-selected', 'true');
  const roles = await rolesPayload;
  expect(
    roles.length,
    'O backend real deve fornecer ao menos um cargo'
  ).toBeGreaterThan(0);

  const loading = page.getByText('Carregando cargos…', { exact: true });
  await expect(loading).toBeAttached();
  releaseRolesResponse?.();
  await expect(loading).toHaveCount(0);

  const surface =
    expectedAppearance === 'design-system'
      ? page.locator('.rdo-job-roles.fv-ds')
      : page.locator('.page-card').filter({ hasText: 'Cargos' }).first();
  await expect(surface).toBeVisible();
  if (expectedAppearance === 'design-system') {
    await expect(surface).not.toHaveClass(/page-card/);
    await expect(surface.locator('.fv-data-table__desktop')).toBeVisible();
  } else {
    await expect(surface).not.toHaveClass(/fv-ds/);
    await expect(surface.locator('.fv-data-table')).toHaveCount(0);
  }

  const rows = roleRows(surface);
  await expect(rows).toHaveCount(roles.length);
  const renderedNames = await rows.evaluateAll((items) =>
    items.map(
      (item) =>
        item
          .querySelector('[data-job-role-name]')
          ?.getAttribute('data-job-role-name') ?? ''
    )
  );
  if (expectedAppearance === 'design-system') {
    expect(renderedNames).toEqual(roles.map((role) => role.name));
  } else {
    const legacyNames = await rows.evaluateAll((items) =>
      items.map((item) => item.querySelector('span')?.textContent ?? '')
    );
    expect(legacyNames).toEqual(
      roles.map((role) => `${role.name}${role.isActive ? '' : ' (inativo)'}`)
    );
  }

  const absentTerm = `cargo-b7-inexistente-${Date.now()}`;
  await search.fill(absentTerm);
  await expect(rows).toHaveCount(0);
  await expect(page.getByText('Nenhum cargo encontrado.')).toBeVisible();
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=equipe$/);
  await page.getByRole('button', { name: 'Limpar busca' }).click();
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(roles.length);

  const newRoleLauncher =
    expectedAppearance === 'design-system'
      ? page.getByRole('button', { name: 'Novo cargo', exact: true })
      : surface.getByRole('button', { name: /Novo cargo$/ });
  await newRoleLauncher.click();
  const createInput = surface.getByRole('textbox', { name: 'Nome do cargo' });
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

  await createInput.fill('Cargo temporário que não será salvo');
  await surface.getByRole('button', { name: 'Cancelar' }).first().click();
  await expect(createInput).toHaveCount(0);
  await expectLauncherFocus(
    page,
    newRoleLauncher,
    expectedAppearance === 'design-system'
  );

  await newRoleLauncher.click();
  await expect(createInput).toHaveValue('');
  await page.keyboard.press('Escape');
  if (expectedAppearance === 'design-system') {
    await expect(createInput).toHaveCount(0);
    await expect(newRoleLauncher).toBeFocused();
  } else {
    await expect(createInput).toBeVisible();
    await surface.getByRole('button', { name: 'Cancelar' }).first().click();
  }

  const firstRole = roles[0];
  expect(
    firstRole,
    'A lista real de cargos não pode estar vazia'
  ).toBeDefined();
  const firstRow =
    expectedAppearance === 'design-system'
      ? surface.locator('.fv-data-table__desktop tbody tr').first()
      : roleRows(surface).first();
  const renameLauncher = firstRow.getByRole('button', {
    name: 'Renomear',
    exact: true
  });
  await renameLauncher.click();
  const renameInput = firstRow.locator('input');
  await expect(renameInput).toHaveValue(firstRole.name);
  if (expectedAppearance === 'design-system') {
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveAccessibleName(
      `Novo nome para ${firstRole.name}`
    );
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

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoDocumentOverflow(page);
  if (expectedAppearance === 'design-system') {
    await expect(surface.locator('table')).toHaveCount(0);
    await expect(surface.locator('.fv-data-table__desktop')).toHaveCount(0);
    await expect(surface.locator('.fv-mobile-list')).toBeVisible();

    // As ações compactas desenham uma caixa menor de propósito; o que precisa
    // ser garantido é a área de toque efetiva, não o tamanho da caixa.
    await expectComfortableTapTargets(page, '.rdo-job-roles.fv-ds');

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
  }

  await page.setViewportSize({ width: 768, height: 1024 });
  await expectNoDocumentOverflow(page);
  if (expectedAppearance === 'design-system') {
    await expect(surface.locator('.fv-mobile-list')).toHaveCount(0);
    await expect(surface.locator('.fv-data-table__desktop')).toBeVisible();
  }

  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=equipe$/);
  await expect(rolesTab).toHaveAttribute('aria-selected', 'true');
  expect(mutatingAttempts).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.unroute('**/*');
});
