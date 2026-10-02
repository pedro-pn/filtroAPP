import { expect, test } from '@playwright/test';

import {
  demoCredentials,
  expectManagerRdoMobileNavigation,
  expectManagerRdoShell,
  loginAs
} from './support/rdo';

const MANAGER_HOME = '/rdo/gestor';

test.describe('navegação compartilhada do RDO Gestor', () => {
  test('desktop expõe as oito áreas na sidebar e a mantém na viewport', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await loginAs(page, demoCredentials.manager);
    await page.goto(MANAGER_HOME);
    await expectManagerRdoShell(page);

    await expect(
      page.getByRole('tablist', { name: 'Seções do gestor' })
    ).toHaveCount(0);

    const sidebar = page.locator('.fv-sidebar');
    const parent = sidebar.getByRole('link', {
      name: /^Relatórios e Projetos/
    });
    const submenu = sidebar.getByRole('list', {
      name: 'Áreas de Relatórios e Projetos'
    });
    await expect(parent).toHaveAttribute('aria-expanded', 'true');
    await expect(submenu.getByRole('link')).toHaveCount(8);
    await expect(
      submenu.getByRole('link', { name: /^Pendentes/ })
    ).toHaveAttribute('aria-current', 'page');

    await submenu.getByRole('link', { name: 'Projetos', exact: true }).click();
    await expect(page).toHaveURL(/\/rdo\/gestor\?tab=projetos$/);
    await expect(
      submenu.getByRole('link', { name: 'Projetos', exact: true })
    ).toHaveAttribute('aria-current', 'page');

    await submenu.getByRole('link', { name: 'Aprovados', exact: true }).click();
    await expect(page).toHaveURL(/\/rdo\/gestor\?tab=aprovados$/);
    await page.waitForTimeout(250);
    await expect(page).toHaveURL(/\/rdo\/gestor\?tab=aprovados$/);
    await expect(
      submenu.getByRole('link', { name: 'Aprovados', exact: true })
    ).toHaveAttribute('aria-current', 'page');

    const before = await sidebar.boundingBox();
    expect(before).not.toBeNull();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const after = await sidebar.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
    await expect(sidebar).toHaveCSS('height', '520px');

    const scrollContract = await sidebar
      .locator('.fv-sidebar__navigation')
      .evaluate((element) => ({
        overflowY: window.getComputedStyle(element).overflowY,
        scrollable: element.scrollHeight > element.clientHeight
      }));
    expect(scrollContract).toEqual({ overflowY: 'auto', scrollable: true });
  });

  test('mobile oculta as abas locais e preserva a navegação pelo menu lateral', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, demoCredentials.manager);
    await page.goto(MANAGER_HOME);
    await expectManagerRdoMobileNavigation(page);

    const menuBounds = await page.locator('.fv-topbar__menu').boundingBox();
    const brandBounds = await page.locator('.fv-topbar__brand').boundingBox();
    expect(menuBounds).not.toBeNull();
    expect(brandBounds).not.toBeNull();
    expect(menuBounds?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(
      brandBounds?.x ?? Number.NEGATIVE_INFINITY
    );

    await expect(page.locator('.rdo-section-navigation')).toBeHidden();
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menu' });
    const navigation = drawer.getByRole('list', {
      name: 'Áreas de Relatórios e Projetos'
    });
    await expect(navigation.getByRole('link')).toHaveCount(8);
    await navigation.getByRole('link', { name: 'Arquivados', exact: true }).click();
    await expect(page).toHaveURL(/\/rdo\/gestor\?tab=arquivados$/);
    await expect(drawer).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      .toBe(true);
  });

  test('mobile mantém as áreas sem abas locais, divisórias de ação ou overflow', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, demoCredentials.manager);

    const sections = [
      'pendentes',
      'aprovados',
      'projetos',
      'arquivados',
      'equipe',
      'usuarios',
      'nps',
      'estatisticas'
    ];

    for (const section of sections) {
      await page.goto(`${MANAGER_HOME}?tab=${section}`);
      await expectManagerRdoMobileNavigation(page);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        .toBe(true);

      const metricTops = await page
        .locator('.rdo-manager-metrics .fv-metric-card')
        .evaluateAll((cards) =>
          cards.map((card) => Math.round(card.getBoundingClientRect().top))
        );
      if (metricTops.length > 1) {
        expect(new Set(metricTops).size).toBe(1);
      }

      const actionDividers = await page
        .locator('.fv-mobile-list__actions:visible')
        .evaluateAll((actions) =>
          actions.map(
            (action) => window.getComputedStyle(action).borderTopWidth
          )
        );
      expect(actionDividers.every((width) => width === '0px')).toBe(true);
    }

    await page.goto(`${MANAGER_HOME}?tab=equipe`);
    const teamActionTops = await page
      .locator('.rdo-admin-toolbar__actions .fv-button')
      .evaluateAll((buttons) =>
        buttons.map((button) => Math.round(button.getBoundingClientRect().top))
      );
    expect(new Set(teamActionTops).size).toBe(1);

    for (const width of [320, 480, 767]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(MANAGER_HOME);
      await expectManagerRdoMobileNavigation(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
    }
  });
});
