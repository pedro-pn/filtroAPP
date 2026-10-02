import { expect, test, type Page, type Response } from '@playwright/test';

import {
  demoCredentials,
  expectManagerRdoShell,
  loginAs,
  logoutFromRdo
} from './support/rdo';

const MANAGER_HOME = '/rdo/gestor';

interface StatsSummary {
  totalDays: number;
  standbyCount: number;
  daytimeWorkedMinutes: number;
}

interface StatsProjectData {
  projectId: string;
  services: Record<string, { items?: unknown[] }>;
}

interface ProjectStatsResponse {
  summary: StatsSummary;
  services: Record<string, { items?: unknown[] }>;
  byProject: StatsProjectData[];
}

function isProjectStatsResponse(response: Response) {
  const url = new URL(response.url());
  return (
    response.request().method() === 'GET' &&
    url.pathname.endsWith('/statistics/projects') &&
    response.ok()
  );
}

function isProjectStatsResponseWith(
  expected: Record<string, string>
): (response: Response) => boolean {
  return (response) => {
    if (!isProjectStatsResponse(response)) return false;
    const params = new URL(response.url()).searchParams;
    return Object.entries(expected).every(
      ([name, value]) => params.get(name) === value
    );
  };
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}min`;
  return remainder === 0
    ? `${hours}h`
    : `${hours}h${String(remainder).padStart(2, '0')}`;
}

async function openManagerStatistics(page: Page) {
  await loginAs(page, demoCredentials.manager);
  await page.goto(MANAGER_HOME);
  await expectManagerRdoShell(page);

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
}

async function dismissProjectFilterHighlightIfVisible(page: Page) {
  const done = page.getByRole('button', { name: 'Entendi', exact: true });
  try {
    await done.waitFor({ state: 'visible', timeout: 1_500 });
    await done.click();
  } catch {
    // A dica é exibida somente uma vez por usuário/contexto de navegador.
  }
}

test('B.3 preserves the real detailed dashboard behavior without mutations or downloads', async ({
  page
}) => {
  const nonGetStatisticsRequests: string[] = [];
  const exportRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('request', (request) => {
    if (!request.url().includes('/statistics')) return;
    if (request.url().includes('/statistics/projects/export')) {
      exportRequests.push(`${request.method()} ${request.url()}`);
    }
    if (request.method().toUpperCase() !== 'GET') {
      nonGetStatisticsRequests.push(
        `${request.method().toUpperCase()} ${request.url()}`
      );
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 900 });
  await openManagerStatistics(page);

  const statisticsTab = page
    .locator('.fv-sidebar')
    .getByRole('link', { name: 'Estatísticas', exact: true });
  const launcher = page.getByRole('button', {
    name: 'Abrir dashboard detalhado',
    exact: true
  });
  await expect(launcher).toBeVisible();

  const initialResponse = page.waitForResponse(isProjectStatsResponse);
  await launcher.click();
  const statsResponse = await initialResponse;
  const statsData = (await statsResponse.json()) as ProjectStatsResponse;

  const dashboard = page.getByRole('dialog', {
    name: 'Dashboard de Estatísticas'
  });
  await expect(dashboard).toBeVisible();
  await expect(dashboard.locator('.rdo-stats-dashboard')).toBeVisible();
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=estatisticas$/);
  await expect(statisticsTab).toHaveAttribute('aria-current', 'page');

  await dismissProjectFilterHighlightIfVisible(page);

  const daysCard = dashboard
    .locator('.stats-kpi-card')
    .filter({ hasText: 'Dias executados' });
  await expect(daysCard.locator('.stats-kpi-value')).toHaveText(
    String(statsData.summary.totalDays)
  );
  const standbyCard = dashboard
    .locator('.stats-kpi-card')
    .filter({ hasText: 'Standby' });
  await expect(standbyCard.locator('.stats-kpi-value')).toHaveText(
    `${statsData.summary.standbyCount} ${statsData.summary.standbyCount === 1 ? 'dia' : 'dias'}`
  );
  const daytimePanel = dashboard.locator(
    '.stats-shift-panel[data-shift="daytime"]'
  );
  await expect(daytimePanel.locator('dd').first()).toHaveText(
    formatMinutes(statsData.summary.daytimeWorkedMinutes)
  );

  const projectPicker = dashboard.locator('.stats-project-picker');
  await projectPicker.locator('summary').click();
  await expect(
    projectPicker.getByRole('searchbox', { name: 'Buscar projeto' })
  ).toBeVisible();
  await projectPicker.locator('summary').click();

  const servicesTimeline = dashboard.getByRole('button', {
    name: 'Serviços realizados',
    exact: true
  });
  if (await servicesTimeline.isVisible()) {
    await servicesTimeline.click();
    await expect(servicesTimeline).toHaveAttribute('aria-pressed', 'true');
  }

  const firstProjectDisclosure = dashboard
    .locator('.stats-byproject-toggle')
    .first();
  if (await firstProjectDisclosure.isVisible()) {
    const controlledId =
      await firstProjectDisclosure.getAttribute('aria-controls');
    expect(controlledId).toBeTruthy();
    await firstProjectDisclosure.click();
    await expect(firstProjectDisclosure).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(dashboard.locator(`#${controlledId}`)).toBeVisible();
  }

  const monthResponse = page.waitForResponse(
    isProjectStatsResponseWith({ granularity: 'week' })
  );
  const month = dashboard.getByRole('button', { name: 'Mês', exact: true });
  await month.click();
  await monthResponse;
  await expect(month).toHaveClass(/active/);
  await expect(month).toHaveAttribute('aria-pressed', 'true');

  const status = dashboard.getByRole('combobox', {
    name: 'Status do projeto',
    exact: true
  });
  const activeProjectsResponse = page.waitForResponse(
    isProjectStatsResponseWith({ projectStatus: 'active' })
  );
  await status.selectOption('active');
  const activeStatsResponse = await activeProjectsResponse;
  const activeStatsData =
    (await activeStatsResponse.json()) as ProjectStatsResponse;
  await expect(status).toHaveValue('active');

  const firstServiceDisclosure = dashboard
    .locator('.stats-service-disclosure')
    .first();
  if (await firstServiceDisclosure.isVisible()) {
    await firstServiceDisclosure.locator('summary').click();
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(dashboard.locator('table')).toHaveCount(0);
  const hasResponsiveServiceRows = Object.values(activeStatsData.services).some(
    (service) => (service.items?.length ?? 0) > 0
  );
  if (hasResponsiveServiceRows) {
    await expect(dashboard.locator('.fv-mobile-list').first()).toBeVisible();
  }
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    )
    .toBe(true);

  const undersizedControls = await dashboard
    .locator('button, input, select')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        if (
          rect.width === 0 ||
          rect.height === 0 ||
          htmlElement.getAttribute('aria-hidden') === 'true'
        ) {
          return [];
        }
        if (rect.width >= 44 && rect.height >= 44) return [];
        return [
          htmlElement.getAttribute('aria-label') ||
            htmlElement.textContent?.trim() ||
            htmlElement.tagName
        ];
      })
    );
  expect(undersizedControls).toEqual([]);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(dashboard.locator('.fv-mobile-list')).toHaveCount(0);
  if (hasResponsiveServiceRows) {
    await expect(
      dashboard.locator('.fv-data-table__desktop').first()
    ).toBeVisible();
  }
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    )
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(dashboard).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await expect(statisticsTab).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=estatisticas$/);

  await launcher.click();
  await expect(dashboard).toBeVisible();
  await expect(
    dashboard.getByRole('button', { name: 'Ano', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    dashboard.getByRole('combobox', {
      name: 'Status do projeto',
      exact: true
    })
  ).toHaveValue('all');

  await dashboard.getByRole('button', { name: /Voltar/ }).click();
  await expect(dashboard).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await expect(statisticsTab).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=estatisticas$/);

  expect(nonGetStatisticsRequests).toEqual([]);
  expect(exportRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.setViewportSize({ width: 1280, height: 900 });
  await logoutFromRdo(page);
});
