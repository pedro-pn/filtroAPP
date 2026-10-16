import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import type { SignatureBatch, SignatureBatchConfiguration, SignatureDocument } from '../../src/api/assinaturas';
import { AuthContext } from '../../src/auth/AuthContext';
import type { AuthUser } from '../../src/types/auth';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { ToastContext } from '../../src/components/ui/ToastContext';
import { AssinaturasPublicSignPage } from '../../src/pages/assinaturas/AssinaturasPublicSignPage';
import { AssinaturasPage } from '../../src/pages/assinaturas/AssinaturasPage';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';

// Apenas dados simulados; sessionStorage permite testar o reload do rascunho.
const key = 'signature-batch-fixture';
const state: { batch: SignatureBatch; uploads: string[]; failOnce: boolean; publication: unknown } = JSON.parse(sessionStorage.getItem(key) || 'null') || {
  batch: { id: 'batch', signers: [], invitations: [], documents: [] }, uploads: [], failOnce: true, publication: null
};
const persist = () => sessionStorage.setItem(key, JSON.stringify(state));
Object.assign(window, { signatureBatchFixture: state });
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  const method = config.method;
  let data: unknown;
  if (url === '/assinaturas/lotes' && method === 'post') data = { id: 'batch' };
  else if (url === '/assinaturas/documentos' && method === 'post') {
    const fileName = config.params.fileName;
    if (fileName === 'segundo.pdf' && state.failOnce) { state.failOnce = false; persist(); throw new Error('Falha de envio simulada'); }
    state.uploads.push(fileName);
    const document = { id: `doc-${state.batch.documents.length + 1}`, batchId: 'batch', title: fileName.replace('.pdf', ''), originalFileName: fileName,
      pageCount: 2, status: 'RASCUNHO', signers: [], fields: [], archivedAt: null, progress: { signed: 0, total: 0 }, signerCount: 0, signedCount: 0,
      createdAt: new Date().toISOString(), pageDimensions: [1, 2].map(page => ({ page, widthPt: 612, heightPt: 792, rotation: 0 })) } as SignatureDocument;
    state.batch.documents.push(document); data = document;
  } else if (url === '/assinaturas/lotes/batch/configuracao') {
    const input: SignatureBatchConfiguration = JSON.parse(config.data);
    state.batch.signers = input.signers;
    for (const document of state.batch.documents) {
      const fields = input.documents.find(item => item.id === document.id)!.fields;
      document.signers = input.signers.filter(signer => fields.some(field => field.signerId === signer.id)).map((signer, index) => ({
        ...signer, batchSignerId: signer.id, id: `${document.id}-${signer.id}`, position: index + 1, status: 'PENDENTE', signedAt: null, viewedAt: null, tokenExpiresAt: null, emailStatus: 'NAO_APLICAVEL'
      }));
      document.progress = { signed: 0, total: document.signers.length };
      document.signerCount = document.signers.length;
      document.progressLabel = `0 de ${document.signers.length} assinaturas`;
      document.fields = fields.map(field => ({ ...field, signerId: `${document.id}-${field.signerId}` }));
    }
    data = structuredClone(state.batch);
  } else if (url === '/assinaturas/lotes/batch/publicar') {
    state.publication = state.batch.documents.map(document => ({ document: document.id, signers: document.signers.map(signer => signer.name) }));
    for (const document of state.batch.documents) {
      document.status = 'AGUARDANDO_ASSINATURAS';
      for (const signer of document.signers) { signer.emailStatus = signer.email ? 'ENVIADO' : 'NAO_APLICAVEL'; signer.tokenExpiresAt = '2030-01-01T00:00:00Z'; }
    }
    data = {};
  } else if (url === '/assinaturas/lotes/batch') {
    const invitations = state.batch.signers.flatMap(signer => {
      const documents = state.batch.documents.filter(document => document.signers.some(child => child.batchSignerId === signer.id));
      if (!documents.length) return [];
      const child = documents[0].signers.find(child => child.batchSignerId === signer.id)!;
      return [{ ...child, id: signer.id, documents: documents.map(document => ({ id: document.id, title: document.title, status: document.status, signerStatus: document.signers.find(child => child.batchSignerId === signer.id)!.status })) }];
    });
    data = { ...structuredClone(state.batch), invitations };
  } else if (/\/lotes\/batch\/assinantes\/.+\/link$/.test(url)) data = { url: `https://example.test/assinaturas/assinar#convite=${url.split('/')[5]}`, expiresAt: '2030-01-01T00:00:00Z' };
  else if (/\/paginas\/\d+\.png$/.test(url)) data = new Blob([
    '<svg xmlns="http://www.w3.org/2000/svg" width="612" height="792"><rect width="612" height="792" fill="white"/><text x="48" y="60" font-size="20">Contrato de teste</text></svg>'
  ], { type: 'image/svg+xml' });
  else if (url === '/assinaturas/documentos') data = { items: state.batch.documents.length ? [{
    id: 'batch', batchId: 'batch', title: `Lote de ${state.batch.documents.length} documentos`,
    originalFileName: 'PDFs separados', batchDocuments: structuredClone(state.batch.documents),
    status: state.batch.documents.some(document => document.status === 'AGUARDANDO_ASSINATURAS') ? 'AGUARDANDO_ASSINATURAS' : 'RASCUNHO',
    signerCount: 3, signedCount: 0, pageCount: 4, progressLabel: '0 de 3 assinaturas', createdAt: new Date().toISOString()
  }] : [], nextCursor: null };
  else if (/\/documentos\/doc-\d+$/.test(url)) data = structuredClone(state.batch.documents.find(item => url.endsWith(item.id)));
  else data = [];
  persist();
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};
const publicMode = new URLSearchParams(window.location.search).get('mode') === 'public';
const noveltyMode = new URLSearchParams(window.location.search).get('novelty') === '1';
const fixtureUser: AuthUser | null = noveltyMode ? { id: 'signature-batch-novelty-browser', name: 'Gestor de assinaturas', username: 'novelty-test',
  email: null, role: 'MANAGER', accountType: 'INTERNAL', moduleRoles: ['assinaturas:user'], reportEmissionPermissions: [], isActive: true } : null;
