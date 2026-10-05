async (page) => {
  // Run with: playwright-cli run-code --filename frontend/test/browser/signature-pagination.js
  const base = page.url().split('/test/')[0] + '/test/browser/planning-signatures.html?mode=signatures&pagination=1';
  const cards = page.locator('[data-signature-document]');
  const loadMore = page.getByRole('button', { name: 'Carregar mais documentos', exact: true });
  const waitCount = count => page.waitForFunction(count => document.querySelectorAll('[data-signature-document]').length === count, count);
  const scrollEnd = () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const assertCards = async (count, prefix) => {
    await waitCount(count);
    const ids = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.signatureDocument));
    if (new Set(ids).size !== count || ids.some(id => !id.startsWith(prefix))) throw new Error(`Missing, duplicate or unrelated documents: ${ids}`);
    if (await loadMore.count()) throw new Error('Load more still visible after the final page');
  };
  const assertFilters = async status => {
    const requests = await page.evaluate(() => window.signatureListRequests);
    if (requests.some(request => request.status !== status)) throw new Error('Status was lost between pages');
    if (requests.filter(request => request.cursor).map(request => request.cursor).join(',') !== 'completed-20,completed-40') throw new Error('Did not traverse every page');
  };

  // Automatic scrolling retains the completed filter across all three pages.
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto(base + '&status=CONCLUIDO');
  await waitCount(20);
  await scrollEnd();
  await waitCount(40);
  await scrollEnd();
  await assertCards(47, 'completed-');
  await assertFilters('CONCLUIDO');

  // Changing filters gets the new results, without reusing the completed pages.
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('AGUARDANDO_ASSINATURAS');
  await assertCards(12, 'pending-');
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('CONCLUIDO');
  await assertCards(47, 'completed-');
  await page.getByRole('searchbox', { name: 'Buscar documentos' }).fill('concluído 4');
  await assertCards(9, 'completed-');

  // Every page remains reachable when IntersectionObserver is unavailable.
  await page.goto(base + '&status=CONCLUIDO&observer=off');
  await waitCount(20);
  await scrollEnd();
  await page.waitForTimeout(250);
  if (await cards.count() !== 20) throw new Error('Unexpected automatic loading with observer disabled');
  if (!await page.getByText('Há mais documentos nesta lista.', { exact: false }).count()) throw new Error('Partial list is not identified');
  await loadMore.click();
  await waitCount(40);
  await loadMore.click();
  await assertCards(47, 'completed-');
  await assertFilters('CONCLUIDO');

  // A failed next page preserves the loaded documents and can be retried.
  await page.goto(base + '&status=CONCLUIDO&pageError=once');
  await waitCount(20);
  await scrollEnd();
  const retry = page.getByRole('button', { name: 'Tentar novamente', exact: true });
  await retry.waitFor();
  if (await cards.count() !== 20) throw new Error('A page error discarded the loaded results');
  await retry.click();
  await waitCount(40);
  await scrollEnd();
  await assertCards(47, 'completed-');

  // Mobile scrolling and the archived list preserve their own complete results.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '&status=CONCLUIDO');
  await waitCount(20);
  await scrollEnd();
  await waitCount(40);
  await scrollEnd();
  await assertCards(47, 'completed-');
  await page.goto(base + '&status=CONCLUIDO&tab=archived');
  await assertCards(7, 'archived-');
  return 'PASS: all 47 completed documents; filters across cursors; status/search changes; manual fallback; page retry; mobile; archive isolation.';
}
