export function normalizeSignatureSearchParams(current: URLSearchParams) {
  const next = new URLSearchParams(current);
  const selectedId = next.get('doc') || '';
  const requestedTab = next.get('tab');
  if (selectedId) {
    if (requestedTab === 'archived') next.set('list', 'archived');
    const detailTab = requestedTab === 'setup' || requestedTab === 'audit' || requestedTab === 'details'
      ? requestedTab
      : 'details';
    next.set('tab', detailTab);
    if (detailTab !== 'setup') next.delete('page');
    else if (!Number.isInteger(Number(next.get('page'))) || Number(next.get('page')) < 1) next.set('page', '1');
  } else {
    next.delete('page');
    if (next.get('list') === 'archived') next.set('tab', 'archived');
    next.delete('list');
    if (next.get('tab') !== 'archived') next.delete('tab');
  }
  return next;
}

export function signatureDocumentSearchParams(
  current: URLSearchParams,
  documentId: string,
  initialTab: 'details' | 'setup' | 'audit' = 'details'
) {
  const next = new URLSearchParams(current);
  if (current.get('tab') === 'archived') next.set('list', 'archived');
  next.delete('page');
  next.set('doc', documentId);
  next.set('tab', initialTab);
  if (initialTab === 'setup') next.set('page', '1');
  return next;
}

export function signatureLibrarySearchParams(current: URLSearchParams) {
  const next = new URLSearchParams(current);
  next.delete('doc');
  next.delete('page');
  next.delete('tab');
  if (next.get('list') === 'archived') next.set('tab', 'archived');
  next.delete('list');
  return next;
}
