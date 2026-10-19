async page => {
  const url = page.url().split('/test/')[0] + '/test/browser/databook-previa.html?propostas=1';
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    await page.getByText('1 serviço(s) sem proposta definida', { exact: true }).waitFor();
    await page.getByText('Revisar vínculos dos serviços (1)', { exact: true }).click();
    await page.getByRole('button', { name: 'Vincular proposta', exact: true }).click();
    await page.getByRole('group', { name: 'Vincular serviço à proposta' }).getByRole('combobox').selectOption('COMERCIAL_APP:502');
    await page.getByRole('textbox', { name: 'Motivo', exact: true }).fill('Conferência da proposta adicional');
    await page.getByRole('button', { name: 'Salvar vínculo', exact: true }).click();
    await page.getByText('Vínculo manual', { exact: false }).waitFor();
    const assignment = await page.evaluate(() => window.databookChamadas.find(c => c.url.endsWith('/escopos-propostas/r1')));
    assert(assignment.body.contributionKey === 'COMERCIAL_APP:502' && assignment.body.version === 'd'.repeat(64), 'Vínculo sem identidade/versão.');
    await page.getByRole('button', { name: 'Data Book', exact: true }).click();
    await page.getByRole('combobox', { name: 'Escopo do Data Book', exact: true }).selectOption('COMERCIAL_APP:502');
    await page.screenshot({ path: `output/playwright/databook-proposta-selecao-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByText(/DB-9001-01 · Rev. 1/).first().waitFor();
    await page.getByRole('button', { name: 'Visualizar prévia', exact: true }).click();
    await page.getByText('3 páginas · rolagem contínua', { exact: true }).waitFor();
    const preview = await page.evaluate(() => window.databookChamadas.filter(c => c.url.endsWith('/previa')).at(-1));
    assert(preview.body.contributionKey === 'COMERCIAL_APP:502', 'Prévia perdeu o adicional selecionado.');
    assert(preview.body.scopeVersion === 'b'.repeat(64), 'Prévia perdeu a versão do escopo.');
    await page.getByRole('button', { name: 'Gerar Data Book', exact: true }).click();
    await page.getByText(/Rev. 1 pronto/).waitFor();
    await page.screenshot({ path: `output/playwright/databook-proposta-${width}.png`, fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow em ${width}px`);
  }
  return { ok: true, widths: [360, 768, 1440], proposal: 'COMERCIAL_APP:502' };
}
