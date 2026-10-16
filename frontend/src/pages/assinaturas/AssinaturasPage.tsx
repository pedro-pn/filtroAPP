import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button, EmptyState, IconButton, Skeleton } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import { useToast } from '../../components/ui/ToastContext';
import { useAuth } from '../../auth/AuthContext';
import { createSignatureBatch, type SignatureDocument } from '../../api/assinaturas';
import { useAssinaturaMutations, useSignatureDocument, useSignatureDocuments } from '../../hooks/useAssinaturas';
import { hasUnseenSignatures, useSignatureUpdates } from '../../hooks/useSignatureUpdates';
import { DocumentLibrary } from './components/DocumentLibrary';
import { AssinaturasAppShell } from './AssinaturasAppShell';
import { DocumentDetailView } from './components/DocumentDetailView';
import { NewDocumentModal } from './components/NewDocumentModal';
import { BatchSetupView } from './components/BatchSetupView';
import { AssinaturasTutorial } from './AssinaturasTutorial';
import { AssinaturasBatchNovelty } from './AssinaturasBatchNovelty';
import { normalizeSignatureSearchParams, signatureBatchSearchParams, signatureDocumentSearchParams, signatureLibrarySearchParams } from './utils/navigation';
import './AssinaturasPage.ds.css';

// O histórico já recebe a alteração antes de o React concluir a navegação.
// Ler a URL aqui evita perder um filtro ao alterar outro logo em seguida.
function currentSearchParams() {
  return new URLSearchParams(window.location.search);
}

