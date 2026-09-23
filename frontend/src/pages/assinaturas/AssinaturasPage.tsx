import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button, EmptyState, IconButton, Skeleton } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import { useToast } from '../../components/ui/ToastContext';
import { useAuth } from '../../auth/AuthContext';
import { useAssinaturaMutations, useSignatureDocument, useSignatureDocuments } from '../../hooks/useAssinaturas';
import { DocumentLibrary } from './components/DocumentLibrary';
import { AssinaturasAppShell } from './AssinaturasAppShell';
import { DocumentDetailView } from './components/DocumentDetailView';
import { NewDocumentModal } from './components/NewDocumentModal';
import { AssinaturasTutorial } from './AssinaturasTutorial';
import { normalizeSignatureSearchParams, signatureDocumentSearchParams } from './utils/navigation';
import './AssinaturasPage.ds.css';

export function AssinaturasPage() {
  const showToast = useToast();
  const { user } = useAuth();
  const tutorialTrigger = useRef<(() => void) | null>(null);
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const selectedId = params.get('doc') || '';
  const query = params.get('q') || '';
  const status = params.get('status') || '';
  const requestedTab = params.get('tab');
  const detailTab = requestedTab === 'setup' || requestedTab === 'audit' ? requestedTab : 'details';
  const archived = !selectedId && requestedTab === 'archived';
  const parsedPage = Number(params.get('page'));
  const detailPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const listQuery = useSignatureDocuments({ q: query || undefined, status: status || undefined, arquivados: archived ? 1 : undefined });
  const documentQuery = useSignatureDocument(selectedId);
  const mutations = useAssinaturaMutations();

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
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    if (name !== 'doc') next.delete('page');
    setParams(next, { replace: true });
  }

  function openDocument(id: string, initialTab: 'details' | 'setup' | 'audit' = 'details') {
    setParams(signatureDocumentSearchParams(params, id, initialTab));
  }

  function closeDocument() {
    const next = new URLSearchParams(params);
    next.delete('doc');
    next.delete('tab');
    next.delete('page');
    setParams(next);
  }

  function setDetailTab(tab: 'details' | 'setup' | 'audit') {
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    if (tab !== 'setup') next.delete('page');
    else if (!next.has('page')) next.set('page', '1');
    setParams(next, { replace: true });
  }

  async function create(payload: { fileName: string; pdfDataUrl: string; title?: string }) {
    try {
      const document = await mutations.create.mutateAsync(payload);
      setNewOpen(false);
      openDocument(document.id, 'setup');
      showToast('Documento criado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível enviar o PDF.', 'error');
    }
  }

  return (
    <AssinaturasAppShell
      archived={archived || Boolean(selectedId && documentQuery.data?.isArchived)}
      documentTitle={selectedId ? documentQuery.data?.title || 'Documento' : undefined}
      actions={<>
        <IconButton className="assinaturas-tutorial-mobile" icon={DS_ICONS.alertInfo} label="Ver tutorial de Assinaturas" onClick={() => tutorialTrigger.current?.()} />
        <Button className="assinaturas-tutorial-desktop" variant="ghost" size="sm" onClick={() => tutorialTrigger.current?.()}>Ver tutorial</Button>
      </>}
    >
      <main className="assinaturas-page-v2">
        {selectedId ? (
          documentQuery.isLoading ? <div className="fv-ds"><Skeleton variant="card" label="Carregando documento..." /></div>
            : documentQuery.isError || !documentQuery.data ? <div className="fv-ds"><EmptyState variant="error" title="Não foi possível carregar o documento." action={{ label: 'Tentar novamente', onClick: () => void documentQuery.refetch() }} /></div>
              : <DocumentDetailView
                document={documentQuery.data}
                tab={detailTab}
                pageNumber={detailPage}
                onTabChange={setDetailTab}
                onBack={closeDocument}
              />
        ) : (
          <DocumentLibrary
            data={listQuery.data}
            loading={listQuery.isLoading}
            error={listQuery.isError}
            archived={archived}
            query={query}
            status={status}
            onQueryChange={value => setParam('q', value)}
            onStatusChange={value => setParam('status', value)}
            onArchiveChange={value => setParam('tab', value ? 'archived' : '')}
            onClearFilters={() => {
              const next = new URLSearchParams(params);
              next.delete('q'); next.delete('status'); next.delete('page');
              setParams(next, { replace: true });
            }}
            onRetry={() => void listQuery.refetch()}
            onNew={() => setNewOpen(true)}
            onOpen={document => openDocument(document.id, document.status === 'RASCUNHO' ? 'setup' : 'details')}
          />
        )}
        <NewDocumentModal open={newOpen} submitting={mutations.create.isPending} onClose={() => setNewOpen(false)} onSubmit={create} />
        <AssinaturasTutorial userKey={user?.id || ''} ready={Boolean(user) && !listQuery.isLoading} triggerRef={tutorialTrigger} />
      </main>
    </AssinaturasAppShell>
  );
}
