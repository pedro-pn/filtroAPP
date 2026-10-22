async page => {
  const fixtureUrl = page.url().split('/test/')[0] + '/test/browser/initial-team-dates.html';
  const dateForm = () => page.getByRole('dialog', { name: /^(Definir|Editar) equipe inicial$/ });
  const selector = () => page.getByRole('dialog', { name: 'Colaboradores por disponibilidade', exact: true });
  const completeDates = async () => {
    await dateForm().locator('#initial-team-executionEndDate').fill('2026-10-12');
    if (!(await dateForm().getByRole('button', { name: 'Continuar', exact: true }).isDisabled())) throw new Error('Aceitou fim anterior à mobilização.');
    await dateForm().locator('#initial-team-executionEndDate').fill('2026-11-30');
    await dateForm().getByRole('button', { name: 'Continuar', exact: true }).click();
  };
  const verifyAvailability = async expectedPeriod => {
    await selector().waitFor();
    if (await selector().getByText('Informe o período da missão', { exact: true }).count()) {
      throw new Error('Datas confirmadas foram rejeitadas por uma desmobilização histórica.');
    }
    await selector().getByText('Ana', { exact: true }).waitFor();
    await selector().getByText('Bruno', { exact: true }).waitFor();
    if (!(await selector().getByText(expectedPeriod, { exact: false }).count())) throw new Error('Disponibilidade consultou outro período.');
    const requests = await page.evaluate(() => window.initialTeamRequests);
    const absences = requests.find(request => request.url.endsWith('/absences'));
    const [expectedStart, expectedEnd] = expectedPeriod.split(' a ').map(date => date.split('/').reverse().join('-'));
    if (absences?.params.from !== expectedStart || absences?.params.to !== expectedEnd) throw new Error('Consulta de ausências usou outro período.');
    if (!requests.some(request => request.url.endsWith('/collaborators') && request.params.date === expectedStart)) throw new Error('Consulta de colaboradores usou outra mobilização.');
  };
  const applyTeam = async (expectedStart, expectedEnd, expectedReturn) => {
    await selector().getByRole('checkbox', { name: /Ana/ }).check();
    await selector().getByRole('button', { name: 'Aplicar equipe', exact: true }).click();
    const payload = JSON.parse(await page.getByTestId('initial-team-payload').textContent());
    if (payload.returnDate !== expectedReturn || payload.mobilizationDate !== expectedStart
      || payload.allocationPeriods[0].mobilizationDate !== expectedStart
      || payload.allocationPeriods[0].demobilizationDate !== expectedEnd) throw new Error('Salvamento reutilizou datas antigas.');
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixtureUrl);
  await dateForm().waitFor();
  if (await page.evaluate(() => window.initialTeamRequests.length)) throw new Error('Consultou disponibilidade antes de confirmar as datas.');
  await completeDates();
  await verifyAvailability('13/10/2026 a 30/11/2026');
  await page.screenshot({ path: 'output/playwright/initial-team-dates-desktop.png', fullPage: true });
  await applyTeam('2026-10-13', '2026-11-30', null);

  // Fechar sem salvar não deve reaproveitar o rascunho ao abrir outra vez.
  await page.getByRole('button', { name: 'Definir equipe inicial', exact: true }).click();
  await dateForm().waitFor();
  await dateForm().getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.goto(fixtureUrl + '?mode=complete');
  await verifyAvailability('13/10/2026 a 30/11/2026');
  if (await dateForm().count()) throw new Error('Pediu datas já definidas no planejamento.');
  await applyTeam('2026-10-13', '2026-11-30', null);

  await page.goto(fixtureUrl + '?mode=edit');
  await dateForm().waitFor();
  if (await dateForm().locator('#initial-team-mobilizationDate').inputValue() !== '2026-09-07') throw new Error('Edição substituiu a data oficial da missão.');
  await dateForm().getByRole('button', { name: 'Continuar', exact: true }).click();
  await verifyAvailability('07/09/2026 a 01/12/2026');
  await applyTeam('2026-09-07', '2026-12-01', '2026-12-01');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixtureUrl + '?mode=empty');
  await completeDates();
  await verifyAvailability('13/10/2026 a 30/11/2026');
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Rolagem horizontal no celular.');
  await page.screenshot({ path: 'output/playwright/initial-team-dates-mobile.png', fullPage: true });
  await applyTeam('2026-10-13', '2026-11-30', null);
  return 'PASS: projeto 5782 com saída histórica, novas datas confirmadas, datas completas do planejamento, reabertura, datas oficiais de missão existente, consulta e salvamento dos períodos e layout móvel.';
}
