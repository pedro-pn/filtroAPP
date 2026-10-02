import {
  expect,
  test,
  type Locator,
  type Page,
  type Response
} from '@playwright/test';

import { demoCredentials, expectManagerRdoShell, loginAs } from './support/rdo';

const MANAGER_HOME = '/rdo/gestor';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type MonthlyAllocationAppearance = 'legacy' | 'design-system';

const expectedAppearance: MonthlyAllocationAppearance = (() => {
  const value = process.env.RDO_B6_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(
    `RDO_B6_EXPECT_APPEARANCE inválido: ${value}. Use legacy ou design-system.`
  );
})();

interface AllocationDay {
  date: string;
  shift: string;
  projectName: string;
  clientName: string;
  clientCnpj: string;
}

interface AllocationCollaborator {
  collaboratorId: string;
  collaboratorName: string;
  collaboratorRole: string;
  days: AllocationDay[];
}

interface AllocationResponse {
  yearMonth: string;
  label: string;
  summary: {
    reportCount: number;
    collaboratorCount: number;
    allocationCount: number;
    projectCount: number;
  };
  collaborators: AllocationCollaborator[];
}

interface AllocationRecipient {
  id: string;
  name: string | null;
  email: string;
  isActive: boolean;
}

function isAllocationSummaryResponse(response: Response) {
  const url = new URL(response.url());
  return (
    response.request().method() === 'GET' &&
    url.pathname.endsWith('/statistics/allocation-report') &&
    response.ok()
  );
}

