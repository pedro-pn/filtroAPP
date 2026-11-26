// Run in a Playwright CLI session opened on the local Vite origin. All API calls are simulated.
async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  const requests = [];
  let role = 'COLLABORATOR';
  const user = () => ({ id: 'standby-user', name: 'Usuário de teste', username: 'standby', role,
    accountType: 'INTERNAL', moduleRoles: [role === 'MANAGER' ? 'rdo:manager' : 'rdo:collaborator'],
    reportEmissionPermissions: ['SITE_RDO'], isActive: true });
  const project = { id: 'standby-project', code: '101', name: 'Projeto de teste', clientName: 'Cliente',
    location: 'Oficina', additionalWorkLocations: [], plannedServices: [], isActive: true,
    visibleToCollaborators: true, operatorId: 'colab-1', operator: { id: 'colab-1', name: 'Ana' },
    authorizedUsers: [], clientSigners: [], clientEmailCc: [], surveys: [], reportSequences: [],
    workdayHours: '09:00', weekendWorkdayHours: '08:00', includesSaturday: false, includesSunday: false };
  const emptyReport = { id: 'standby-report', projectId: project.id, project, reportType: 'RDO',
    status: 'PENDING', sequenceNumber: 1, reportDate: '2026-10-02', arrivalTime: '08:00',
    departureTime: '17:00', lunchBreak: '01:00:00', createdByUserId: 'standby-user',
    createdAt: '2026-10-02T12:00:00Z', updatedAt: '2026-10-02T12:00:00Z',
    collaborators: [{ collaboratorId: 'colab-1' }], services: [], specialConditions: {} };
  let savedReport = structuredClone(emptyReport);
  const resources = { projects: [project], collaborators: [{ id: 'colab-1', name: 'Ana', role: 'Técnico', isActive: true }],
    units: [], manometers: [], counters: [], equipments: [], equipment: [], rdoSlotMap: {},
    drafts: [], sequenceReports: [], inhibitionOptions: { vessels: [], systems: [] } };
  await page.addInitScript(() => {
    localStorage.setItem('filtrovali-react-token', 'standby-test-token');
    localStorage.setItem('filtrovali-tutorial-done:standby-user', '1');
    localStorage.setItem('filtrovali:rdo-dds-novelty:v2:standby-user', '1');
  });
  await page.unroute('**/api/**');
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (!path.startsWith('/api/')) return route.continue();
    const body = request.postData() ? request.postDataJSON() : {};
    if (['POST', 'PUT', 'PATCH'].includes(request.method())) requests.push({ path, body });
    let response = [];
    if (path === '/api/auth/me') response = { user: user() };
    else if (path.includes('/notifications')) response = { items: [], criticalItems: [], unreadCount: 0, nextCursor: null };
    else if (path.includes('/bootstrap/new-report') || path.includes('/bootstrap/report-detail/')) response = resources;
    else if (path.includes('/bootstrap/gestor')) response = { ...resources, activeProjects: [project], archivedProjects: [], surveys: [], projectSegments: [], surveyQuestions: [] };
    else if (path.endsWith('/planning-context') || path.endsWith('/collaborator-prefill')) response = null;
    else if (path.endsWith('/availability')) response = { conflicts: [], holidays: [] };
    else if (path.endsWith('/anotacoes/config')) response = { disponivel: false };
    else if (path === '/api/rdo/reports/counts') response = { totals: (body.queries || []).map(() => 0) };
    else if (path === '/api/rdo/reports' && request.method() === 'POST') {
      savedReport = { ...emptyReport, ...body, status: 'PENDING' };
      response = savedReport;
    } else if (path === '/api/rdo/reports') response = url.searchParams.has('pageSize')
      ? { items: [], pagination: { total: 0, page: 1, pageSize: 25, totalPages: 0 }, groups: [] } : [];
    else if (path === '/api/rdo/reports/standby-report') {
      if (request.method() === 'PUT') savedReport = { ...savedReport, ...body };
      response = savedReport;
    } else if (path.endsWith('/standby-report/status')) {
      savedReport = { ...savedReport, ...body };
      response = savedReport;
    } else if (path.includes('/drafts') && request.method() !== 'GET') response = { id: 'draft-1', ...body };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  const newForm = async () => {
    await page.goto(`${origin}/rdo/relatorio/novo?tipo=obra`);
    await page.locator('#rdo-project').selectOption(project.id);
    await page.locator('#rdo-date').fill('2026-10-02');
    await page.locator('#rdo-arrival').fill('08:00');
    await page.locator('#rdo-departure').fill('17:00');
    await page.locator('#rdo-lunch').fill('01:00:00');
    await page.getByRole('combobox', { name: 'Adicionar colaborador', exact: true }).selectOption('colab-1');
    await page.getByRole('button', { name: 'Próximo', exact: true }).click();
    await page.getByRole('dialog', { name: 'Qual serviço foi executado hoje?' }).getByRole('button', { name: 'Não houve serviço hoje', exact: true }).click();
    await page.locator('#rdo-description').waitFor();
  };
  const dialog = () => page.getByRole('dialog', { name: 'Revisar sugestão de standby', exact: true });
  const alert = () => page.locator('.standby-suggestion');
  const responsibility = name => dialog().getByRole('radio', { name: new RegExp(`^${name}`) });
  // Toda pausa exige a escolha de responsabilidade; "cliente" mantém o comportamento original (standby no RDO).
  const pickClient = () => responsibility('Por conta do cliente').check();
  const assertBreakLayout = async () => {
    const fits = await dialog().locator('.standby-break-question').evaluateAll(groups => groups.every(group => {
      const box = group.getBoundingClientRect();
      return [...group.querySelectorAll('.standby-break-question__option')].every(option => {
        const label = option.querySelector('span').getBoundingClientRect();
        const radio = option.querySelector('input').getBoundingClientRect();
        return label.left >= box.left && label.right <= box.right && radio.width <= 24 && label.width > 100;
      });
    }));
    assert(fits, 'As opções e seus textos devem caber dentro da pergunta de intervalo');
  };

  await page.setViewportSize({ width: 1365, height: 1000 });
  await newForm();
  const original = 'Equipe parada das 08:00 às 10:00 aguardando liberação.';
  await page.locator('#rdo-description').fill(original);
  await alert().waitFor();
  assert((await alert().innerText()).includes('02:00'), 'A sugestão durante a digitação deve calcular duas horas');
  await page.getByRole('button', { name: 'Enviar relatório', exact: true }).click();
  await dialog().waitFor();
  assert(requests.filter(item => item.path === '/api/rdo/reports').length === 0, 'O diálogo deve preceder o envio');
  await dialog().getByRole('button', { name: 'Voltar ao relatório', exact: true }).click();
  assert(await page.locator('#rdo-description').inputValue() === original, 'Cancelar mantém o texto original');
  await page.getByRole('button', { name: 'Enviar relatório', exact: true }).click();
  await dialog().getByRole('button', { name: 'Continuar sem aplicar', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('/relatorio/novo'));
  assert(savedReport.specialConditions.standby === false, 'Ignorar não deve preencher o standby');
  assert(savedReport.dailyDescription === original, 'O texto segue salvo para análise pelo revisor');

  role = 'MANAGER';
  await page.goto(`${origin}/rdo/gestor/relatorio/standby-report`);
  await alert().waitFor();
  await page.getByRole('button', { name: 'Revisar sugestão', exact: true }).click();
  assert(await dialog().getByLabel('Tempo total das pausas', { exact: true }).inputValue() === '02:00', 'O revisor reencontra a sugestão ignorada');
  await dialog().getByLabel('Não incluiu o intervalo', { exact: true }).check();
  await dialog().getByLabel('Motivo sugerido', { exact: true }).fill('Aguardando liberação da área pelo cliente.');
  await page.screenshot({ path: 'output/playwright/standby-review-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'O diálogo deve caber no celular');
  await page.screenshot({ path: 'output/playwright/standby-review-mobile.png' });
  await pickClient();
  await dialog().getByRole('button', { name: 'Aplicar standby', exact: true }).click();
  await alert().waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Salvar e Aprovar', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('/relatorio/standby-report'));
  assert(savedReport.specialConditions.standby === true, 'A aprovação deve salvar o standby aceito');
  assert(savedReport.specialConditions.standbyDetails.total === '02:00', 'O total aceito deve chegar ao servidor');
  assert(savedReport.specialConditions.standbyDetails.motivo === 'Aguardando liberação da área pelo cliente.', 'O motivo editado deve chegar ao servidor');
  assert(savedReport.dailyDescription === original, 'Aplicar não deve apagar a anotação original');
  assert(requests.some(item => item.path.endsWith('/status') && item.body.status === 'APPROVED'), 'O fluxo deve concluir a aprovação');

  // Fresh reviewer session: apply directly during submission, with the latest dialog values.
  savedReport = { ...structuredClone(emptyReport), dailyDescription: 'Parada por 2 horas.', services: [] };
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.goto(`${origin}/rdo/gestor/relatorio/standby-report`);
  await alert().waitFor();
  await page.getByRole('button', { name: 'Salvar e Aprovar', exact: true }).click();
  await dialog().getByLabel('Tempo total das pausas', { exact: true }).fill('01:45');
  await dialog().getByLabel('Motivo sugerido', { exact: true }).fill('Tempo conferido pelo revisor.');
  await pickClient();
  await dialog().getByRole('button', { name: 'Aplicar e continuar', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('/relatorio/standby-report'));
  assert(savedReport.specialConditions.standbyDetails.total === '01:45', 'Enviar no mesmo evento deve incluir o total ajustado');

  // Service observations alone must generate the suggestion, including legacy report data.
  savedReport = { ...structuredClone(emptyReport), services: [{ id: 'svc-1', serviceType: 'mecanica', system: 'Sistema',
    startTime: '10:00', endTime: '17:00', finalized: false,
    extraData: { equipmentId: 'EQ-1', 'Equipamento(s)': 'EQ-1', material: 'Aço', etapas: ['Preparação'], Observações: 'Parados das 08:00 às 10:00 por falta de energia.' } }] };
  await page.goto(`${origin}/rdo/gestor/relatorio/standby-report`);
  await alert().waitFor();
  await page.getByRole('button', { name: 'Revisar sugestão', exact: true }).click();
  assert((await dialog().innerText()).includes('Observações do serviço 1'), 'As observações de serviço devem ser analisadas');
  await dialog().getByRole('button', { name: 'Voltar ao relatório', exact: true }).click();
  await page.getByRole('button', { name: 'Ignorar sugestão', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByText('Relatório atualizado.', { exact: true }).waitFor();
  assert(savedReport.specialConditions.standby === false, 'Dispensar e salvar deve preservar o standby desmarcado');

  // An unclear pause never invents a duration; the user can supply the missing total.
  savedReport = { ...structuredClone(emptyReport), dailyDescription: 'Equipe parada aguardando material.' };
  await page.goto(`${origin}/rdo/gestor/relatorio/standby-report`);
  await page.getByRole('button', { name: 'Revisar sugestão', exact: true }).click();
  assert(await dialog().getByLabel('Tempo total das pausas', { exact: true }).inputValue() === '', 'Sem horários, o total deve ficar vazio');
  assert(await dialog().getByRole('button', { name: 'Aplicar standby', exact: true }).isDisabled(), 'Aplicar exige um total válido');
  await dialog().getByLabel('Tempo total das pausas', { exact: true }).fill('00:45');
  await pickClient();
  await dialog().getByRole('button', { name: 'Aplicar standby', exact: true }).click();
  await alert().waitFor({ state: 'hidden' });

  role = 'COLLABORATOR';
  await newForm();
  await page.locator('#rdo-description').fill('Parados por 2 horas.');
  await page.getByRole('button', { name: 'Enviar relatório', exact: true }).click();
  await dialog().getByLabel('Tempo total das pausas', { exact: true }).fill('01:50');
  await dialog().getByLabel('Motivo sugerido', { exact: true }).fill('Tempo conferido pelo colaborador.');
  await pickClient();
  await dialog().getByRole('button', { name: 'Aplicar e continuar', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('/relatorio/novo'));
  assert(savedReport.specialConditions.standbyDetails.total === '01:50', 'O envio inicial inclui o total aceito no diálogo');
  assert(savedReport.specialConditions.standbyDetails.motivo === 'Tempo conferido pelo colaborador.', 'O envio inicial inclui o motivo editado');

  // A clock range needs explicit meal overlap confirmation; a stated total does not.
  await newForm();
  const textWithLunch = 'A equipe ficou parada aguardando serviço entre as 10h e 13h atividade ocorreu normal depois';
  await page.locator('#rdo-description').fill(textWithLunch);
  await page.getByRole('button', { name: 'Enviar relatório', exact: true }).click();
  await dialog().waitFor();
  const total = dialog().getByLabel('Tempo total das pausas', { exact: true });
  const apply = dialog().getByRole('button', { name: 'Aplicar e continuar', exact: true });
  assert(await total.inputValue() === '03:00', 'Entre as 10h e 13h representa 3h brutas');
  assert(await apply.isDisabled(), 'Desconto exige confirmação explícita');
  await dialog().getByLabel('Sim, incluiu todo o intervalo (01:00)', { exact: true }).check();
  assert(await total.inputValue() === '02:00', '3h menos 1h de almoço deve sugerir 2h');
  await dialog().getByLabel('Não incluiu o intervalo', { exact: true }).check();
  assert(await total.inputValue() === '03:00', 'Sem sobreposição, o tempo deve permanecer 3h');
  await dialog().getByLabel('Incluiu apenas parte do intervalo', { exact: true }).check();
  assert(await apply.isDisabled(), 'Uma sobreposição parcial exige sua duração');
  await dialog().getByLabel('Tempo do intervalo dentro da paralisação', { exact: true }).fill('00:30');
  assert(await total.inputValue() === '02:30', 'Descontar apenas 30min deve sugerir 2h30');
  await dialog().getByLabel('Tempo do intervalo dentro da paralisação', { exact: true }).fill('01:30');
  assert(await apply.isDisabled(), 'O desconto não pode exceder a 1h de almoço cadastrada');
  await dialog().getByLabel('Sim, incluiu todo o intervalo (01:00)', { exact: true }).check();
  assert((await dialog().getByLabel('Motivo sugerido', { exact: true }).inputValue()).includes('Intervalo de almoço: descontado 01:00'), 'O motivo deve explicar o desconto');
  await assertBreakLayout();
  await page.screenshot({ path: 'output/playwright/standby-break-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'A confirmação de intervalo deve caber no celular');
  await assertBreakLayout();
  await page.screenshot({ path: 'output/playwright/standby-break-mobile.png' });
  await pickClient();
  await apply.click();
  await page.waitForURL(url => !url.pathname.includes('/relatorio/novo'));
  assert(savedReport.specialConditions.standbyDetails.total === '02:00', 'O servidor deve receber o tempo líquido');
  assert(savedReport.specialConditions.standbySuggestionReview.deductedBreakMinutes === 60, 'A confirmação do desconto deve ser persistida');
  assert(savedReport.dailyDescription === textWithLunch, 'O período original deve permanecer nas anotações');

  role = 'MANAGER';
  await page.goto(`${origin}/rdo/gestor/relatorio/standby-report`);
  await page.locator('#rdo-description').waitFor();
  assert(await alert().count() === 0, 'O revisor não deve receber novamente o período cujo desconto já foi aceito');

  role = 'COLLABORATOR';
  await newForm();
  await page.locator('#rdo-description').fill('A equipe ficou aguardando por 5h.');
  await page.getByRole('button', { name: 'Enviar relatório', exact: true }).click();
  await dialog().waitFor();
  assert(await dialog().locator('.standby-break-question').count() === 0, 'Um total de 5h não deve perguntar sobre desconto');
  assert(await dialog().getByLabel('Tempo total das pausas', { exact: true }).inputValue() === '05:00', 'A duração escrita deve permanecer em 5h');
  await pickClient();
  await dialog().getByRole('button', { name: 'Aplicar e continuar', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('/relatorio/novo'));
  assert(savedReport.specialConditions.standbyDetails.total === '05:00', 'As 5h explícitas não recebem desconto de almoço');

  await newForm();
  await page.locator('#rdo-description').fill('Equipe parada entre as 12h e 13h.');
  await page.getByRole('button', { name: 'Enviar relatório', exact: true }).click();
  await dialog().getByLabel('Sim, incluiu todo o intervalo (01:00)', { exact: true }).check();
  assert(await dialog().getByLabel('Tempo total das pausas', { exact: true }).inputValue() === '00:00', 'Uma pausa só de almoço deve resultar em zero standby');
  await dialog().getByRole('button', { name: 'Confirmar sem standby', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('/relatorio/novo'));
  assert(savedReport.specialConditions.standby === false, 'Se todo o período era intervalo, o standby fica desmarcado');
  role = 'MANAGER';
  await page.goto(`${origin}/rdo/gestor/relatorio/standby-report`);
  await page.locator('#rdo-description').waitFor();
  assert(await alert().count() === 0, 'A confirmação de zero standby deve ser respeitada ao reabrir');

  // Responsabilidade: falha nossa é identificada pelo texto e vai só para o registro interno.
  role = 'COLLABORATOR';
  await newForm();
  await page.locator('#rdo-description').fill('Equipe parada por 2 horas devido a falha na bomba.');
  await page.getByRole('button', { name: 'Enviar relatório', exact: true }).click();
  await dialog().waitFor();
  assert(await responsibility('Por nossa conta').isChecked(), 'Falha na bomba deve sugerir pausa por nossa conta');
  assert((await dialog().innerText()).includes('Identificado automaticamente'), 'A sugestão automática deve ser explicada');
  await page.screenshot({ path: 'output/playwright/standby-responsibility-desktop.png' });
  await dialog().getByRole('button', { name: 'Registrar pausa e continuar', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('/relatorio/novo'));
  assert(savedReport.specialConditions.standby === false, 'Pausa por nossa conta não vira standby do RDO');
  assert(savedReport.specialConditions.internalStandby === true, 'Pausa por nossa conta é registrada internamente');
  assert(savedReport.specialConditions.internalStandbyDetails.total === '02:00', 'O tempo interno chega ao servidor');

  // Sem pista no texto, o colaborador precisa escolher; "parte de cada" divide o total.
  await newForm();
  await page.locator('#rdo-description').fill('Parados por 3 horas.');
  await page.getByRole('button', { name: 'Enviar relatório', exact: true }).click();
  await dialog().waitFor();
  await dialog().getByLabel('Motivo sugerido', { exact: true }).fill('PT atrasou e depois a bomba falhou.');
  const applySplit = dialog().getByRole('button', { name: 'Aplicar e continuar', exact: true });
  assert(await applySplit.isDisabled(), 'Sem causa identificada, a responsabilidade é obrigatória');
  await responsibility('Parte de cada').check();
  assert(await applySplit.isDisabled(), 'Parte de cada exige o tempo por nossa conta');
  await dialog().getByLabel('Tempo por nossa conta', { exact: true }).fill('03:00');
  assert(await applySplit.isDisabled(), 'O tempo por nossa conta deve ser menor que o total');
  await dialog().getByLabel('Tempo por nossa conta', { exact: true }).fill('01:00');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'A pergunta de responsabilidade deve caber no celular');
  await page.screenshot({ path: 'output/playwright/standby-responsibility-mobile.png' });
  await page.setViewportSize({ width: 1365, height: 1000 });
  await applySplit.click();
  await page.waitForURL(url => !url.pathname.includes('/relatorio/novo'));
  assert(savedReport.specialConditions.standbyDetails.total === '02:00', 'O restante entra como standby do cliente');
  assert(savedReport.specialConditions.internalStandbyDetails.total === '01:00', 'A parte nossa fica no registro interno');
  return { passed: true, scenarios: ['live suggestion', 'cancel', 'skip and reviewer rediscovery', 'edit and approve',
    'apply on approval', 'legacy service notes', 'dismiss and save', 'unclear duration', 'mobile', 'apply on initial submission',
    'entre as 10h e 13h', 'full lunch overlap', 'no lunch overlap', 'partial lunch overlap', 'invalid overlap',
    'net total and receipt persist', 'explicit 5h unchanged', 'only meal and zero standby', 'review respects accepted discount', 'internal pause detected', 'split responsibility'] };
}