export function AssinaturasPage() {
  const showToast = useToast();
  const { user } = useAuth();
  const tutorialTrigger = useRef<(() => void) | null>(null);
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const uploadedFiles = useRef(new Map<File, SignatureDocument>());
  const uploadingBatchId = useRef('');
  const selectedBatchId = params.get('lote') || '';
  const selectedId = params.get('doc') || '';
  const query = params.get('q') || '';
  const status = params.get('status') || '';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const { viewed, markViewed } = useSignatureUpdates(user?.id || '');
  const requestedTab = params.get('tab');
  const detailTab = requestedTab === 'setup' || requestedTab === 'audit' ? requestedTab : 'details';
  const archived = !selectedId && requestedTab === 'archived';
  const parsedPage = Number(params.get('page'));
  const detailPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const listQuery = useSignatureDocuments({ grouped: 1, q: query || undefined, status: status || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, arquivados: archived || params.get('list') === 'archived' ? 1 : undefined });
  const listData = listQuery.data ? {
    items: listQuery.data.pages.flatMap(page => page.items),
    nextCursor: listQuery.data.pages.at(-1)?.nextCursor || null
  } : undefined;
  const documentQuery = useSignatureDocument(selectedId);
  const mutations = useAssinaturaMutations();

  useEffect(() => {
    if (selectedId && documentQuery.data) markViewed(selectedId, documentQuery.data.progress.signed);
  }, [selectedId, documentQuery.data, markViewed]);

  useEffect(() => {
    const next = normalizeSignatureSearchParams(params);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [params, requestedTab, selectedId, setParams]);

  useEffect(() => {
    if (!selectedId || !documentQuery.data) return;
    const next = new URLSearchParams(params);
    const isDraft = documentQuery.data.status === 'RASCUNHO';
    if (isDraft && detailTab === 'details') {
      next.set('tab', 'setup');
      next.set('page', '1');
    } else if (!isDraft && detailTab === 'setup') {
      next.set('tab', 'details');
      next.delete('page');
    } else {
      return;
    }
    setParams(next, { replace: true });
  }, [detailTab, documentQuery.data, params, selectedId, setParams]);

  function setParam(name: string, value: string) {
    const next = currentSearchParams();
    if (value) next.set(name, value); else next.delete(name);
    if (name !== 'doc') next.delete('page');
    setParams(next, { replace: true });
  }

  function setDateFilter(name: 'dateFrom' | 'dateTo', value: string) {
    const next = currentSearchParams();
    if (value) next.set(name, value); else next.delete(name);
    const other = name === 'dateFrom' ? 'dateTo' : 'dateFrom';
    const otherValue = next.get(other);
    if (value && otherValue && (name === 'dateFrom' ? value > otherValue : value < otherValue)) next.set(other, value);
    next.delete('page');
    setParams(next, { replace: true });
  }

  function openDocument(id: string, initialTab: 'details' | 'setup' | 'audit' = 'details') {
    setParams(signatureDocumentSearchParams(currentSearchParams(), id, initialTab));
  }

  function openBatch(id: string) {
    setParams(signatureBatchSearchParams(currentSearchParams(), id));
  }

  function closeDocument() {
    setParams(signatureLibrarySearchParams(currentSearchParams()));
  }

  function setDetailTab(tab: 'details' | 'setup' | 'audit') {
    const next = currentSearchParams();
    next.set('tab', tab);
    if (tab !== 'setup') next.delete('page');
    else if (!next.has('page')) next.set('page', '1');
    setParams(next, { replace: true });
  }

  function setDetailPage(page: number) {
    const next = currentSearchParams();
    next.set('page', String(Math.max(1, page)));
    next.set('tab', 'setup');
    setParams(next, { replace: true });
  }

  async function create(files: File[], title: string | undefined, onProgress: (message: string) => void) {
    if (files.length > 1 && !uploadingBatchId.current) uploadingBatchId.current = (await createSignatureBatch()).id;
    for (const [index, file] of files.entries()) {
      if (uploadedFiles.current.has(file)) continue;
      onProgress(`Enviando ${index + 1} de ${files.length}: ${file.name}`);
      try {
        const document = await mutations.create.mutateAsync({ file, title, batchId: uploadingBatchId.current || undefined });
        uploadedFiles.current.set(file, document);
      } catch (error) {
        throw new Error(`${file.name}: ${error instanceof Error ? error.message : 'Não foi possível enviar o PDF.'} Tente novamente para continuar o envio.`, { cause: error });
      }
    }
    setNewOpen(false);
    if (uploadingBatchId.current) {
      const next = signatureLibrarySearchParams(currentSearchParams());
      if (next.get('tab') === 'archived') { next.set('list', 'archived'); next.delete('tab'); }
      next.set('lote', uploadingBatchId.current);
      setParams(next);
      showToast(`${files.length} documentos carregados.`, 'success');
    } else {
      const document = uploadedFiles.current.get(files[0])!;
      openDocument(document.id, 'setup');
      showToast('Documento criado.', 'success');
    }
  }

  return (
    <AssinaturasAppShell
      archived={archived || params.get('list') === 'archived' || Boolean(selectedId && documentQuery.data?.isArchived)}
      documentTitle={selectedBatchId ? 'Lote de assinaturas' : selectedId ? documentQuery.data?.title || 'Documento' : undefined}
      actions={<>
        <IconButton className="assinaturas-tutorial-mobile" icon={DS_ICONS.alertInfo} label="Ver tutorial de Assinaturas" onClick={() => tutorialTrigger.current?.()} />
        <Button className="assinaturas-tutorial-desktop" variant="ghost" size="sm" onClick={() => tutorialTrigger.current?.()}>Ver tutorial</Button>
      </>}
    >
      <main className="assinaturas-page-v2">
        {selectedBatchId ? <BatchSetupView key={selectedBatchId} batchId={selectedBatchId} onViewed={markViewed} onBack={closeDocument} onOpenDocument={id => openDocument(id)} /> : selectedId ? (
          documentQuery.isLoading ? <div className="fv-ds"><Skeleton variant="card" label="Carregando documento..." /></div>
            : documentQuery.isError || !documentQuery.data ? <div className="fv-ds"><EmptyState variant="error" title="Não foi possível carregar o documento." action={{ label: 'Tentar novamente', onClick: () => void documentQuery.refetch() }} /></div>
              : documentQuery.data.batchId && documentQuery.data.status === 'RASCUNHO' && detailTab === 'setup'
                ? <BatchSetupView key={documentQuery.data.batchId} batchId={documentQuery.data.batchId} onBack={closeDocument} onOpenDocument={id => openDocument(id)} />
                : <DocumentDetailView
                document={documentQuery.data}
                tab={detailTab}
                pageNumber={detailPage}
                onTabChange={setDetailTab}
                onPageChange={setDetailPage}
                onBack={() => documentQuery.data.batchId ? openBatch(documentQuery.data.batchId) : closeDocument()}
                onOpenBatch={() => documentQuery.data.batchId && openBatch(documentQuery.data.batchId)}
              />
        ) : (
          <DocumentLibrary
            data={listData}
            loading={listQuery.isLoading}
            error={listQuery.isLoadingError}
            loadingMore={listQuery.isFetchingNextPage}
            loadMoreError={listQuery.isFetchNextPageError}
            archived={archived}
            query={query}
            status={status}
            dateFrom={dateFrom}
            dateTo={dateTo}
            newSignatures={listData?.items.filter(document => !document.isArchived && document.status !== 'CANCELADO' && hasUnseenSignatures(document, viewed)) || []}
            onQueryChange={value => setParam('q', value)}
            onStatusChange={value => setParam('status', value)}
            onDateFromChange={value => setDateFilter('dateFrom', value)}
            onDateToChange={value => setDateFilter('dateTo', value)}
            onArchiveChange={value => setParam('tab', value ? 'archived' : '')}
            onClearFilters={() => {
              const next = currentSearchParams();
              next.delete('q'); next.delete('status'); next.delete('dateFrom'); next.delete('dateTo'); next.delete('page');
              setParams(next, { replace: true });
            }}
            onRetry={() => void listQuery.refetch()}
            onLoadMore={() => void listQuery.fetchNextPage()}
            onNew={() => { uploadedFiles.current.clear(); uploadingBatchId.current = ''; setNewOpen(true); }}
            onOpen={document => {
              markViewed(document.id, document.signedCount);
              if (document.batchId) openBatch(document.batchId);
              else openDocument(document.id, document.status === 'RASCUNHO' ? 'setup' : 'details');
            }}
          />
        )}
        <NewDocumentModal open={newOpen} submitting={mutations.create.isPending} onClose={() => setNewOpen(false)} onSubmit={create} />
        <AssinaturasTutorial userKey={user?.id || ''} ready={Boolean(user) && !listQuery.isLoading} triggerRef={tutorialTrigger} />
        <AssinaturasBatchNovelty userId={user?.id || ''}
          enabled={!listQuery.isLoading && !listQuery.isLoadingError && !selectedId && !selectedBatchId && !newOpen} />
      </main>
    </AssinaturasAppShell>
  );
}
