import assert from 'node:assert/strict';
import test from 'node:test';
import { commercialProposalDocumentsRefetchInterval, commercialProposalSyncMessage } from '../src/utils/projectDocuments.ts';

test('atualiza documentos somente enquanto uma importação pode avançar', () => {
  for (const status of ['PENDING', 'APPLYING', 'ERROR']) {
    assert.equal(commercialProposalDocumentsRefetchInterval({ status, retryScheduled: true }), 15_000);
  }
  for (const sync of [null, undefined, { status: 'SYNCED', retryScheduled: true }, { status: 'EXCLUDED', retryScheduled: true },
    { status: 'PENDING', retryScheduled: false }, { status: 'ERROR', retryScheduled: false }]) {
    assert.equal(commercialProposalDocumentsRefetchInterval(sync), false);
  }
});

test('handover distingue revisão ausente, PDFs não finalizados e importação em andamento', () => {
  const sync = { status: 'ERROR', proposalCode: '4607', revisionNumber: 0, errorCode: 'COMERCIALAPP_HTTP_404', configured: true, retryScheduled: true };
  assert.match(commercialProposalSyncMessage(sync), /proposta 4607, revisão 0 não foram encontrados/);
  assert.match(commercialProposalSyncMessage({ ...sync, errorCode: 'COMERCIALAPP_HTTP_409' }), /PDFs.*disponíveis para importação/);
  assert.match(commercialProposalSyncMessage({ ...sync, status: 'PENDING' }), /aparecerão aqui automaticamente/);
  assert.match(commercialProposalSyncMessage({ ...sync, configured: false }), /ainda não está configurada/);
  assert.match(commercialProposalSyncMessage({ ...sync, status: 'EXCLUDED', stopReason: 'LEGACY_ACCESS_ONLY' }), /acervo legado/);
  assert.doesNotMatch(commercialProposalSyncMessage({ ...sync, retryScheduled: false }), /será repetida/);
  assert.equal(commercialProposalSyncMessage({ ...sync, status: 'SYNCED' }), null);
  assert.equal(commercialProposalSyncMessage(null), null);
});
