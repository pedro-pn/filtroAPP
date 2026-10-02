import { expect, test, type Page } from '@playwright/test';

const user = {
  id: 'context-manager',
  username: 'context-manager',
  name: 'Gestor',
  email: 'gestor@example.com',
  role: 'MANAGER',
  accountType: 'INTERNAL',
  moduleRoles: ['rdo:manager'],
  reportEmissionPermissions: ['SITE_RDO'],
  isActive: true
};
const project = {
  id: 'multi',
  code: '101',
  name: 'Projeto com opções',
  clientName: 'Cliente',
  clientCnpj: '11222333000144',
  location: 'Oficina',
  additionalWorkLocations: ['Canteiro'],
  contractCode: 'P-1',
  isActive: true,
  visibleToCollaborators: true,
  operatorId: 'colab-1',
  operator: { id: 'colab-1', name: 'Ana' },
  plannedServices: [
    { id: 'planned-1', scopeName: 'UG 1' },
    { id: 'planned-2', scopeName: 'UG 1' },
    { id: 'planned-3', scopeName: 'UG 2' }
  ],
  clientEmailCc: [],
  clientSigners: [],
  authorizedUsers: [],
  surveys: [],
  reportSequences: [],
  workdayHours: '09:00',
  weekendWorkdayHours: '08:00',
  includesSaturday: false,
  includesSunday: false
};
const singleProject = {
  ...project,
  id: 'single',
  code: '102',
  name: 'Projeto único',
  additionalWorkLocations: [],
  plannedServices: [project.plannedServices[0]]
};
const services = ['UG 1', 'UG 2'].map((scope, i) => ({
  id: `service-${i}`,
  serviceType: 'mecanica',
  system: 'Sistema',
  startTime: '08:00',
  endTime: '09:00',
  finalized: false,
  extraData: {
    equipmentId: 'EQ-1',
    __scopeKey: JSON.stringify(scope),
    __scopeName: scope,
    material: 'Aço',
    etapas: ['Preparação']
  }
}));
const report = {
  id: 'report-1',
  projectId: project.id,
  project,
  reportType: 'RDO',
  status: 'PENDING',
  sequenceNumber: 1,
  reportDate: '2026-10-02',
  arrivalTime: '08:00',
  departureTime: '17:00',
  lunchBreak: '01:00:00',
  createdByUserId: user.id,
  createdAt: '2026-10-02T12:00:00Z',
  updatedAt: '2026-10-02T12:00:00Z',
  specialConditions: { workLocation: 'Canteiro' },
  collaborators: [{ collaboratorId: 'colab-1' }],
  services
};

async function mockApp(page: Page, savedReport = report) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.addInitScript(() => {
    localStorage.setItem('filtrovali-react-token', 'context-test-token');
    localStorage.setItem('filtrovali-tutorial-done:context-manager', '1');
    localStorage.setItem('filtrovali:rdo-dds-novelty:v2:context-manager', '1');
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    const body = request.postData() ? request.postDataJSON() : {};
    if (['POST', 'PUT'].includes(request.method()))
      requests.push({ path, body });
    const resources = {
      projects: [project, singleProject],
      collaborators: [
        { id: 'colab-1', name: 'Ana', role: 'Técnico', isActive: true }
      ],
      units: [],
      manometers: [],
      counters: [],
      equipments: [],
      rdoSlotMap: {},
      inhibitionOptions: { vessels: [], systems: [] },
      drafts: []
    };
    let response: unknown = [];
    if (path === '/api/auth/me') response = { user };
    else if (
      path.includes('/bootstrap/new-report') ||
      path.includes('/bootstrap/report-detail/')
    )
      response = { ...resources, equipment: [], sequenceReports: [] };
    else if (path.includes('/bootstrap/gestor'))
      response = {
        activeProjects: [project],
        archivedProjects: [],
        collaborators: resources.collaborators,
        surveys: [],
        projectSegments: [],
        surveyQuestions: []
      };
    else if (
      path.endsWith('/collaborator-prefill') ||
      path.endsWith('/planning-context')
    )
      response = null;
    else if (path.endsWith('/availability'))
      response = { conflicts: [], holidays: [] };
    else if (path === '/api/rdo/reports/counts')
      response = { totals: (body.queries || []).map(() => 0) };
    else if (path === '/api/rdo/reports')
      response =
        request.method() === 'POST'
          ? { ...report, ...body }
          : new URL(request.url()).searchParams.has('pageSize')
            ? {
                items: [],
                pagination: { total: 0, page: 1, pageSize: 25, totalPages: 0 },
                groups: []
              }
            : [];
    else if (path === '/api/rdo/reports/report-1')
      response =
        request.method() === 'PUT' ? { ...savedReport, ...body } : savedReport;
    else if (path.includes('/drafts') && request.method() !== 'GET')
      response = { id: 'draft-1', ...body };
    else if (path === '/api/rdo/projects' && request.method() === 'POST')
      response = { ...project, ...body, id: 'created' };
    else if (path === '/api/rdo/projects/multi')
      response = { ...project, ...body };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });
  return requests;
}