const publicState = { signed: false, signatureRequests: 0, downloads: [] as string[] };
Object.assign(window, { signatureGroupPublicFixture: publicState });
if (publicMode) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (!url.pathname.startsWith('/api/assinaturas/publico')) return originalFetch(input, init);
    if (new Headers(init?.headers).get('X-Signature-Token') !== 'a'.repeat(64)) return new Response('{}', { status: 404 });
    if (url.pathname.endsWith('/assinar')) {
      publicState.signatureRequests++;
      publicState.signed = true;
      return Response.json({ success: true, documentStatus: 'CONCLUIDO', downloadAvailable: true });
    }
    if (url.pathname.endsWith('/pdf')) {
      publicState.downloads.push(url.searchParams.get('documentId') || '');
      return new Response('%PDF-' + url.searchParams.get('documentId'), { headers: { 'Content-Type': 'application/pdf' } });
    }
    if (url.pathname.endsWith('.png')) return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="612" height="792"><rect width="612" height="792" fill="white"/><text x="48" y="60">Documento do convite</text></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
    const documents = [1, 2].map(index => ({ id: `doc-${index}`, title: `Contrato ${index}`, originalFileName: `contrato-${index}.pdf`, requestedBy: 'Coordenação',
      pageCount: 1, status: publicState.signed ? 'CONCLUIDO' : 'AGUARDANDO_ASSINATURAS', sourceDocumentHash: String(index).repeat(64),
      pageDimensions: [{ page: 1, widthPt: 612, heightPt: 792, rotation: 0 }], progress: { signed: publicState.signed ? 1 : 0, total: 1 },
      fields: [{ pageNumber: 1, x: .1, y: .3, width: .2, height: .055 }], signerStatus: publicState.signed ? 'ASSINADO' : 'VISUALIZADO', downloadAvailable: publicState.signed }));
    return Response.json({ status: publicState.signed ? 'ASSINADO' : 'ATIVO', expiresAt: '2030-01-01T00:00:00Z',
      signer: { name: 'Ana Souza', status: publicState.signed ? 'ASSINADO' : 'VISUALIZADO', signedAt: publicState.signed ? new Date().toISOString() : null },
      document: { ...documents[0], title: 'Assinatura de 2 documentos', originalFileName: '2 PDFs separados', pageCount: 2 }, documents,
      fields: documents[0].fields, downloadAvailable: publicState.signed });
  };
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const noop = async () => {};
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><ThemeProvider><QueryClientProvider client={client}>
  <AuthContext.Provider value={{ user: fixtureUser, token: null, isBootstrapping: false, isAuthenticated: Boolean(fixtureUser), login: noop, logout: noop, refreshUser: noop, replaceUser() {} }}>
    <ToastContext.Provider value={{ showToast() {} }}><BrowserRouter>{publicMode ? <AssinaturasPublicSignPage /> : <AssinaturasPage />}</BrowserRouter></ToastContext.Provider>
  </AuthContext.Provider>
</QueryClientProvider></ThemeProvider></React.StrictMode>);
