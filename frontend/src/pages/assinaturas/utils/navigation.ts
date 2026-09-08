export function normalizeSignatureSearchParams(current: URLSearchParams) {
  const next = new URLSearchParams(current);
  const selectedId = next.get('doc') || '';
  const requestedTab = next.get('tab');
  if (selectedId) {
    next.delete('q');
    next.delete('status');
    const detailTab = requestedTab === 'setup' || requestedTab === 'audit' || requestedTab === 'details'
      ? requestedTab
      : 'details';
    next.set('tab', detailTab);
    if (detailTab !== 'setup') next.delete('page');
    else if (!Number.isInteger(Number(next.get('page'))) || Number(next.get('page')) < 1) next.set('page', '1');
  } else {
    next.delete('page');
    if (requestedTab && requestedTab !== 'archived') next.delete('tab');
  }
  return next;
}

export function signatureDocumentSearchParams(
  current: URLSearchParams,
  documentId: string,
  initialTab: 'details' | 'setup' | 'audit' = 'details'
) {
  const next = new URLSearchParams(current);
  next.delete('page');
  next.set('doc', documentId);
  next.set('tab', initialTab);
  if (initialTab === 'setup') next.set('page', '1');
  next.delete('q');
  next.delete('status');
  return next;
}
