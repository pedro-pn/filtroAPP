import { expect, test } from '@playwright/test';

const account = {
  id: 'maintenance-admin', username: 'maintenance-admin', name: 'Gestora de manutenção',
  email: 'maintenance@example.com', role: 'MANAGER', accountType: 'ADMIN',
  moduleRoles: ['equipamentos:manager'], reportEmissionPermissions: ['MAINTENANCE'], isActive: true
};

const category = { id: 'filters', name: 'Filtros industriais', maintenanceIntervalDays: 30 };
const schedule = {
  items: [
    { equipment: { id: 'eq-1', code: 'F-101', name: 'Filtro principal' }, category,
      lastMaintenanceId: 'maintenance-1', lastMaintenanceDate: '2026-08-01', nextMaintenanceDate: '2026-08-31', status: 'OVERDUE', daysUntilDue: -31 },
    { equipment: { id: 'eq-2', code: 'F-102', name: 'Filtro reserva' }, category,
      lastMaintenanceId: 'maintenance-2', lastMaintenanceDate: '2026-09-01', nextMaintenanceDate: '2026-10-01', status: 'DUE_TODAY', daysUntilDue: 0 },
    { equipment: { id: 'eq-3', code: 'F-103', name: 'Filtro auxiliar' }, category,
      lastMaintenanceId: 'maintenance-3', lastMaintenanceDate: '2026-09-20', nextMaintenanceDate: '2026-10-20', status: 'UPCOMING', daysUntilDue: 19 }
  ],
  categories: [category],
  summary: { OVERDUE: 1, DUE_TODAY: 1, UPCOMING: 1, NO_HISTORY: 0, UNCONFIGURED: 0, total: 3 },
  pagination: { page: 1, pageSize: 50, total: 3, totalPages: 1 },
  referenceDate: '2026-10-01'
};

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 }
] as const) {
  test(`Programação de manutenção no tema escuro · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() => {
      localStorage.setItem('filtrovali-react-token', 'synthetic-maintenance-token');
      localStorage.setItem('filtrovali-theme', 'dark');
    });
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/api/')) return route.fallback();
      const body = path === '/api/auth/me' ? { user: account }
        : path === '/api/rdo/operational-reports/maintenance/schedule' ? schedule : {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/manutencao-producao?tab=programacao-manutencao');
    await expect(page.getByRole('heading', { name: 'Programação' })).toBeVisible();
    await expect(page.locator(viewport.name === 'mobile' ? '.operational-schedule-cards' : '.operational-schedule-table').getByText('Filtro principal')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`maintenance-schedule-dark-${viewport.name}.png`, { fullPage: true });
  });
}
