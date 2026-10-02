import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  demoCredentials,
  expectLegacyRdoShell,
  expectManagerRdoShell,
  loginAs,
  logoutFromRdo
} from './support/rdo';

const MANAGER_HOME = '/rdo/gestor';
const REPORT_LIST_TIMEOUT = 20_000;

async function openManagerRdo(page: Page) {
  await loginAs(page, demoCredentials.manager);
  await page.goto(MANAGER_HOME);

  await expect(page).toHaveURL(/\/rdo\/gestor(?:\?.*)?$/);
  await expectManagerRdoShell(page);
  await expect(
    page.locator('.fv-sidebar .fv-navigation-subitem[aria-current="page"]')
  ).toHaveText(/Pendentes/);
}

async function waitForReportCards(page: Page) {
  await expect
    .poll(() => page.locator('.rel-item').count(), {
      message:
        'a listagem real do gestor deve renderizar ao menos um relatório',
      timeout: REPORT_LIST_TIMEOUT
    })
    .toBeGreaterThan(0);
}

async function openApprovedReports(page: Page) {
  await page
    .locator('.fv-sidebar')
    .getByRole('link', { name: 'Aprovados', exact: true })
    .click();
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=aprovados$/);
  await expect(
    page.locator('.fv-sidebar').getByRole('link', {
      name: 'Aprovados',
      exact: true
    })
  ).toHaveAttribute('aria-current', 'page');
  await waitForReportCards(page);
}

function projectNameFromReportLabel(label: string) {
  return label.split('·').slice(1).join('·').trim();
}

async function waitForSearchResults(page: Page, projectName: string) {
  await expect
    .poll(
      async () => {
        const labels = (await page.locator('.rel-name').allTextContents()).map(
          (value) => value.trim()
        );
        return (
          labels.length > 0 &&
          labels.every((label) =>
            label
              .toLocaleLowerCase('pt-BR')
              .includes(projectName.toLocaleLowerCase('pt-BR'))
          )
        );
      },
      {
        message: `a busca deve retornar somente relatórios relacionados a ${projectName}`,
        timeout: REPORT_LIST_TIMEOUT
      }
    )
    .toBe(true);
}

async function managerSearchStorage(page: Page) {
  return page.evaluate(() =>
    Object.entries(window.sessionStorage).find(
      ([key]) => key.startsWith('gestor-search:') && key.endsWith(':aprovados')
    )
  );
}

function topLevelProjectSort(page: Page) {
  return page.locator('.rdo-manager-listing__filters .project-sort-button');
}

async function visibleProjectLabels(page: Page) {
  return page
    .locator('.report-project-group > .project-group-toggle .sec')
    .allTextContents();
}

async function selectedReportName(card: Locator) {
  return (await card.locator('.rel-name').innerText()).trim();
}

