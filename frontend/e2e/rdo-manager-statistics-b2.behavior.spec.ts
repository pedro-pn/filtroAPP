import { expect, test, type Page } from '@playwright/test';

import {
  demoCredentials,
  expectManagerRdoShell,
  loginAs,
  logoutFromRdo
} from './support/rdo';

const MANAGER_HOME = '/rdo/gestor';

interface StatsOverviewResponse {
  projectCounts: { active: number; archived: number; total: number };
  byProject: Array<{
    projectId: string;
    code: string;
    name: string;
    reportCounts: Partial<Record<string, number>>;
  }>;
}

async function openManagerRdo(page: Page) {
  await loginAs(page, demoCredentials.manager);
  await page.goto(MANAGER_HOME);
  await expectManagerRdoShell(page);
}

test('B.2 preserva os dados reais e alterna exclusivamente DataTable/MobileList', async ({
  page
}) => {
  const nonGetStatisticsRequests: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes('/statistics') &&
      request.method().toUpperCase() !== 'GET'
    ) {
      nonGetStatisticsRequests.push(
        `${request.method().toUpperCase()} ${request.url()}`
      );
    }
  });

  let releaseOverview!: () => void;
  let overviewFetched!: () => void;
  const overviewRelease = new Promise<void>((resolve) => {
    releaseOverview = resolve;
  });
  const overviewReady = new Promise<void>((resolve) => {
    overviewFetched = resolve;
  });
  let overviewData: StatsOverviewResponse | undefined;

  await page.route('**/statistics/overview', async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    overviewData = JSON.parse(body.toString()) as StatsOverviewResponse;
    overviewFetched();
    await overviewRelease;
    await route.fulfill({ response, body });
  });

  await openManagerRdo(page);

  await page
    .locator('.fv-sidebar')
    .getByRole('link', { name: 'Estatísticas', exact: true })
    .click();
  await overviewReady;

  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=estatisticas$/);
  await expect(
    page.getByRole('status').filter({ hasText: 'Carregando visão geral...' })
  ).toBeVisible();

  releaseOverview();
  const overview = page.locator('.rdo-stats-overview');
  await expect(overview).toBeVisible();
  expect(overviewData).toBeDefined();

  const summaryRegion = page.getByRole('region', {
    name: 'Resumo dos projetos'
  });
  const expectedCountValues = [
    overviewData!.projectCounts.active,
    overviewData!.projectCounts.archived,
    overviewData!.projectCounts.total
  ];
  for (const value of expectedCountValues) {
    await expect(
      summaryRegion.getByText(String(value), { exact: true })
    ).toBeVisible();
  }

  const projectsWithReports = overviewData!.byProject.filter(
    (project) => Object.keys(project.reportCounts).length > 0
  );
  expect(projectsWithReports.length).toBeGreaterThan(0);
  const firstProject = projectsWithReports[0];
  const firstProjectTotal = Object.values(
    firstProject.reportCounts
  ).reduce<number>((total, count) => total + (count ?? 0), 0);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(overview.locator('table')).toHaveCount(0);
  const mobileList = overview.locator('.fv-mobile-list');
  await expect(mobileList).toBeVisible();
  const firstMobileItem = mobileList.locator('li').first();
  await expect(firstMobileItem).toContainText(firstProject.code);
  await expect(firstMobileItem).toContainText(firstProject.name);
  await expect(firstMobileItem).toContainText(String(firstProjectTotal));
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    )
    .toBe(true);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(overview.locator('.fv-mobile-list')).toHaveCount(0);
  const table = overview.getByRole('table', {
    name: 'Relatórios por projeto e tipo'
  });
  await expect(table).toBeVisible();
  await expect(table.locator('thead th[scope="col"]')).not.toHaveCount(0);

  const firstDesktopRow = table.locator('tbody tr').first();
  await expect(firstDesktopRow.getByRole('rowheader')).toContainText(
    firstProject.code
  );
  await expect(firstDesktopRow.locator('td').last()).toHaveText(
    String(firstProjectTotal)
  );

  const initialRows = await table.locator('tbody tr').count();
  const showAll = overview.getByRole('button', {
    name: /^Ver todos os \d+ projetos$/
  });
  if (await showAll.isVisible()) {
    await showAll.click();
    await expect
      .poll(() => table.locator('tbody tr').count())
      .toBeGreaterThan(initialRows);
  }

  expect(nonGetStatisticsRequests).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await logoutFromRdo(page);
});