async function fillHeader(page: Page) {
  await page.locator('#rdo-project').selectOption('multi');
  await page.locator('#rdo-date').fill('2026-10-02');
  await page.locator('#rdo-arrival').fill('08:00');
  await page.locator('#rdo-departure').fill('17:00');
  await page.locator('#rdo-lunch').fill('01:00:00');
  await page
    .getByRole('combobox', { name: 'Adicionar colaborador', exact: true })
    .selectOption('colab-1');
}

test('local e escopo são obrigatórios, independentes por serviço e persistidos no rascunho', async ({
  page
}) => {
  test.setTimeout(90_000);
  const requests = await mockApp(page);
  await page.goto('/rdo/relatorio/novo?tipo=obra');
  await expect(page.locator('#rdo-work-location')).toHaveCount(0);
  await fillHeader(page);
  await expect(
    page.getByRole('combobox', { name: 'Local da obra' })
  ).toHaveValue('');
  await expect(page.locator('#rdo-work-location option')).toHaveText([
    'Selecione o local da obra...',
    'Oficina',
    'Canteiro'
  ]);
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await expect(page.locator('#rdo-work-location')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page.locator('#rdo-work-location').selectOption('Canteiro');
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  for (const type of ['Limpeza química', 'Limpeza mecânica']) {
    await page
      .getByRole('button', { name: 'Adicionar serviço', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Tipo de serviço' })
      .getByRole('button', { name: type, exact: true })
      .click();
  }
  const cards = page.locator('[data-service-id]');
  await expect(cards).toHaveCount(2);
  const firstScope = cards.nth(0).getByRole('combobox', { name: 'Escopo' });
  const secondScope = cards.nth(1).getByRole('combobox', { name: 'Escopo' });
  await expect(firstScope.locator('option')).toHaveCount(3);
  await expect(secondScope).toHaveAttribute('required', '');
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await expect(firstScope).toHaveAttribute('aria-invalid', 'true');
  expect(
    await firstScope.evaluate((element) =>
      Boolean(
        element.compareDocumentPosition(
          element.closest('[data-service-id]')!.querySelector('input')!
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      )
    )
  ).toBe(true);
  await firstScope.selectOption('"UG 2"');
  await secondScope.selectOption('"UG 1"');
  await expect
    .poll(
      () =>
        requests.filter((request) => request.path.includes('/drafts')).at(-1)
          ?.body.payload
    )
    .toMatchObject({
      workLocation: 'Canteiro',
      services: [
        { data: { __scopeName: 'UG 2' } },
        { data: { __scopeName: 'UG 1' } }
      ]
    });
  await page.getByRole('tab', { name: 'Cabeçalho', exact: true }).click();
  await page.locator('#rdo-project').selectOption('single');
  await expect(page.locator('#rdo-work-location')).toHaveCount(0);
  await expect(page.getByText('Local da obra', { exact: true })).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Adicionar colaborador', exact: true })
    .selectOption('colab-1');
  await page.getByRole('tab', { name: 'Serviços', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Escopo' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Cabeçalho', exact: true }).click();
  await page.locator('#rdo-project').selectOption('multi');
  await expect(page.locator('#rdo-work-location')).toHaveValue('');
  await page.locator('#rdo-work-location').selectOption('Oficina');
  await page
    .getByRole('combobox', { name: 'Adicionar colaborador', exact: true })
    .selectOption('colab-1');
  await page.getByRole('tab', { name: 'Serviços', exact: true }).click();
  await expect(firstScope).toHaveValue('');
  await expect(secondScope).toHaveValue('');
});

test('RDO sem serviços salva o local selecionado no envio', async ({
  page
}) => {
  const requests = await mockApp(page);
  await page.goto('/rdo/relatorio/novo?tipo=obra');
  await fillHeader(page);
  await page.locator('#rdo-work-location').selectOption('Canteiro');
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await page
    .getByRole('button', { name: 'Enviar relatório', exact: true })
    .click();
  await expect
    .poll(
      () =>
        requests.find((request) => request.path === '/api/rdo/reports')?.body
    )
    .toMatchObject({
      specialConditions: { workLocation: 'Canteiro' },
      services: []
    });
});

test('editor restaura local e escopos e salva as alterações', async ({
  page
}) => {
  const requests = await mockApp(page);
  await page.goto('/rdo/gestor/relatorio/report-1');
  await expect(page.locator('#rdo-work-location')).toHaveValue('Canteiro');
  await expect(page.locator('#service-scope-service-0')).toHaveValue('"UG 1"');
  await expect(page.locator('#service-scope-service-1')).toHaveValue('"UG 2"');
  await page.locator('#service-scope-service-1').selectOption('');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.locator('#service-scope-service-1')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page.locator('#service-scope-service-1').selectOption('"UG 1"');
  await page.locator('#rdo-work-location').selectOption('Oficina');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect
    .poll(
      () =>
        requests.find((request) => request.path === '/api/rdo/reports/report-1')
          ?.body
    )
    .toMatchObject({
      specialConditions: { workLocation: 'Oficina' },
      services: [
        { extraData: { __scopeName: 'UG 1' } },
        { extraData: { __scopeName: 'UG 1' } }
      ]
    });
});

test('editor sem local salvo exige seleção na lista e não preenche o primeiro local', async ({
  page
}) => {
  await mockApp(page, { ...report, specialConditions: { workLocation: '' } });
  await page.goto('/rdo/gestor/relatorio/report-1');
  const field = page.getByRole('combobox', { name: 'Local da obra' });
  await expect(field).toHaveValue('');
  await expect(field.locator('option')).toHaveText([
    'Selecione o local da obra...',
    'Oficina',
    'Canteiro'
  ]);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
});

test('cadastro de projeto adiciona e remove locais antes de salvar', async ({
  page
}) => {
  const requests = await mockApp(page);
  await page.goto('/rdo/gestor?tab=projetos');
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  const form = page.locator('.rdo-manager-projects__legacy-form');
  await form.locator('#project-code').fill('103');
  await form.locator('#project-name').fill('Novo projeto');
  await form.locator('#project-client-name').fill('Cliente');
  await form.locator('#project-client-cnpj').fill('11222333000144');
  await form.locator('#project-contract').fill('P-2');
  await form.locator('#project-location').fill('Oficina');
  await form
    .getByRole('button', { name: 'Adicionar local da obra', exact: true })
    .click();
  const secondLocation = form.getByRole('textbox', {
    name: 'Local da obra 2',
    exact: true
  });
  await expect(secondLocation).toBeFocused();
  await secondLocation.pressSequentially('Canteiro');
  await expect(secondLocation).toBeFocused();
  await form
    .getByRole('button', { name: 'Adicionar local da obra', exact: true })
    .click();
  const thirdLocation = form.getByRole('textbox', {
    name: 'Local da obra 3',
    exact: true
  });
  await expect(thirdLocation).toBeFocused();
  await thirdLocation.pressSequentially('Navio');
  await expect(thirdLocation).toBeFocused();
  await form
    .getByRole('button', { name: 'Remover local da obra 2', exact: true })
    .click();
  await expect(
    form.getByRole('textbox', { name: 'Local da obra 2', exact: true })
  ).toHaveValue('Navio');
  await form
    .getByRole('button', { name: 'Criar projeto', exact: true })
    .click();
  await expect
    .poll(
      () =>
        requests.find((request) => request.path === '/api/rdo/projects')?.body
    )
    .toMatchObject({ location: 'Oficina', additionalWorkLocations: ['Navio'] });
});

test('edição dos locais mantém foco e seleção do texto e salva os valores', async ({
  page
}) => {
  const requests = await mockApp(page);
  await page.goto('/rdo/gestor?tab=projetos');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const form = page.locator('.rdo-project-edit-form');
  const location = form.getByRole('textbox', {
    name: 'Local da obra',
    exact: true
  });
  await expect(location).toHaveValue('Oficina');
  await form.locator('label[for="project-location-multi"]').click();
  await expect(location).toBeFocused();
  await location.press('End');
  await location.pressSequentially(' central');
  await expect(location).toHaveValue('Oficina central');
  await expect(location).toBeFocused();
  await location.press('ControlOrMeta+A');
  await expect
    .poll(() =>
      location.evaluate((input: HTMLInputElement) =>
        input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
      )
    )
    .toBe('Oficina central');
  await location.pressSequentially('Oficina principal');

  const secondLocation = form.getByRole('textbox', {
    name: 'Local da obra 2',
    exact: true
  });
  await expect(secondLocation).toHaveValue('Canteiro');
  await secondLocation.click();
  await secondLocation.press('Home');
  await secondLocation.pressSequentially('Base ');
  await expect(secondLocation).toHaveValue('Base Canteiro');
  await expect(secondLocation).toBeFocused();
  await form
    .getByRole('button', { name: 'Adicionar local da obra', exact: true })
    .click();
  const thirdLocation = form.getByRole('textbox', {
    name: 'Local da obra 3',
    exact: true
  });
  await expect(thirdLocation).toBeFocused();
  await thirdLocation.pressSequentially('Navio');
  await expect(thirdLocation).toBeFocused();
  await form
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  await expect
    .poll(
      () =>
        requests.find((request) => request.path === '/api/rdo/projects/multi')
          ?.body
    )
    .toMatchObject({
      location: 'Oficina principal',
      additionalWorkLocations: ['Base Canteiro', 'Navio']
    });
});
