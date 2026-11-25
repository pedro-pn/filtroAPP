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
  inhibitionServiceEnabled: true,
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
    'Equipamento(s)': 'EQ-1',
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

async function mockApp(page: Page, savedReport = report, historyReports: unknown[] = []) {
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
      inhibitionOptions: {
        vessels: [{ id: 'vessel-1', code: 'EQ-1' }],
        systems: [{ id: 'system-1', code: 'S1', description: 'Sistema', diagram: 'D1' }]
      },
      drafts: []
    };
    let response: unknown = [];
    if (path === '/api/auth/me') response = { user };
    else if (path === '/api/notifications')
      response = { items: [], criticalItems: [], unreadCount: 0, nextCursor: null, snapshotAt: '2026-10-02T12:00:00Z' };
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
            : historyReports;
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

test('data no futuro ou de outro ano mostra aviso, mas não bloqueia o avanço do RDO', async ({ page }) => {
  await mockApp(page);
  await page.goto('/rdo/relatorio/novo?tipo=obra');
  await fillHeader(page);
  await page.locator('#rdo-date').fill('2062-06-29');
  const warning = page.getByText(/Atenção: a data está no futuro \(29\/06\/2062\)/);
  await expect(warning).toBeVisible();
  await expect(page.locator('#rdo-date')).toHaveAttribute('aria-describedby', /rdo-date-date-warning/);
  await page.locator('#rdo-work-location').selectOption('Oficina');
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Qual serviço foi executado hoje?' })).toBeVisible();
});

for (const [type, label] of [
  ['limpeza', 'Limpeza química'],
  ['pressao', 'Teste de pressão'],
  ['filtragem', 'Filtragem'],
  ['flushing', 'Flushing'],
  ['mecanica', 'Limpeza mecânica'],
  ['inibicao', 'Inibição']
]) {
  test(`${label}: novo RDO exige equipamento e sistema`, async ({ page }) => {
    const requests = await mockApp(page);
    await page.goto('/rdo/relatorio/novo?tipo=obra');
    await fillHeader(page);
    await page.locator('#rdo-work-location').selectOption('Oficina');
    await page.getByRole('button', { name: 'Próximo', exact: true }).click();
    await page.getByRole('dialog', { name: 'Qual serviço foi executado hoje?' }).getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('combobox', { name: /^Escopo/ }).selectOption('"UG 1"');
    const equipment = page.locator(type === 'inibicao' ? 'select[id$="-equipmentId"]' : 'input[id^="service-equipment-"]');
    const system = page.locator(type === 'inibicao' ? 'select[id$="-system"]' : 'input[id^="service-system-"]');
    await expect(equipment).toHaveAttribute('required', '');
    await expect(system).toHaveAttribute('required', '');
    await page.getByRole('button', { name: 'Próximo', exact: true }).click();
    await expect(equipment).toHaveAttribute('aria-invalid', 'true');
    if (type === 'inibicao') await equipment.selectOption('EQ-1');
    else await equipment.fill('EQ-1');
    await page.getByRole('button', { name: 'Próximo', exact: true }).click();
    await expect(system).toHaveAttribute('aria-invalid', 'true');
    expect(requests.filter(request => request.path === '/api/rdo/reports')).toHaveLength(0);
  });

  test(`${label}: edição bloqueia equipamento e sistema vazios e salva após preencher`, async ({ page }) => {
    const systemValue = type === 'inibicao' ? 'S1;Sistema;D1' : 'Sistema';
    const savedReport = { ...report, services: [{ ...services[0], serviceType: type, system: systemValue,
      extraData: { ...services[0].extraData, material: 'Inox', limpezaTubulacao: 'Sim', flushingTubulacao: 'Sim' } }] };
    const requests = await mockApp(page, savedReport);
    await page.goto('/rdo/gestor/relatorio/report-1');
    const equipment = page.locator(type === 'inibicao' ? '#svc-service-0-equipmentId' : '#service-equipment-service-0');
    const system = page.locator(type === 'inibicao' ? '#svc-service-0-system' : '#service-system-service-0');
    await expect(equipment).toHaveValue('EQ-1');
    await expect(system).toHaveValue(systemValue);
    await expect(equipment).toHaveAttribute('required', '');
    await expect(system).toHaveAttribute('required', '');
    if (type === 'inibicao') await equipment.selectOption('');
    else await equipment.fill('   ');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(equipment).toHaveAttribute('aria-invalid', 'true');
    await expect(equipment).toBeFocused();
    expect(requests.filter(request => request.path === '/api/rdo/reports/report-1')).toHaveLength(0);
    if (type === 'inibicao') {
      await equipment.selectOption('EQ-1');
      await system.selectOption('');
    } else {
      await equipment.fill('EQ-1');
      await system.fill('   ');
    }
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(system).toHaveAttribute('aria-invalid', 'true');
    await expect(system).toBeFocused();
    expect(requests.filter(request => request.path === '/api/rdo/reports/report-1')).toHaveLength(0);
    if (type === 'inibicao') await system.selectOption(systemValue);
    else await system.fill(systemValue);
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect.poll(() => requests.find(request => request.path === '/api/rdo/reports/report-1')?.body)
      .toMatchObject({ services: [{ system: systemValue, extraData: { equipmentId: 'EQ-1' } }] });
  });
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
  await page
    .getByRole('dialog', { name: 'Qual serviço foi executado hoje?' })
    .getByRole('button', { name: 'Limpeza química', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Adicionar serviço', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Tipo de serviço' })
    .getByRole('button', { name: 'Limpeza mecânica', exact: true })
    .click();
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
  await page
    .getByRole('dialog', { name: 'Qual serviço foi executado hoje?' })
    .getByRole('button', { name: 'Não houve serviço hoje', exact: true })
    .click();
  await expect(page.getByText('Etapa 3 de 3 · Finalização')).toBeVisible();
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

test('etapa Serviços abre o seletor sozinha e confirma antes de seguir sem serviço', async ({ page }) => {
  await mockApp(page);
  await page.goto('/rdo/relatorio/novo?tipo=obra');
  await fillHeader(page);
  await page.locator('#rdo-work-location').selectOption('Canteiro');
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'Qual serviço foi executado hoje?' });
  await expect(prompt).toContainText('Escrever apenas em "Atividades do dia" não substitui o registro do serviço.');
  // O modal transfere o foco no próximo frame; só então o Escape deve ser enviado.
  await expect(prompt.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveCount(0);

  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Seguir sem registrar serviço?' });
  await confirmation.getByRole('button', { name: 'Adicionar serviço', exact: true }).click();
  const typePicker = page.getByRole('dialog', { name: 'Tipo de serviço' });
  await expect(typePicker).toBeVisible();
  await expect(typePicker.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(typePicker).toHaveCount(0);

  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Seguir sem serviço', exact: true }).click();
  await expect(page.getByText('Nenhum serviço registrado neste RDO')).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar serviço', exact: true }).click();
  await page.getByRole('dialog', { name: 'Tipo de serviço' }).getByRole('button', { name: 'Flushing', exact: true }).click();
  await expect(page.locator('[data-service-id]')).toHaveCount(1);
});

test('standby no período inteiro não pede serviço; standby parcial continua pedindo', async ({ page }) => {
  await mockApp(page);
  await page.goto('/rdo/relatorio/novo?tipo=obra');
  await fillHeader(page);
  await page.locator('#rdo-work-location').selectOption('Canteiro');
  await page.getByText('Houve standby?', { exact: true }).click();
  // Jornada 08:00–17:00 com 1h de almoço = 8h trabalhadas.
  await page.locator('#rdo-standby-duration-control').fill('08:00');
  await page.locator('#rdo-standby-reason-control').fill('Aguardando liberação da área');
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Adicionar serviço', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Etapa 3 de 3 · Finalização')).toBeVisible();
  await expect(page.getByText('Nenhum serviço registrado neste RDO')).toHaveCount(0);

  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await page.locator('#rdo-standby-duration-control').fill('04:00');
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Seguir sem registrar serviço?' })).toBeVisible();
});

