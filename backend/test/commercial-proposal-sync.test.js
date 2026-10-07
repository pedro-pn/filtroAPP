import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { commercialProposalReference, commercialProposalSyncData } from '../src/lib/projects/commercial-proposal-sync-state.js';
import { commercialAppConnection, fetchCommercialProposal, readLimitedCommercialResponse } from '../src/lib/projects/commercial-proposal-sync.js';

function fixture() {
  const project = { id: 'project-1', clientCnpj: '12.345.678/0001-90' };
  const state = { proposalCode: '4621', revisionNumber: 2 };
  const bytes = Buffer.from('%PDF-1.7\nproposal test');
  const bundle = { contractVersion: 1, proposalId: 'proposal-1', proposalCode: '4621', revisionNumber: 2,
    clientCnpj: '12345678000190', projectId: null, sourceUpdatedAt: '2026-10-07T18:00:00Z',
    scope: [], costBreakdown: null, proposalSnapshot: {}, documents: ['COMERCIAL', 'TECNICA'].map(kind => ({
      id: `document-${kind}`, kind, generationId: 'generation-1', fileName: `${kind}.pdf`, mimeType: 'application/pdf',
      byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')
    })) };
  const calls = [];
  const options = { apiUrl: 'http://127.0.0.1:4300', token: 'synthetic-token', production: false,
    transport: async (url, request) => {
      calls.push({ url, request });
      return url.includes('/documentos/') ? new Response(bytes, { headers: { 'content-type': 'application/pdf' } })
        : Response.json(bundle);
    } };
  return { project, state, bytes, bundle, calls, options };
}

test('cadastro e mudança de revisão criam uma busca persistida; reenvio não refaz o que já foi sincronizado', () => {
  const reference = commercialProposalReference('4621 Rev. 2');
  assert.deepEqual(reference, { proposalCode: '4621', revisionNumber: 2 });
  assert.equal(commercialProposalReference('CONTRATO SEM PROPOSTA'), null);
  assert.deepEqual(commercialProposalReference('4621'), { proposalCode: '4621', revisionNumber: 0 });
  const data = commercialProposalSyncData(reference);
  assert.equal(data.commercialProposalSync.status, 'PENDING');
  assert.ok(data.commercialProposalSyncNextAttemptAt instanceof Date);
  assert.deepEqual(commercialProposalSyncData(reference, { ...data.commercialProposalSync, status: 'SYNCED' }), {});
  assert.notEqual(commercialProposalSyncData({ ...reference, revisionNumber: 3 }, data.commercialProposalSync).commercialProposalSync.requestId,
    data.commercialProposalSync.requestId);
});

test('busca somente a revisão solicitada e confere os dois arquivos', async () => {
  const f = fixture();
  const result = await fetchCommercialProposal(f.project, f.state, f.options);
  assert.equal(result.files.length, 2);
  assert.deepEqual(result.files[0].parsed.bytes, f.bytes);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.url.includes('/propostas/4621/revisoes/2')));
  assert.ok(f.calls.every(call => call.request.redirect === 'error'));
});

test('recusa CNPJ, projeto, revisão e geração divergentes', async () => {
  for (const modify of [bundle => { bundle.clientCnpj = '98765432000199'; },
    bundle => { bundle.projectId = 'another-project'; }, bundle => { bundle.revisionNumber = 1; },
    bundle => { bundle.documents[1].generationId = 'another-generation'; }]) {
    const f = fixture(); modify(f.bundle);
    await assert.rejects(fetchCommercialProposal(f.project, f.state, f.options), error => error.code === 'COMERCIALAPP_IDENTITY_MISMATCH');
    assert.equal(f.calls.length, 1);
  }
});

test('recusa conteúdo de PDF diferente do hash publicado', async () => {
  const f = fixture(); f.bundle.documents[0].sha256 = '0'.repeat(64);
  await assert.rejects(fetchCommercialProposal(f.project, f.state, f.options), error => error.code === 'COMERCIALAPP_DOCUMENT_INVALID');
});

test('limita downloads mesmo sem Content-Length e mantém erros HTTP distintos', async () => {
  await assert.rejects(readLimitedCommercialResponse(new Response(new Uint8Array(11)), 10), error => error.code === 'COMERCIALAPP_RESPONSE_TOO_LARGE');
  await assert.rejects(readLimitedCommercialResponse(new Response('', { status: 404 }), 10), error => error.code === 'COMERCIALAPP_HTTP_404');
});

test('produção exige origem HTTPS sem credenciais embutidas nem caminho', () => {
  assert.equal(commercialAppConnection({ apiUrl: 'https://comercial.example', token: 'test', production: true }).origin, 'https://comercial.example');
  for (const apiUrl of ['http://comercial.example', 'https://user:pass@comercial.example', 'https://comercial.example/api']) {
    assert.throws(() => commercialAppConnection({ apiUrl, token: 'test', production: true }), error => error.code === 'COMERCIALAPP_URL_INVALID');
  }
});
