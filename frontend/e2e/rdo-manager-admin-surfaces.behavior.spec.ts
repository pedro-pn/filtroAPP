import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  demoCredentials,
  expectComfortableTapTargets,
  expectManagerRdoMobileNavigation,
  expectManagerRdoShell,
  loginAs
} from './support/rdo';

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

test('Equipe e Usuários preservam navegação, busca e formulários sem mutar dados', async ({
  page
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, demoCredentials.manager);

  const mutationAttempts: string[] = [];
  page.on('request', (request) => {
    const isReadOnlyCountQuery = request
      .url()
      .endsWith('/api/rdo/reports/counts');
    if (
      MUTATING_METHODS.has(request.method().toUpperCase()) &&
      !isReadOnlyCountQuery
    ) {
      mutationAttempts.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto('/rdo/gestor?tab=equipe');
  await expectManagerRdoShell(page);
  await expect(
    page.getByRole('heading', { name: 'Equipe', level: 1 })
  ).toBeVisible();
  await expect(page.locator('.fv-metric-card')).toHaveCount(4);
  const teamTabs = page.getByRole('tablist', { name: 'Seções da equipe' });
  await expect(teamTabs.getByRole('tab')).toHaveCount(3);
  await expect(
    teamTabs.getByRole('tab', { name: 'Colaboradores' })
  ).toHaveAttribute('aria-selected', 'true');
  const collaboratorsSurface = page.locator('.rdo-team-collaborators');
  await expect(
    collaboratorsSurface.getByRole('table', { name: 'Colaboradores' })
  ).toBeVisible();
  await expect(collaboratorsSurface.locator('.fv-mobile-list')).toHaveCount(0);

  const teamSearch = page.getByRole('searchbox', { name: 'Buscar na equipe' });
  await teamSearch.fill('colaborador-inexistente-rdo');
  await expect(
    page.getByText('Nenhum colaborador ativo.', { exact: true })
  ).toBeVisible();
  await teamSearch.fill('');

  await teamTabs.getByRole('tab', { name: 'Cargos' }).click();
  await expect(teamTabs.getByRole('tab', { name: 'Cargos' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(teamSearch).toBeVisible();
  await teamSearch.fill('cargo-inexistente-rdo');
  await expect(
    page.getByText('Nenhum cargo encontrado.', { exact: true })
  ).toBeVisible();
  await teamSearch.fill('');
  await page.getByRole('button', { name: 'Novo cargo', exact: true }).click();
  await expect(page.getByLabel('Nome do cargo')).toBeFocused();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Novo cargo', exact: true })
  ).toBeFocused();
  await teamTabs.getByRole('tab', { name: 'Temas de DDS' }).click();
  await expect(
    teamTabs.getByRole('tab', { name: 'Temas de DDS' })
  ).toHaveAttribute('aria-selected', 'true');
  await teamSearch.fill('tema-inexistente-rdo');
  await expect(
    page.getByText('Nenhum tema de DDS encontrado.', { exact: true })
  ).toBeVisible();
  await teamSearch.fill('');
  await page.getByRole('button', { name: 'Novo tema', exact: true }).click();
  await expect(page.getByLabel('Nome do tema')).toBeFocused();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Novo tema', exact: true })
  ).toBeFocused();
  await teamTabs.getByRole('tab', { name: 'Colaboradores' }).click();

  const firstCollaboratorRow = collaboratorsSurface
    .locator('tbody tr[data-row-id]')
    .first();
  const firstCollaboratorId =
    await firstCollaboratorRow.getAttribute('data-row-id');
  expect(firstCollaboratorId).toBeTruthy();
  const firstCollaboratorEdit = firstCollaboratorRow.getByRole('button', {
    name: 'Editar',
    exact: true
  });
  await firstCollaboratorEdit.click();
  await expect(firstCollaboratorEdit).toHaveAttribute('aria-expanded', 'true');
  const collaboratorDetailsRow = collaboratorsSurface.locator(
    `[data-details-for-row="${firstCollaboratorId}"]`
  );
  const inlineEditForm = collaboratorDetailsRow.locator(
    'form[data-collaborator-form="edit"]'
  );
  await expect(inlineEditForm).toBeVisible();
  await expect(
    inlineEditForm.getByRole('heading', { name: /^Editar / })
  ).toBeVisible();
  await expect(
    inlineEditForm.getByRole('textbox', { name: 'Nome', exact: true })
  ).toBeFocused();
  await firstCollaboratorEdit.click();
  await expect(collaboratorDetailsRow).toHaveCount(0);

  await page.getByRole('button', { name: /Novo colaborador$/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Novo colaborador' })
  ).toBeVisible();
  const collaboratorName = page.getByRole('textbox', {
    name: 'Nome',
    exact: true
  });
  await expect(collaboratorName).toHaveAttribute('required', '');
  await expect(
    page.getByRole('combobox', { name: 'Cargo', exact: true })
  ).toHaveAttribute('required', '');
  await expect(
    page.getByRole('textbox', { name: 'E-mail', exact: true })
  ).toHaveAttribute('type', 'email');
  await collaboratorName.focus();
  const collaboratorFocusRings = await collaboratorName.evaluate((element) => {
    const shell = element.closest('.fv-control-shell');
    return {
      input: window.getComputedStyle(element).outlineStyle,
      shell: shell ? window.getComputedStyle(shell).outlineStyle : null
    };
  });
  expect(collaboratorFocusRings).toEqual({ input: 'none', shell: 'solid' });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.goto('/rdo/gestor?tab=usuarios');
  await expect(
    page.getByRole('heading', { name: 'Usuários', level: 1 })
  ).toBeVisible();
  await expect(page.locator('.fv-metric-card')).toHaveCount(4);
  await expect(
    page.getByRole('region', { name: 'Busca e filtros dos usuários' })
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Filtrar usuários por perfil' })
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Filtrar usuários por status' })
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Ordenar usuários' })
  ).toBeVisible();
  const internalUsersTable = page.getByRole('table', {
    name: 'Usuários internos'
  });
  await expect(internalUsersTable).toBeVisible();
  const internalUserCount = Number.parseInt(
    (await page.locator('.rdo-users__table-summary strong').innerText()).match(
      /\d+/
    )?.[0] || '0',
    10
  );
  await expect(internalUsersTable.locator('tbody tr[data-row-id]')).toHaveCount(
    internalUserCount
  );
  await expect(page.locator('.fv-pagination')).toHaveCount(0);
  await expect(
    page.getByRole('combobox', { name: 'Itens por página' })
  ).toHaveCount(0);
  const userTabs = page.getByRole('tablist', { name: 'Tipo de usuário' });
  await expect(userTabs.getByRole('tab')).toHaveCount(2);

  const userSearch = page.getByRole('searchbox', {
    name: 'Buscar em usuários'
  });
  await userSearch.fill('usuario-inexistente-rdo');
  await expect(
    page.getByText('Nenhum usuário interno encontrado.', { exact: true })
  ).toBeVisible();
  await userSearch.fill('');

  await page
    .getByRole('combobox', { name: 'Filtrar usuários por perfil' })
    .selectOption('MANAGER');
  await expect(
    internalUsersTable.locator('tbody tr[data-row-id]').first()
  ).toContainText('Gestor');
  await page
    .getByRole('combobox', { name: 'Filtrar usuários por perfil' })
    .selectOption('all');

  const firstInternalUserRow = internalUsersTable
    .locator('tbody tr[data-row-id]')
    .first();
  const firstInternalUserId =
    await firstInternalUserRow.getAttribute('data-row-id');
  expect(firstInternalUserId).toBeTruthy();
  const firstInternalUserEdit = firstInternalUserRow.getByRole('button', {
    name: 'Editar',
    exact: true
  });
  await firstInternalUserEdit.click();
  await expect(firstInternalUserEdit).toHaveAttribute('aria-expanded', 'true');
  const internalUserDetails = page.locator(
    `[data-details-for-row="${firstInternalUserId}"]`
  );
  const internalUserEditForm = internalUserDetails.locator(
    'form[data-user-form="edit"]'
  );
  await expect(internalUserEditForm).toBeVisible();
  await expect(
    internalUserDetails.getByRole('textbox', { name: 'Nome', exact: true })
  ).toBeFocused();
  const readonlyUsername = internalUserEditForm.getByRole('textbox', {
    name: 'Usuário',
    exact: true
  });
  await expect(readonlyUsername).toHaveAttribute('readonly', '');
  const usernameSurface = await readonlyUsername.evaluate((element) => {
    const shell = element.closest('.fv-control-shell');
    const editableShell = element
      .closest('form')
      ?.querySelector('input:not([readonly])')
      ?.closest('.fv-control-shell');
    const inputRect = element.getBoundingClientRect();
    const shellRect = shell?.getBoundingClientRect();

    return {
      continuousSurface:
        Boolean(shell && editableShell) &&
        window.getComputedStyle(shell!).backgroundColor ===
          window.getComputedStyle(editableShell!).backgroundColor,
      innerSurface: window.getComputedStyle(element).backgroundColor,
      contained:
        Boolean(shellRect) &&
        inputRect.left >= shellRect!.left &&
        inputRect.right <= shellRect!.right &&
        inputRect.top >= shellRect!.top &&
        inputRect.bottom <= shellRect!.bottom,
      readOnlyState: shell?.getAttribute('data-readonly')
    };
  });
  expect(usernameSurface).toEqual({
    continuousSurface: true,
    innerSurface: 'rgba(0, 0, 0, 0)',
    contained: true,
    readOnlyState: 'true'
  });
  await readonlyUsername.focus();
  const usernameFocusRings = await readonlyUsername.evaluate((element) => {
    const shell = element.closest('.fv-control-shell');
    return {
      input: window.getComputedStyle(element).outlineStyle,
      shell: shell ? window.getComputedStyle(shell).outlineStyle : null
    };
  });
  expect(usernameFocusRings).toEqual({ input: 'none', shell: 'solid' });
  await firstInternalUserEdit.click();
  await expect(internalUserDetails).toHaveCount(0);

  await userTabs.getByRole('tab', { name: 'Clientes' }).click();
  const clientGroup = page.locator('.rdo-client-account-group').first();
  await expect(clientGroup).toBeVisible();
  const groupToggle = clientGroup.locator('.client-account-group-toggle');
  await expect(groupToggle).toHaveAttribute('aria-expanded', 'true');
  await groupToggle.click();
  await expect(groupToggle).toHaveAttribute('aria-expanded', 'false');
  await groupToggle.click();

  await userTabs.getByRole('tab', { name: 'Internos' }).click();
  await page.getByRole('button', { name: 'Novo usuário', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Novo usuário' })
  ).toBeVisible();
  await expect(page.getByLabel(/^Senha/)).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

  expect(mutationAttempts).toEqual([]);
});

test('Equipe e Usuários mantêm light/dark e desktop/mobile sem overflow', async ({
  page
}) => {
  test.setTimeout(180_000);
  await loginAs(page, demoCredentials.manager);

  const scenarios = [
    { width: 1280, height: 900, theme: 'light' as const },
    { width: 1280, height: 900, theme: 'dark' as const },
    { width: 390, height: 844, theme: 'light' as const },
    { width: 390, height: 844, theme: 'dark' as const }
  ];

  for (const scenario of scenarios) {
    await page.setViewportSize({
      width: scenario.width,
      height: scenario.height
    });

    for (const section of ['equipe', 'usuarios'] as const) {
      await page.goto(`/rdo/gestor?tab=${section}`);
      await setTheme(page, scenario.theme);
      const surface = page.locator('.rdo-manager-admin-page');
      await expect(surface).toBeVisible();
      await expectNoHorizontalOverflow(page, surface);
      await expect(surface.locator('.mini-btn')).toHaveCount(0);

      if (section === 'equipe') {
        const collaboratorsSurface = surface.locator('.rdo-team-collaborators');
        if (scenario.width < 768) {
          await expect(
            collaboratorsSurface.locator('.fv-mobile-list')
          ).toBeVisible();
          await expect(
            collaboratorsSurface.getByRole('table', {
              name: 'Colaboradores'
            })
          ).toHaveCount(0);
          const firstCollaboratorCard = collaboratorsSurface
            .locator('.fv-mobile-list__item')
            .first();
          await firstCollaboratorCard
            .getByRole('button', { name: 'Editar', exact: true })
            .click();
          const mobileEditForm = firstCollaboratorCard.locator(
            'form[data-collaborator-form="edit"]'
          );
          await expect(mobileEditForm).toBeVisible();
          await expect(
            collaboratorsSurface.locator('form[data-collaborator-form="edit"]')
          ).toHaveCount(1);
          await mobileEditForm
            .getByRole('button', { name: 'Cancelar', exact: true })
            .click();
          await expect(mobileEditForm).toHaveCount(0);
        } else {
          await expect(
            collaboratorsSurface.getByRole('table', {
              name: 'Colaboradores'
            })
          ).toBeVisible();
          await expect(
            collaboratorsSurface.locator('.fv-mobile-list')
          ).toHaveCount(0);
        }
      }

      if (section === 'usuarios') {
        const usersSurface = surface.locator('.rdo-users');
        const internalUserCount = Number.parseInt(
          (
            await usersSurface
              .locator('.rdo-users__table-summary strong')
              .innerText()
          ).match(/\d+/)?.[0] || '0',
          10
        );
        await expect(usersSurface.locator('.fv-pagination')).toHaveCount(0);
        if (scenario.width < 768) {
          await expect(usersSurface.locator('.fv-mobile-list')).toBeVisible();
          await expect(
            usersSurface.locator('.fv-mobile-list__item')
          ).toHaveCount(internalUserCount);
          await expect(
            usersSurface.getByRole('table', { name: 'Usuários internos' })
          ).toHaveCount(0);
          await expect(
            surface.getByRole('button', { name: 'Filtros', exact: true })
          ).toBeVisible();
        } else {
          await expect(
            usersSurface.getByRole('table', { name: 'Usuários internos' })
          ).toBeVisible();
          await expect(
            usersSurface.locator('tbody tr[data-row-id]')
          ).toHaveCount(internalUserCount);
          await expect(usersSurface.locator('.fv-mobile-list')).toHaveCount(0);
        }
      }

      if (scenario.width < 1024) {
        await expectManagerRdoMobileNavigation(page);
        await expectComfortableTapTargets(page, '.rdo-manager-admin-page');
      } else {
        await expectManagerRdoShell(page);
      }
    }
  }
});