function isRecipientsResponse(response: Response) {
  const url = new URL(response.url());
  return (
    response.request().method() === 'GET' &&
    url.pathname.endsWith('/statistics/allocation-report/recipients') &&
    response.ok()
  );
}

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function previousMonth(value: string) {
  const month = Number(value);
  return String(month === 1 ? 12 : month - 1).padStart(2, '0');
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

async function expectKpis(dialog: Locator, data: AllocationResponse) {
  const expectations: Array<[string, number]> = [
    ['RDOs', data.summary.reportCount],
    ['Colaboradores', data.summary.collaboratorCount],
    ['Alocações', data.summary.allocationCount],
    ['Projetos', data.summary.projectCount]
  ];

  for (const [label, value] of expectations) {
    const card = dialog
      .locator('.stats-ov-count-card')
      .filter({ hasText: label });
    await expect(card).toHaveCount(1);
    await expect(card.locator('.stats-ov-count-value')).toHaveText(
      String(value)
    );
  }
}

async function expectFirstCollaborator(
  dialog: Locator,
  data: AllocationResponse
) {
  const first = data.collaborators[0];
  if (!first) {
    await expect(
      dialog.getByText('Nenhuma alocação encontrada para o mês selecionado.', {
        exact: true
      })
    ).toBeVisible();
    return;
  }

  await expect(dialog.locator('.stats-alloc-person').first()).toContainText(
    first.collaboratorName
  );
  await expect(
    dialog.getByText(first.collaboratorRole || '-', { exact: true }).first()
  ).toBeVisible();

  const firstDay = first.days[0];
  if (!firstDay) return;
  for (const text of [
    formatDate(firstDay.date),
    firstDay.shift,
    firstDay.projectName,
    firstDay.clientName || '-',
    firstDay.clientCnpj || '-'
  ]) {
    await expect(dialog.getByText(text, { exact: true }).first()).toBeVisible();
  }
}

async function expectAppearance(dialog: Locator) {
  if (expectedAppearance === 'design-system') {
    await expect(dialog).toHaveClass(/fv-modal/);
    await expect(dialog).not.toHaveClass(/survey-dash-overlay/);
    await expect(dialog.locator('.rdo-stats-allocation')).toBeVisible();
    return;
  }

  await expect(dialog).toHaveClass(/survey-dash-overlay/);
  await expect(dialog).not.toHaveClass(/fv-modal/);
  await expect(dialog.locator('.stats-alloc-dashboard')).toBeVisible();
}

async function expectResponsiveRepresentation(
  page: Page,
  dialog: Locator,
  hasRows: boolean
) {
  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoDocumentOverflow(page);

  if (expectedAppearance === 'design-system') {
    await expect(dialog.locator('table')).toHaveCount(0);
    await expect(dialog.locator('.fv-data-table__desktop')).toHaveCount(0);
    await expect(dialog.locator('.fv-mobile-list')).toHaveCount(
      hasRows ? 1 : 0
    );

    const undersized = await dialog
      .locator('button, input, select')
      .evaluateAll((elements) =>
        elements.flatMap((element) => {
          const target = element as HTMLElement;
          const rect = target.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return [];
          return rect.width >= 44 && rect.height >= 44
            ? []
            : [
                target.getAttribute('aria-label') ||
                  target.textContent ||
                  target.tagName
              ];
        })
      );
    expect(undersized).toEqual([]);
  } else if (hasRows) {
    await expect(dialog.getByRole('table')).toBeVisible();
    await expect(dialog.locator('.fv-mobile-list')).toHaveCount(0);
    await expect
      .poll(() =>
        dialog
          .locator('.stats-alloc-table-wrap')
          .evaluate((element) => element.scrollWidth > element.clientWidth)
      )
      .toBe(true);
  }

  await dialog.getByRole('tab', { name: 'Destinatários', exact: true }).click();
  const email = dialog.getByPlaceholder('email@empresa.com');
  await expect(email).toHaveCSS(
    'font-size',
    expectedAppearance === 'design-system' ? '16px' : '13px'
  );
  if (expectedAppearance === 'design-system') {
    await email.click();
    await expect(email).toBeFocused();
    await expect(email).toHaveCSS('outline-style', 'none');

    const controlShell = email.locator('xpath=..');
    await expect(controlShell).toHaveClass(/fv-control-shell/);
    await expect(controlShell).toHaveCSS('outline-style', 'solid');
  }

  await page.setViewportSize({ width: 768, height: 1024 });
  await expectNoDocumentOverflow(page);
  await dialog.getByRole('tab', { name: 'Resumo', exact: true }).click();

  if (expectedAppearance === 'design-system') {
    await expect(dialog.locator('.fv-mobile-list')).toHaveCount(0);
    await expect(dialog.locator('.fv-data-table__desktop')).toHaveCount(
      hasRows ? 1 : 0
    );
  } else if (hasRows) {
    await expect(dialog.getByRole('table')).toBeVisible();
  }
}

test('B.6 caracteriza a Alocação mensal real sem mutations ou downloads', async ({
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

  const statisticsTab = page
    .locator('.fv-sidebar')
    .getByRole('link', { name: 'Estatísticas', exact: true });
  const launcher = page.getByRole('button', {
    name: 'Alocação mensal',
    exact: true
  });
  await expect(launcher).toBeVisible();
  await expect(launcher).toBeEnabled();

  const mutatingAttempts: string[] = [];
  const pdfAttempts: string[] = [];
  let releaseInitialResponse: (() => void) | undefined;
  const initialResponseGate = new Promise<void>((resolve) => {
    releaseInitialResponse = resolve;
  });
  let observeInitialPayload: ((data: AllocationResponse) => void) | undefined;
  const initialPayload = new Promise<AllocationResponse>((resolve) => {
    observeInitialPayload = resolve;
  });
  let initialSummaryHeld = false;

  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());

    if (MUTATING_METHODS.has(method)) {
      mutatingAttempts.push(`${method} ${request.url()}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (
      method === 'GET' &&
      url.pathname.endsWith('/statistics/allocation-report/pdf')
    ) {
      pdfAttempts.push(`${method} ${request.url()}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (
      !initialSummaryHeld &&
      method === 'GET' &&
      url.pathname.endsWith('/statistics/allocation-report')
    ) {
      initialSummaryHeld = true;
      const response = await route.fetch();
      const data = (await response.json()) as AllocationResponse;
      observeInitialPayload?.(data);
      await initialResponseGate;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  const recipientsResponsePromise = page.waitForResponse(isRecipientsResponse);
  await launcher.click();
  const data = await initialPayload;

  const dialog = page.getByRole('dialog', {
    name: 'Alocação mensal de colaboradores'
  });
  await expect(dialog).toBeVisible();
  await expectAppearance(dialog);
  await expect(
    dialog.getByText('Carregando alocações...', { exact: true })
  ).toBeVisible();

  const bodyOverflowBeforeRelease = await page.evaluate(
    () => document.body.style.overflow
  );
  if (expectedAppearance === 'design-system') {
    expect(bodyOverflowBeforeRelease).toBe('hidden');
    await expect
      .poll(() =>
        dialog.evaluate((element) => element.contains(document.activeElement))
      )
      .toBe(true);
  } else {
    await expect(launcher).toBeFocused();
  }

  releaseInitialResponse?.();
  await expect(
    dialog.getByText('Carregando alocações...', { exact: true })
  ).toHaveCount(0);
  const recipientsResponse = await recipientsResponsePromise;
  const recipients = (await recipientsResponse.json()) as AllocationRecipient[];

  await expectKpis(dialog, data);
  await expectFirstCollaborator(dialog, data);
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=estatisticas$/);
  await expect(statisticsTab).toHaveAttribute('aria-current', 'page');

  const currentYear = String(new Date().getFullYear());
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const year = dialog.getByRole('combobox', { name: 'Ano', exact: true });
  const month = dialog.getByRole('combobox', { name: 'Mês', exact: true });
  await expect(year).toHaveValue(currentYear);
  await expect(month).toHaveValue(currentMonth);
  await expect(year.locator('option')).toHaveCount(8);
  await expect(month.locator('option')).toHaveCount(12);
  expect(data.yearMonth).toBe(`${currentYear}-${currentMonth}`);

  const safeMonth = previousMonth(currentMonth);
  const changedMonthResponsePromise = page.waitForResponse((response) => {
    if (!isAllocationSummaryResponse(response)) return false;
    return (
      new URL(response.url()).searchParams.get('yearMonth') ===
      `${currentYear}-${safeMonth}`
    );
  });
  await month.selectOption(safeMonth);
  const changedMonthResponse = await changedMonthResponsePromise;
  const changedMonthData =
    (await changedMonthResponse.json()) as AllocationResponse;
  await expect(month).toHaveValue(safeMonth);
  expect(changedMonthData.yearMonth).toBe(`${currentYear}-${safeMonth}`);
  await expectKpis(dialog, changedMonthData);

  const nextYear = String(Number(currentYear) + 1);
  const emptyCandidateResponsePromise = page.waitForResponse((response) => {
    if (!isAllocationSummaryResponse(response)) return false;
    return (
      new URL(response.url()).searchParams.get('yearMonth') ===
      `${nextYear}-${safeMonth}`
    );
  });
  await year.selectOption(nextYear);
  const emptyCandidateResponse = await emptyCandidateResponsePromise;
  const emptyCandidate =
    (await emptyCandidateResponse.json()) as AllocationResponse;
  if (emptyCandidate.collaborators.length === 0) {
    await expect(
      dialog.getByText('Nenhuma alocação encontrada para o mês selecionado.', {
        exact: true
      })
    ).toBeVisible();
  } else {
    await expectFirstCollaborator(dialog, emptyCandidate);
  }

  const recipientsTab = dialog.getByRole('tab', {
    name: 'Destinatários',
    exact: true
  });
  await recipientsTab.click();
  await expect(recipientsTab).toHaveAttribute('aria-selected', 'true');
  const activeRecipients = recipients.filter((recipient) => recipient.isActive);
  await expect(
    dialog.getByText(
      `O envio automático ocorre no dia 1 para o mês anterior. Ativos: ${activeRecipients.length}`,
      { exact: true }
    )
  ).toBeVisible();
  await expect(dialog.getByPlaceholder('Nome opcional')).toHaveValue('');
  const recipientEmail = dialog.getByPlaceholder('email@empresa.com');
  await expect(recipientEmail).toHaveValue('');
  await expect(recipientEmail).toHaveAttribute('required', '');
  for (const recipient of recipients) {
    await expect(
      dialog.getByText(recipient.name || recipient.email, { exact: true })
    ).toBeVisible();
    if (recipient.name) {
      await expect(
        dialog.getByText(recipient.email, { exact: true })
      ).toBeVisible();
    }
  }
  const sendNow = dialog.getByRole('button', {
    name: 'Enviar agora',
    exact: true
  });
  if (activeRecipients.length === 0) await expect(sendNow).toBeDisabled();
  else await expect(sendNow).toBeEnabled();

  await dialog.getByRole('tab', { name: 'Resumo', exact: true }).click();
  await month.selectOption(currentMonth);
  await year.selectOption(currentYear);
  await expectResponsiveRepresentation(
    page,
    dialog,
    data.collaborators.length > 0
  );

  const backdrop =
    expectedAppearance === 'design-system'
      ? page.locator('.fv-modal-backdrop[data-fv-ds]')
      : dialog;
  await backdrop.dispatchEvent('mousedown');
  await expect(dialog).toBeVisible();

  const focusable = dialog.locator(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const firstFocusable = focusable.first();
  const lastFocusable = focusable.last();
  await lastFocusable.focus();
  await page.keyboard.press('Tab');
  if (expectedAppearance === 'design-system') {
    await expect(firstFocusable).toBeFocused();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog.getByRole('button', { name: /Voltar/ }).click();
  await expect(dialog).toHaveCount(0);
  if (expectedAppearance === 'design-system') {
    await expect(launcher).toBeFocused();
  } else {
    await expect
      .poll(() => page.evaluate(() => document.activeElement === document.body))
      .toBe(true);
  }
  await expect(page).toHaveURL(/\/rdo\/gestor\?tab=estatisticas$/);
  await expect(statisticsTab).toHaveAttribute('aria-current', 'page');

  await launcher.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Resumo' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(
    dialog.getByRole('combobox', { name: 'Ano', exact: true })
  ).toHaveValue(currentYear);
  await expect(
    dialog.getByRole('combobox', { name: 'Mês', exact: true })
  ).toHaveValue(currentMonth);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launcher).toBeFocused();

  expect(mutatingAttempts, 'nenhuma mutation deve ser tentada').toEqual([]);
  expect(pdfAttempts, 'nenhum download de PDF deve ser tentado').toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