test.describe('RDO A.1 — comportamento do gestor', () => {
  test.setTimeout(240_000);

  test('caracteriza os fluxos read-only do gestor com uma única sessão real', async ({
    page
  }, testInfo) => {
    await openManagerRdo(page);

    await test.step('login real e AppShell do piloto Gestor', async () => {
      await expect(
        page.locator('.fv-sidebar').getByRole('link', { name: /^Pendentes/ })
      ).toHaveAttribute('aria-current', 'page');
    });

    await test.step('contrato mínimo read-only dos dados E2E', async () => {
      await waitForReportCards(page);

      const reportCount = await page.locator('.rel-item').count();
      const projectGroupCount = await page
        .locator('.report-project-group')
        .count();
      const selectableProjectGroupCount = await page
        .locator('.report-project-group')
        .filter({
          has: page.locator('.report-select-checkbox input[type="checkbox"]')
        })
        .count();
      const loadMoreCount = await page
        .getByRole('button', { name: 'Carregar mais', exact: true })
        .count();

      expect(reportCount).toBeGreaterThan(0);
      expect(projectGroupCount).toBeGreaterThan(1);
      expect(selectableProjectGroupCount).toBeGreaterThan(1);
      expect(loadMoreCount).toBeGreaterThan(0);

      await testInfo.attach('rdo-manager-read-only-data-contract.json', {
        body: Buffer.from(
          JSON.stringify(
            {
              schemaVersion: 1,
              route: MANAGER_HOME,
              tab: 'pendentes',
              invariants: {
                reportCount: 'greater-than-zero',
                projectGroupCount: 'greater-than-one',
                selectableProjectGroupCount: 'greater-than-one',
                loadMoreCount: 'greater-than-zero'
              },
              observed: {
                reportCount,
                projectGroupCount,
                selectableProjectGroupCount,
                loadMoreCount
              }
            },
            null,
            2
          )
        ),
        contentType: 'application/json'
      });
    });

    await test.step('navegação pelas oito áreas e URL', async () => {
      const navigation = page.locator('.fv-sidebar .fv-navigation-submenu');
      await expect(navigation.getByRole('link')).toHaveCount(8);

      const cases = [
        ['Aprovados', 'aprovados'],
        ['Projetos', 'projetos'],
        ['Arquivados', 'arquivados'],
        ['Equipe', 'equipe'],
        ['Usuários', 'usuarios'],
        ['NPS', 'nps'],
        ['Estatísticas', 'estatisticas']
      ] as const;

      for (const [label, queryValue] of cases) {
        const link = navigation.getByRole('link', { name: label, exact: true });
        await link.click();
        await expect(link).toHaveAttribute('aria-current', 'page');
        await expect
          .poll(() => new URL(page.url()).searchParams.get('tab'))
          .toBe(queryValue);
      }

      const pendingLink = navigation.getByRole('link', { name: /^Pendentes/ });
      await pendingLink.click();
      await expect(pendingLink).toHaveAttribute('aria-current', 'page');
      await expect
        .poll(() => new URL(page.url()).searchParams.get('tab'))
        .toBeNull();
    });

    await test.step('busca real, limpeza, vazio e persistência no reload', async () => {
      await openApprovedReports(page);

      const search = page.getByRole('searchbox', {
        name: 'Buscar em aprovados'
      });
      const firstReportLabel = (
        await page.locator('.rel-name').first().innerText()
      ).trim();
      const projectName = projectNameFromReportLabel(firstReportLabel);
      expect(projectName).not.toBe('');

      await search.fill(projectName);
      await waitForSearchResults(page, projectName);

      await page.getByRole('button', { name: 'Limpar busca' }).click();
      await expect(search).toHaveValue('');
      await waitForReportCards(page);

      const absentTerm = `rdo-a1-sem-resultados-${Date.now()}`;
      await search.fill(absentTerm);
      await expect(
        page.getByText('Nenhum relatório aprovado.', { exact: true })
      ).toBeVisible({
        timeout: REPORT_LIST_TIMEOUT
      });

      await expect
        .poll(() => managerSearchStorage(page))
        .toEqual(
          expect.arrayContaining([
            expect.stringMatching(/^gestor-search:/),
            absentTerm
          ])
        );

      await page.reload();
      await expectManagerRdoShell(page);
      await expect(
        page.locator('.fv-sidebar').getByRole('link', {
          name: 'Aprovados',
          exact: true
        })
      ).toHaveAttribute('aria-current', 'page');
      await expect(search).toHaveValue(absentTerm);
      await expect(
        page.getByText('Nenhum relatório aprovado.', { exact: true })
      ).toBeVisible({
        timeout: REPORT_LIST_TIMEOUT
      });

      await page.getByRole('button', { name: 'Limpar busca' }).click();
      await expect(search).toHaveValue('');
      await waitForReportCards(page);
      await expect.poll(() => managerSearchStorage(page)).toBeUndefined();
    });

    await test.step('ordenação de projetos persistida no reload', async () => {
      await page.goto(MANAGER_HOME);
      await expectManagerRdoShell(page);
      await waitForReportCards(page);

      const sortButton = topLevelProjectSort(page);
      await expect(sortButton).toHaveText('Ordenar por: A–Z');

      const ascendingLabels = await visibleProjectLabels(page);
      expect(ascendingLabels.length).toBeGreaterThan(1);

      await sortButton.click();
      await expect(sortButton).toHaveText('Ordenar por: Z–A');
      await expect
        .poll(async () => (await visibleProjectLabels(page))[0], {
          timeout: REPORT_LIST_TIMEOUT
        })
        .not.toBe(ascendingLabels[0]);

      const descendingLabels = await visibleProjectLabels(page);
      const storedDirection = await page.evaluate(() => {
        const entry = Object.entries(window.localStorage).find(([key]) =>
          key.startsWith('gestor-ui-prefs:')
        );
        if (!entry) return null;
        return (
          (JSON.parse(entry[1]) as { projectSortDir?: string })
            .projectSortDir ?? null
        );
      });
      expect(storedDirection).toBe('desc');

      await page.reload();
      await expectManagerRdoShell(page);
      await expect(topLevelProjectSort(page)).toHaveText('Ordenar por: Z–A');
      await expect
        .poll(async () => (await visibleProjectLabels(page))[0], {
          timeout: REPORT_LIST_TIMEOUT
        })
        .toBe(descendingLabels[0]);

      const firstProjectGroup = page.locator('.report-project-group').first();
      const firstProjectToggle = firstProjectGroup.locator(
        '.project-group-toggle'
      );
      const firstProjectLabel = (
        await firstProjectToggle.locator('.sec').innerText()
      ).trim();
      const controlledPanelId =
        await firstProjectToggle.getAttribute('aria-controls');
      expect(controlledPanelId).toBeTruthy();
      await expect(firstProjectToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(`#${controlledPanelId}`)).toBeVisible();
      await expect(
        firstProjectGroup.locator('.report-type-group')
      ).not.toHaveCount(0);
      await firstProjectToggle.click();
      await expect(firstProjectToggle).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      await expect(page.locator(`#${controlledPanelId}`)).toBeHidden();
      await expect(firstProjectGroup.locator('.report-type-group')).toHaveCount(
        0
      );

      await page.reload();
      await expectManagerRdoShell(page);
      const reloadedProjectGroup = page
        .locator('.report-project-group')
        .filter({ hasText: firstProjectLabel })
        .first();
      const reloadedProjectToggle = reloadedProjectGroup.locator(
        '.project-group-toggle'
      );
      const reloadedPanelId =
        await reloadedProjectToggle.getAttribute('aria-controls');
      expect(reloadedPanelId).toBeTruthy();
      await expect(reloadedProjectToggle).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      await expect(page.locator(`#${reloadedPanelId}`)).toBeHidden();
      await expect(
        reloadedProjectGroup.locator('.report-type-group')
      ).toHaveCount(0);
      await reloadedProjectToggle.click();
      await expect(reloadedProjectToggle).toHaveAttribute(
        'aria-expanded',
        'true'
      );
      await expect(page.locator(`#${reloadedPanelId}`)).toBeVisible();
      await expect(
        reloadedProjectGroup.locator('.report-type-group')
      ).not.toHaveCount(0);
    });

    await test.step('disclosure e ordenação por tipo persistidos', async () => {
      await page.goto(MANAGER_HOME);
      await expectManagerRdoShell(page);
      await waitForReportCards(page);

      const typeGroups = page.locator('.report-type-group');
      let targetIndex = -1;
      for (let index = 0; index < (await typeGroups.count()); index += 1) {
        if ((await typeGroups.nth(index).locator('.rel-item').count()) > 1) {
          targetIndex = index;
          break;
        }
      }
      expect(targetIndex).toBeGreaterThanOrEqual(0);

      const targetTypeGroup = typeGroups.nth(targetIndex);
      const typeToggle = targetTypeGroup.locator('.report-type-header');
      const projectLabel = (
        await targetTypeGroup
          .locator(
            'xpath=ancestor::*[contains(@class, "report-project-group")]'
          )
          .locator('.project-group-toggle .sec')
          .innerText()
      ).trim();
      const typeLabel = (
        await typeToggle.locator('.rdo-manager-report-type-badge').innerText()
      ).trim();
      const controlledPanelId = await typeToggle.getAttribute('aria-controls');
      expect(controlledPanelId).toBeTruthy();
      await expect(typeToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(`#${controlledPanelId}`)).toBeVisible();

      const labelsBefore = await targetTypeGroup
        .locator('.rel-name')
        .allTextContents();
      const typeSortButton = targetTypeGroup.locator('.fv-data-table__sort');
      await expect(typeSortButton).toBeVisible();
      await expect(typeSortButton).toHaveAccessibleName(
        /Ordenar relatórios em ordem (?:crescente|decrescente)/
      );
      await typeSortButton.click();
      await expect
        .poll(
          async () =>
            JSON.stringify(
              await targetTypeGroup.locator('.rel-name').allTextContents()
            ),
          { timeout: REPORT_LIST_TIMEOUT }
        )
        .not.toBe(JSON.stringify(labelsBefore));
      const labelsAfter = await targetTypeGroup
        .locator('.rel-name')
        .allTextContents();

      await page.reload();
      await expectManagerRdoShell(page);
      const reloadedProject = page
        .locator('.report-project-group')
        .filter({ hasText: projectLabel })
        .first();
      const reloadedTypeGroup = reloadedProject
        .locator('.report-type-group')
        .filter({ hasText: typeLabel })
        .first();
      await expect
        .poll(
          async () =>
            JSON.stringify(
              await reloadedTypeGroup.locator('.rel-name').allTextContents()
            ),
          { timeout: REPORT_LIST_TIMEOUT }
        )
        .toBe(JSON.stringify(labelsAfter));

      const reloadedTypeToggle = reloadedTypeGroup.locator(
        '.report-type-header'
      );
      const reloadedPanelId =
        await reloadedTypeToggle.getAttribute('aria-controls');
      expect(reloadedPanelId).toBeTruthy();
      await reloadedTypeToggle.click();
      await expect(reloadedTypeToggle).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      await expect(page.locator(`#${reloadedPanelId}`)).toBeHidden();
      await expect(reloadedTypeGroup.locator('.rel-item')).toHaveCount(0);

      await page.reload();
      await expectManagerRdoShell(page);
      const persistedProject = page
        .locator('.report-project-group')
        .filter({ hasText: projectLabel })
        .first();
      const persistedTypeGroup = persistedProject
        .locator('.report-type-group')
        .filter({ hasText: typeLabel })
        .first();
      const persistedTypeToggle = persistedTypeGroup.locator(
        '.report-type-header'
      );
      await expect(persistedTypeToggle).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      await persistedTypeToggle.click();
      await expect(persistedTypeToggle).toHaveAttribute(
        'aria-expanded',
        'true'
      );
      await expect(persistedTypeGroup.locator('.rel-item')).not.toHaveCount(0);
    });

    await test.step('seleção entre grupos e Carregar mais', async () => {
      await page.goto(MANAGER_HOME);
      await expectManagerRdoShell(page);
      await waitForReportCards(page);

      const groupsWithReports = page.locator('.report-project-group').filter({
        has: page.locator('.report-select-checkbox input[type="checkbox"]')
      });
      await expect
        .poll(() => groupsWithReports.count(), {
          timeout: REPORT_LIST_TIMEOUT
        })
        .toBeGreaterThan(1);

      const firstCard = groupsWithReports.nth(0).locator('.rel-item').first();
      const secondCard = groupsWithReports.nth(1).locator('.rel-item').first();
      const firstName = await selectedReportName(firstCard);
      const secondName = await selectedReportName(secondCard);

      await firstCard.getByRole('checkbox').check();
      await secondCard.getByRole('checkbox').check();
      await expect(
        page.locator('.report-select-checkbox input:checked')
      ).toHaveCount(2);
      await expect(
        page
          .locator('.rel-item')
          .filter({ hasText: firstName })
          .getByRole('checkbox')
      ).toBeChecked();
      await expect(
        page
          .locator('.rel-item')
          .filter({ hasText: secondName })
          .getByRole('checkbox')
      ).toBeChecked();

      const loadMore = page
        .getByRole('button', { name: 'Carregar mais', exact: true })
        .first();
      await expect(loadMore).toBeVisible();
      const projectLabel = (
        await loadMore
          .locator(
            'xpath=ancestor::*[contains(@class, "report-project-group")]'
          )
          .locator('.project-group-toggle .sec')
          .innerText()
      ).trim();
      const targetProjectGroup = page
        .locator('.report-project-group')
        .filter({ hasText: projectLabel })
        .first();
      const cardsBefore = await targetProjectGroup.locator('.rel-item').count();

      await loadMore.click();
      await expect
        .poll(() => targetProjectGroup.locator('.rel-item').count(), {
          message: 'Carregar mais deve materializar registros reais no grupo',
          timeout: REPORT_LIST_TIMEOUT
        })
        .toBeGreaterThan(cardsBefore);
      const cardsAfter = await targetProjectGroup.locator('.rel-item').count();

      await expect(
        page
          .locator('.rel-item')
          .filter({ hasText: firstName })
          .getByRole('checkbox')
      ).toBeChecked();
      await expect(
        page
          .locator('.rel-item')
          .filter({ hasText: secondName })
          .getByRole('checkbox')
      ).toBeChecked();

      await page.reload();
      await expectManagerRdoShell(page);
      await waitForReportCards(page);
      await expect
        .poll(() => targetProjectGroup.locator('.rel-item').count(), {
          message:
            'a quantidade carregada do grupo deve sobreviver ao reload atual',
          timeout: REPORT_LIST_TIMEOUT
        })
        .toBeGreaterThanOrEqual(cardsAfter);
      await expect(
        page.locator('.report-select-checkbox input:checked')
      ).toHaveCount(0);
    });

    await test.step('detalhe, retorno e preservação de aba/busca', async () => {
      await openApprovedReports(page);

      const search = page.getByRole('searchbox', {
        name: 'Buscar em aprovados'
      });
      const initialLabel = (
        await page.locator('.rel-name').first().innerText()
      ).trim();
      const projectName = projectNameFromReportLabel(initialLabel);

      await search.fill(projectName);
      await waitForSearchResults(page, projectName);

      const reportCard = page.locator('.rel-item').first();
      const openedReportLabel = await selectedReportName(reportCard);
      await expect(reportCard.locator('.rel-name')).toBeVisible();
      await reportCard.locator('.rdo-manager-listing__metadata').click();

      await expect(page).toHaveURL(/\/rdo\/gestor\/relatorio\/[^/?#]+$/);
      await expectLegacyRdoShell(page);
      await expect(
        page.getByText('Detalhe do relatório', { exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Voltar', exact: true })
      ).toBeVisible();
      await expect(
        page.getByText('Carregando relatório...', { exact: true })
      ).toHaveCount(0, {
        timeout: REPORT_LIST_TIMEOUT
      });

      await page.getByRole('button', { name: 'Voltar', exact: true }).click();
      await expect(page).toHaveURL(/\/rdo\/gestor\?tab=aprovados$/);
      await expect(
        page.locator('.fv-sidebar').getByRole('link', {
          name: 'Aprovados',
          exact: true
        })
      ).toHaveAttribute('aria-current', 'page');
      await expect(search).toHaveValue(projectName);
      await expect(
        page.locator('.rel-item').filter({ hasText: openedReportLabel })
      ).toBeVisible({
        timeout: REPORT_LIST_TIMEOUT
      });

      await page.reload();
      await expectManagerRdoShell(page);
      await expect(
        page.locator('.fv-sidebar').getByRole('link', {
          name: 'Aprovados',
          exact: true
        })
      ).toHaveAttribute('aria-current', 'page');
      await expect(search).toHaveValue(projectName);
      await expect(
        page.locator('.rel-item').filter({ hasText: openedReportLabel })
      ).toBeVisible({
        timeout: REPORT_LIST_TIMEOUT
      });
    });

    await test.step('estatísticas reais e filtro de período', async () => {
      const overviewResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/statistics/overview') &&
          response.ok()
      );
      await page
        .locator('.fv-sidebar')
        .getByRole('link', { name: 'Estatísticas', exact: true })
        .click();
      await overviewResponse;
      await expect(page).toHaveURL(/\/rdo\/gestor\?tab=estatisticas$/);

      const countCards = page.locator('.stats-ov-count-card');
      await expect(countCards).toHaveCount(3);
      const counts = await countCards
        .locator('.stats-ov-count-value')
        .allTextContents();
      const [active, archived, total] = counts.map((value) =>
        Number(value.trim())
      );
      expect(active).toBeGreaterThanOrEqual(0);
      expect(archived).toBeGreaterThanOrEqual(0);
      expect(total).toBe(active + archived);

      const overviewTable = page.getByRole('table');
      await expect(overviewTable).toBeVisible();
      const initialRows = await overviewTable.locator('tbody tr').count();
      expect(initialRows).toBeGreaterThan(0);

      const firstCells = await overviewTable
        .locator('tbody tr')
        .first()
        .getByRole('cell')
        .allTextContents();
      const typeCounts = firstCells
        .slice(1, -1)
        .map((value) => (value.trim() === '—' ? 0 : Number(value.trim())));
      const renderedTotal = Number(firstCells.at(-1)?.trim());
      expect(typeCounts.every(Number.isFinite)).toBe(true);
      expect(renderedTotal).toBe(
        typeCounts.reduce((sum, value) => sum + value, 0)
      );

      const showAll = page.getByRole('button', {
        name: /^Ver todos os \d+ projetos$/
      });
      if (await showAll.isVisible()) {
        await showAll.click();
        await expect
          .poll(() => overviewTable.locator('tbody tr').count())
          .toBeGreaterThan(initialRows);
      }

      const detailedResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/statistics/projects') &&
          response.ok()
      );
      await page.getByRole('button', { name: 'Dashboard detalhado' }).click();
      await detailedResponse;

      const dashboard = page.getByRole('dialog', {
        name: 'Dashboard de Estatísticas'
      });
      await expect(dashboard).toBeVisible();
      await expect(
        dashboard.getByText('Resumo do período', { exact: true })
      ).toBeVisible({
        timeout: REPORT_LIST_TIMEOUT
      });
      await expect(dashboard.locator('.stats-kpi-card')).not.toHaveCount(0);

      const monthResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/statistics/projects') &&
          response.ok()
      );
      const month = dashboard.getByRole('button', {
        name: 'Mês',
        exact: true
      });
      await month.click();
      await monthResponse;
      await expect(month).toHaveClass(/active/);
      await expect(
        dashboard.getByText('Resumo do período', { exact: true })
      ).toBeVisible();

      const driverDone = page.getByRole('button', {
        name: 'Entendi',
        exact: true
      });
      if (await driverDone.isVisible()) await driverDone.click();

      await dashboard.getByRole('button', { name: /Voltar/ }).click();
      await expect(dashboard).toHaveCount(0);
      await expect(
        page.locator('.fv-sidebar').getByRole('link', {
          name: 'Estatísticas',
          exact: true
        })
      ).toHaveAttribute('aria-current', 'page');
    });

    await test.step('logout real', async () => {
      await logoutFromRdo(page);
      await expect(
        page.getByRole('textbox', { name: 'Usuário', exact: true })
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    });
  });
});