test('etapa Serviços oferece continuar os serviços em andamento ou iniciar outro', async ({ page }) => {
  const previous = { ...report, id: 'report-0', reportDate: '2026-10-01', sequenceNumber: 7,
    createdAt: '2026-10-01T12:00:00Z', status: 'APPROVED',
    services: [services[0], { ...services[1], id: 'service-flushing', serviceType: 'flushing',
      extraData: { ...services[1].extraData, equipmentId: 'EQ-2', 'Equipamento(s)': 'EQ-2' } }] };
  await mockApp(page, report, [previous]);
  await page.goto('/rdo/relatorio/novo?tipo=obra');
  await fillHeader(page);
  await page.locator('#rdo-work-location').selectOption('Canteiro');
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'Serviços em andamento' });
  await expect(prompt).toContainText('Este projeto tem 2 serviços que ainda não foram finalizados.');
  const items = prompt.getByRole('checkbox');
  await expect(items).toHaveCount(2);
  // Nenhum serviço vem marcado: continuar exige escolha explícita.
  await expect(items.nth(0)).not.toBeChecked();
  await expect(items.nth(1)).not.toBeChecked();
  const continueButton = prompt.getByRole('button', { name: 'Continuar serviço', exact: true });
  await expect(continueButton).toBeDisabled();
  await items.nth(0).check();
  await prompt.getByRole('button', { name: 'Iniciar outro serviço', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Qual serviço foi executado hoje?' });
  await picker.getByRole('button', { name: 'Voltar aos serviços em andamento', exact: true }).click();
  await expect(prompt.getByRole('checkbox').nth(0)).toBeChecked();
  await expect(prompt.getByRole('checkbox').nth(1)).not.toBeChecked();
  await continueButton.click();
  await expect(prompt).toHaveCount(0);
  await expect(page.locator('[data-service-id]')).toHaveCount(1);
  // O outro serviço segue disponível no cartão de continuidade da própria etapa.
  await expect(page.locator('.continuity-card .ongoing-item-react')).toHaveCount(1);
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
  const dialog = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
  const form = dialog.locator('#project-create-form');
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
  await dialog
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
  const dialog = page.getByRole('dialog', { name: 'Editar projeto', exact: true });
  const form = dialog.locator('#project-edit-form');
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
  await dialog
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
