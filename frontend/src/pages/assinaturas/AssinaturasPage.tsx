import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button } from '../../components/ui/Button';
import { SearchBar } from '../../components/ui/SearchBar';
import { useToast } from '../../components/ui/ToastContext';
import { useAuth } from '../../auth/AuthContext';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useAssinaturaMutations, useSignatureDocument, useSignatureDocuments } from '../../hooks/useAssinaturas';
import { DocumentCard } from './components/DocumentCard';
import { DocumentDetailView } from './components/DocumentDetailView';
import { NewDocumentModal } from './components/NewDocumentModal';
import { AssinaturasTutorial } from './AssinaturasTutorial';
import { normalizeSignatureSearchParams, signatureDocumentSearchParams } from './utils/navigation';

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

  function setDetailPage(page: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(Math.max(1, page)));
    next.set('tab', 'setup');
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
    <Shell>
      <TopBar
        title="Assinaturas"
        subtitle="Envio de PDFs e coleta de assinaturas"
        actions={<button className="topbar-chip" type="button" onClick={() => tutorialTrigger.current?.()}>Ver tutorial</button>}
      />
      <main className="page-scroll equip-page assinaturas-page">
        {selectedId ? (
          documentQuery.isLoading ? <div className="signature-page-state">Carregando documento...</div>
            : documentQuery.isError || !documentQuery.data ? <div className="signature-page-state">Não foi possível carregar o documento. <Button onClick={() => documentQuery.refetch()}>Tentar novamente</Button></div>
              : <DocumentDetailView
                document={documentQuery.data}
                tab={detailTab}
                pageNumber={detailPage}
                onTabChange={setDetailTab}
                onPageChange={setDetailPage}
                onBack={closeDocument}
              />
        ) : (
          <section className="signature-list-section">
            <div className="signature-list-heading">
              <div><h1>Documentos</h1><p>Prepare e acompanhe assinaturas avulsas.</p></div>
              <span data-signature-new-document><Button onClick={() => setNewOpen(true)}>Novo documento</Button></span>
            </div>
            <div className="signature-list-filters">
              <SearchBar value={query} onChange={value => setParam('q', value)} placeholder="Buscar por título ou arquivo" />
              <div className="field-group">
                <label htmlFor="signature-status-filter">Status</label>
                <select id="signature-status-filter" value={status} onChange={event => setParam('status', event.target.value)}>
                  <option value="">Todos</option><option value="RASCUNHO">Rascunho</option><option value="AGUARDANDO_ASSINATURAS">Aguardando</option><option value="FINALIZANDO">Finalizando</option><option value="CONCLUIDO">Concluído</option><option value="CANCELADO">Cancelado</option>
                </select>
              </div>
            </div>
            <div className="signature-tabs signature-list-tabs">
              <button type="button" className={!archived ? 'active' : ''} onClick={() => setParam('tab', '')}>Ativos</button>
              <button type="button" className={archived ? 'active' : ''} onClick={() => setParam('tab', 'archived')}>Arquivados</button>
            </div>
            {listQuery.isLoading ? <div className="signature-document-list" aria-busy="true">{Array.from({ length: 3 }).map((_, index) => <div className="signature-document-card skeleton" key={index} />)}</div> : null}
            {listQuery.isError ? <div className="signature-page-state">Não foi possível carregar os documentos. <Button onClick={() => listQuery.refetch()}>Tentar novamente</Button></div> : null}
            {listQuery.data && !listQuery.data.items.length ? <div className="signature-page-state"><strong>Nenhum documento ainda.</strong><span>Envie um PDF para iniciar.</span><Button onClick={() => setNewOpen(true)}>Novo documento</Button></div> : null}
            {listQuery.data?.items.length ? <div className="signature-document-list">{listQuery.data.items.map(document => <DocumentCard key={document.id} document={document} onOpen={() => openDocument(document.id, document.status === 'RASCUNHO' ? 'setup' : 'details')} />)}</div> : null}
          </section>
        )}
        <NewDocumentModal open={newOpen} submitting={mutations.create.isPending} onClose={() => setNewOpen(false)} onSubmit={create} />
        <AssinaturasTutorial userKey={user?.id || ''} ready={Boolean(user) && !listQuery.isLoading} triggerRef={tutorialTrigger} />
      </main>
    </Shell>
  );
}
