async (page) => {
  // Run with: playwright-cli run-code --filename frontend/test/browser/search-race.js
  const url = page.url().split('/test/')[0] + '/test/browser/search-race.html';
  await page.addInitScript(() => {
    sessionStorage.clear();
    if (location.search === '?legacy=1') {
      sessionStorage.setItem('race-search:approved', '5800');
      const filters = JSON.stringify({ search: '5800', projectActive: true, pageSize: 25 });
      sessionStorage.setItem(`accumulated-reports:search-race-user:${encodeURIComponent(filters)}`, JSON.stringify({
        version: 1, savedAt: Date.now(), page: 1,
        items: [{ id: 'stale-9999', projectId: 'project-9999' }], groupTotals: {}, groupLoadedCounts: {}
      }));
    }
  });
  await page.goto(url);
  const search = page.getByRole('searchbox', { name: 'Buscar relatórios' });
  const state = async expected => page.waitForFunction(expected => {
    const actual = JSON.parse(document.querySelector('#state').textContent);
    return Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value));
  }, expected);
  const requestFor = async (search, projectActive = true, group = false) => {
    await page.waitForFunction(({ search, projectActive, group }) => window.searchRequests.some(request =>
      !request.done && !request.aborted && request.params.search === search
      && request.params.projectActive === String(projectActive) && Boolean(request.params.projectId) === group
    ), { search, projectActive, group });
    return page.evaluate(({ search, projectActive, group }) => window.searchRequests.findLastIndex(request =>
      !request.done && !request.aborted && request.params.search === search
      && request.params.projectActive === String(projectActive) && Boolean(request.params.projectId) === group
    ), { search, projectActive, group });
  };
  const resolve = async (index, codes) => {
    await page.evaluate(({ index, codes }) => {
      const request = window.searchRequests[index];
      request.done = true;
      request.resolve(codes);
    }, { index, codes });
    // Flush the deliberately delayed promise and React's scheduled update.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };

  await resolve(await requestFor(''), ['5800', '5837', '9999']);
  await state({ ids: ['report-5800', 'report-5837', 'report-9999'] });
  await page.getByRole('button', { name: 'Carregar grupo antigo' }).click();
  const oldGroup = await requestFor('', true, true);
  await search.pressSequentially('5800', { delay: 25 });
  await state({ ids: [], loading: true });
  const current = await requestFor('5800');
  const intermediate = await page.evaluate(() => window.searchRequests.filter(r => ['5', '58', '580'].includes(r.params.search)).length);
  if (intermediate !== 0) throw new Error('Rapid typing sent intermediate searches');
  await resolve(current, ['5800']);
  await resolve(oldGroup, ['9999']);
  await state({ ids: ['report-5800'], oldLoading: false, oldError: false });
  if (!await page.evaluate(index => window.searchRequests[index].aborted, oldGroup)) throw new Error('Old group request was not aborted');
  const snapshotClean = await page.evaluate(() => {
    const keys = Object.keys(sessionStorage)
      .filter(key => key.startsWith('accumulated-reports:') && decodeURIComponent(key).includes('"search":"5800"'));
    return keys.length > 0 && keys.every(key => JSON.parse(sessionStorage.getItem(key)).items.every(item => item.projectId === 'project-5800'));
  });
  if (!snapshotClean) throw new Error('Stale group polluted the search snapshot');

  await search.fill('58');
  const slow = await requestFor('58');
  await search.fill('5837');
  const fast = await requestFor('5837');
  await resolve(fast, ['5837']);
  await resolve(slow, ['9999']);
  await state({ ids: ['report-5837'], searching: false });
  if (!await page.evaluate(index => window.searchRequests[index].aborted, slow)) throw new Error('Old list request was not aborted');

  await page.getByRole('button', { name: 'Limpar busca' }).click();
  await state({ ids: ['report-5800', 'report-5837', 'report-9999'], searching: false });
  await search.fill('zzzz');
  await resolve(await requestFor('zzzz'), []);
  await state({ ids: [], loading: false, searching: false });
  await search.fill('5800');
  await state({ ids: ['report-5800'], searching: false });

  await page.getByRole('button', { name: 'Trocar aba' }).click();
  await resolve(await requestFor('', false), ['7000']);
  await search.fill('7000');
  await resolve(await requestFor('7000', false), ['7000']);
  await page.getByRole('button', { name: 'Trocar aba' }).click();
  await state({ ids: ['report-5800'], searching: false });
  if (await search.inputValue() !== '5800') throw new Error('Per-tab search was not restored');
  if (await page.evaluate(() => window.searchRequests.some(r => r.params.search === '7000' && r.params.projectActive === 'true')))
    throw new Error('Another tab search leaked into the request');

  await page.getByRole('button', { name: 'Carregar grupo antigo' }).click();
  const abandoned = await requestFor('5800', true, true);
  await page.getByRole('button', { name: 'Montar/desmontar' }).click();
  await resolve(abandoned, ['9999']);
  await page.getByRole('button', { name: 'Montar/desmontar' }).click();
  await state({ ids: ['report-5800'], oldError: false, oldLoading: false });
  await page.getByRole('combobox', { name: 'Colaborador' }).fill('joao pressao');
  if (await page.getByRole('option').count() !== 1) throw new Error('Combobox normalization failed');
  await page.goto(url + '?legacy=1');
  await state({ ids: [], loading: true });
  await resolve(await requestFor('5800'), ['5800']);
  await state({ ids: ['report-5800'], searching: false });
  return 'PASS: rapid typing; stale groups and lists; cancellation; clean cache; clear; empty result; tab restoration; unmount; accents/multiple terms; legacy cache invalidation.';
}
