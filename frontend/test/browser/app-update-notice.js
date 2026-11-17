async page => {
  const origin = page.url().startsWith('http') ? new URL(page.url()).origin : 'http://127.0.0.1:4187';
  const url = `${origin}/login?origem=atualizacao#formulario`;
  const { version } = await (await page.request.get(`${origin}/app-version.json`)).json();
  if (!version) throw new Error('Execute contra o build de produção usando npm run preview.');
  let published = false, navigations = 0;
  const errors = [];
  const trackError = error => errors.push(error.message);
  const trackNavigation = request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++;
  };
  const api = route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  const metadata = route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ version: published ? `${version}-new` : version })
  });
  page.on('pageerror', trackError);
  page.on('request', trackNavigation);
  await page.route('**/api/**', api);
  await page.route('**/app-version.json', metadata);
  await page.clock.install();
  try {
    await page.goto(url);
    const username = page.getByRole('textbox', { name: 'Usuário', exact: true });
    await username.fill('rascunho-preservado');
    const notice = page.getByRole('complementary', { name: 'Atualização do aplicativo' });
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/app-version.json')),
      page.clock.fastForward(10_000)
    ]);
    if (await notice.count()) throw new Error('Aviso apareceu sem nova publicação.');
    published = true;
    await page.clock.fastForward(60_000);
    await notice.getByRole('heading', { name: 'Nova versão disponível', exact: true }).waitFor();
    await notice.getByText('Salve suas alterações antes de atualizar.', { exact: true }).waitFor();
    if (!(await username.evaluate(input => document.activeElement === input))) throw new Error('O aviso roubou o foco do formulário.');

    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
      const logo = notice.locator('img.fv-app-update__logo');
      await logo.evaluate(async image => { await image.decode(); if (!image.naturalWidth) throw new Error('Logo não carregou.'); });
      const filter = await logo.evaluate(image => getComputedStyle(image).filter);
      if ((theme === 'dark' && !filter.includes('invert(1)')) || (theme === 'light' && filter !== 'none')) {
        throw new Error(`Logo não acompanhou o tema ${theme}.`);
      }
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const bounds = await notice.boundingBox();
        if (!bounds || bounds.x < 0 || bounds.x + bounds.width > width || bounds.width > 312) {
          throw new Error(`Card fora da tela em ${width}px.`);
        }
      }
      await notice.screenshot({ path: `output/playwright/app-update-card-production-${theme}.png` });
    }

    await notice.getByRole('button', { name: 'Mais tarde', exact: true }).focus();
    await page.keyboard.press('Enter');
    const deferred = notice.getByRole('button', { name: 'Ver aviso de nova versão' });
    await deferred.waitFor();
    if (!(await deferred.evaluate(button => document.activeElement === button))) throw new Error('Minimizar perdeu o foco.');
    if (await notice.getByRole('button', { name: 'Atualizar', exact: true }).count()) throw new Error('O card não foi recolhido.');
    await deferred.locator('img').evaluate(async image => { await image.decode(); });
    await page.setViewportSize({ width: 320, height: 700 });
    const deferredBounds = await notice.boundingBox();
    if (!deferredBounds || deferredBounds.x + deferredBounds.width > 320) throw new Error('Aviso reduzido fora da tela.');
    await page.keyboard.press('Enter');
    const update = notice.getByRole('button', { name: 'Atualizar', exact: true });
    await update.waitFor();
    if (!(await update.evaluate(button => document.activeElement === button))) throw new Error('Reabrir perdeu o foco.');
    if (await username.inputValue() !== 'rascunho-preservado' || navigations !== 1) throw new Error('Adiar alterou ou recarregou o formulário.');
    await page.emulateMedia({ media: 'print' });
    if (await notice.isVisible()) throw new Error('Aviso apareceu na impressão.');
    await page.emulateMedia({ media: 'screen' });
    published = false;
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), update.click()]);
    await username.waitFor();
    if (page.url() !== url || navigations !== 2) throw new Error('Atualizar não recarregou a URL atual.');
    await page.clock.fastForward(10_000);
    if (await notice.count()) throw new Error('Aviso permaneceu na versão atual.');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('Atualização: temas, logo, 320–1440 px, adiar/reabrir por teclado, foco, rascunho, impressão e recarga aprovados.');
  } finally {
    await page.unroute('**/api/**', api);
    await page.unroute('**/app-version.json', metadata);
    page.off('pageerror', trackError);
    page.off('request', trackNavigation);
  }
}
