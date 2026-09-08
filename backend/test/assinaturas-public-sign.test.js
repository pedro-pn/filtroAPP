import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  assertInviteUsable,
  confirmSignature,
  publicInvitePayload,
  tokenFromSignatureHeader
} from '../src/lib/assinaturas/signing.js';
import { signatureTokenData, signatureTokenHash } from '../src/lib/signature-token.js';
import {
  renewInvite,
  resolveInviteByToken,
  revokeInvite
} from '../src/lib/assinaturas/invites.js';
import { sanitizedHttpErrorForObservability } from '../src/app.js';
import { signatureOperationLog } from '../src/lib/assinaturas/observability.js';

const validSignatureImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function invite(overrides = {}) {
  return {
    id: 'signer-1',
    name: 'Maria Silva',
    email: 'maria@example.com',
    status: 'PENDENTE',
    tokenHash: 'hash',
    tokenExpiresAt: new Date(Date.now() + 60_000),
    document: {
      id: 'document-1',
      title: 'Contrato',
      originalFileName: 'contrato.pdf',
      pageCount: 1,
      status: 'AGUARDANDO_ASSINATURAS',
      requesterNameSnapshot: 'Pedro Paulo',
      sourceDocumentHash: 'abc',
      deletedAt: null,
      signers: [{ id: 'signer-1', status: 'PENDENTE' }, { id: 'signer-2', status: 'ASSINADO' }]
    },
    fields: [{ pageNumber: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }],
    ...overrides
  };
}

function signingClient(token, { remainingAfterSignature = 0 } = {}) {
  const activeInvite = invite({
    tokenHash: signatureTokenHash(token),
    tokenExpiresAt: new Date('2026-09-28T15:00:00.000Z'),
    document: {
      ...invite().document,
      signers: [{ id: 'signer-1', status: 'PENDENTE', isRequired: true }]
    }
  });
  const state = { invite: activeInvite, audits: [], advisoryLocks: [], updates: 0, transitions: 0 };
  const client = {
    signatureDocumentSigner: {
      async findUnique({ where }) {
        return where.tokenHash === activeInvite.tokenHash ? activeInvite : null;
      },
      async updateMany({ data }) {
        if (!['PENDENTE', 'VISUALIZADO'].includes(activeInvite.status)) return { count: 0 };
        Object.assign(activeInvite, data);
        activeInvite.document.signers[0].status = activeInvite.status;
        state.updates += 1;
        return { count: 1 };
      }
    },
    signatureDocument: {
      async updateMany({ data }) {
        if (activeInvite.document.status !== 'AGUARDANDO_ASSINATURAS') return { count: 0 };
        Object.assign(activeInvite.document, data);
        state.transitions += 1;
        return { count: 1 };
      },
      async findUnique() { return activeInvite.document; }
    },
    signatureDocumentAuditLog: {
      async create({ data }) { state.audits.push(data); return data; }
    },
    async $queryRawUnsafe(query, ...params) {
      state.advisoryLocks.push({ query, params });
      return [{ lock_result: '' }];
    },
    async $transaction(operation) { return operation(client); }
  };
  client.signatureDocumentSigner.count = async () => remainingAfterSignature;
  return { client, state };
}

test('segredo é aceito somente pelo header dedicado e com formato esperado', () => {
  const token = 'a'.repeat(64);
  assert.equal(tokenFromSignatureHeader({ headers: { 'x-signature-token': token } }), token);
  assert.equal(tokenFromSignatureHeader({ headers: {}, query: { convite: token }, params: { token } }), '');
  assert.equal(tokenFromSignatureHeader({ headers: { 'x-signature-token': 'inválido' } }), '');
});

test('convite inválido, expirado, revogado e cancelado é recusado sem revelar o token', () => {
  assert.throws(() => assertInviteUsable(null), error => error?.statusCode === 404);
  assert.throws(() => assertInviteUsable(invite({ status: 'REVOGADO' })), error => error?.statusCode === 404);
  assert.throws(() => assertInviteUsable(invite({ tokenExpiresAt: new Date(0) })), error => error?.statusCode === 410);
  assert.throws(() => assertInviteUsable(invite({ document: { ...invite().document, status: 'CANCELADO' } })), error => error?.statusCode === 410);
});

test('payload público contém só o próprio assinante e progresso agregado', () => {
  const payload = publicInvitePayload(invite());

  assert.equal(payload.signer.name, 'Maria Silva');
  assert.equal(payload.document.requestedBy, 'Pedro Paulo');
  assert.deepEqual(payload.document.progress, { signed: 1, total: 2 });
  assert.equal(JSON.stringify(payload).includes('maria@example.com'), false);
  assert.equal(JSON.stringify(payload).includes('signer-2'), false);
});

test('imagem inválida é rejeitada antes de abrir transação', async () => {
  let transactions = 0;
  const client = {
    async $transaction() {
      transactions += 1;
    }
  };
  await assert.rejects(() => confirmSignature(client, 'a'.repeat(64), {
    signerName: 'Maria Silva',
    signatureImageDataUrl: 'data:image/png;base64,abc',
    privacyNoticeAccepted: true,
    privacyNoticeVersion: 'signature_avulsa_v1'
  }), /assinatura visual/i);
  assert.equal(transactions, 0);

  assert.ok(validSignatureImageDataUrl.length < 750_000);
});

test('assinatura válida é idempotente e a última apenas inicia FINALIZANDO', async () => {
  const token = 'b'.repeat(64);
  const { client, state } = signingClient(token);
  let finalizations = 0;
  const payload = {
    signerName: 'Maria Silva',
    signatureImageDataUrl: validSignatureImageDataUrl,
    privacyNoticeAccepted: true,
    privacyNoticeVersion: 'signature_avulsa_v1'
  };
  const dependencies = {
    now: new Date('2026-08-28T15:00:00.000Z'),
    processFinalization: async () => { finalizations += 1; }
  };

  const first = await confirmSignature(client, token, payload, { ipAddress: '203.0.113.10', userAgent: 'Node Test' }, dependencies);
  assert.equal(first.documentStatus, 'FINALIZANDO');
  assert.equal(state.invite.status, 'ASSINADO');
  assert.equal(state.invite.declaredSignerName, 'Maria Silva');
  assert.equal(state.invite.privacyNoticeVersion, 'signature_avulsa_v1');
  assert.equal(state.transitions, 1);
  assert.equal(finalizations, 1);
  assert.match(state.advisoryLocks[0].query, /pg_advisory_xact_lock[\s\S]*::text AS lock_result/);
  assert.deepEqual(state.advisoryLocks[0].params, ['document-1']);
  assert.deepEqual(state.audits.map(item => item.action), ['ASSINATURA_REALIZADA', 'FINALIZACAO_INICIADA']);

  const second = await confirmSignature(client, token, payload, {}, dependencies);
  assert.equal(second.documentStatus, 'FINALIZANDO');
  assert.equal(state.updates, 1);
  assert.equal(state.transitions, 1);
  assert.equal(finalizations, 1);
  assert.equal(state.audits.length, 2);
});

test('superfície pública usa header, sem segredo em URL, e respostas privadas não entram em cache', async () => {
  const routeSource = await fs.readFile(new URL('../src/routes/resources/assinaturas.js', import.meta.url), 'utf8');
  const appSource = await fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8');

  assert.match(routeSource, /x-signature-token/i);
  assert.doesNotMatch(routeSource, /publico\/:token|publico\/:convite|req\.query\.(?:token|convite)/i);
  assert.match(routeSource, /Cache-Control', 'no-store'/);
  assert.match(routeSource, /Referrer-Policy', 'no-referrer'/);
  assert.doesNotMatch(routeSource, /console\.[a-z]+\([^\n]*x-signature-token/i);
  assert.doesNotMatch(appSource, /console\.[a-z]+\([^\n]*x-signature-token/i);

  const token = 'c'.repeat(64);
  const sanitized = sanitizedHttpErrorForObservability(new Error(`Falha ao processar ${token}`), {
    headers: { 'x-signature-token': token }
  });
  assert.equal(`${sanitized.message}\n${sanitized.stack}`.includes(token), false);
  assert.match(sanitized.message, /\[REDACTED\]/);

  assert.match(appSource, /safe-url/);
  assert.match(appSource, /path: req\.path/);
  assert.doesNotMatch(appSource, /path: req\.(?:originalUrl|url)/);

  const frontendApi = await fs.readFile(new URL('../../frontend/src/api/assinaturas.ts', import.meta.url), 'utf8');
  const frontendHook = await fs.readFile(new URL('../../frontend/src/hooks/useAssinaturas.ts', import.meta.url), 'utf8');
  const frontendFragment = await fs.readFile(new URL('../../frontend/src/pages/assinaturas/utils/coordinates.ts', import.meta.url), 'utf8');
  assert.match(frontendApi, /'X-Signature-Token': token/);
  assert.doesNotMatch(frontendApi, /[?&](?:token|convite)=/i);
  assert.doesNotMatch(frontendHook, /queryKey:\s*\[[^\]]*token/i);
  assert.doesNotMatch(`${frontendApi}\n${frontendHook}\n${frontendFragment}`, /(?:localStorage|sessionStorage)\.setItem\([^\n]*token/i);
  assert.match(frontendFragment, /history\.replaceState/);

  const logged = [];
  const payload = signatureOperationLog('security.audit', {
    operationKey: 'operation-safe',
    outcome: 'completed',
    token,
    tokenHash: signatureTokenHash(token),
    path: '/home/private/document.pdf',
    url: `https://example.invalid/#convite=${token}`
  }, { logger: { info(value) { logged.push(value); } }, startedAt: Date.now() });
  assert.equal(JSON.stringify(payload).includes(token), false);
  assert.equal(JSON.stringify(payload).includes('/home/private'), false);
  assert.deepEqual(logged, [payload]);
});

function invitationLifecycleClient(target) {
  const audits = [];
  const client = {
    signatureDocumentSigner: {
      async findUnique({ where }) {
        return target.tokenHash === where.tokenHash ? target : null;
      },
      async updateMany({ where, data }) {
        if (where.id !== target.id) return { count: 0 };
        if (where.status?.in && !where.status.in.includes(target.status)) return { count: 0 };
        if (where.tokenHash !== undefined && where.tokenHash !== target.tokenHash) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in value) target[key] = (target[key] || 0) + value.increment;
          else target[key] = value;
        }
        return { count: 1 };
      }
    },
    signatureDocumentAuditLog: {
      async create({ data }) { audits.push(data); return data; }
    }
  };
  return { client, audits };
}

test('renovação invalida token anterior, o novo funciona e revogação o derruba imediatamente', async () => {
  const oldTokenData = signatureTokenData();
  const newTokenData = signatureTokenData();
  const document = { id: 'document-renew', status: 'AGUARDANDO_ASSINATURAS', deletedAt: null, signers: [] };
  const target = {
    ...invite(),
    ...oldTokenData,
    documentId: document.id,
    document,
    renewalCount: 0
  };
  document.signers = [{ id: target.id, status: target.status, isRequired: true }];
  const { client, audits } = invitationLifecycleClient(target);

  const renewed = await renewInvite(client, document, target, new Date('2026-10-01T12:00:00.000Z'), {
    tokenFactory: () => newTokenData,
    actorUserId: 'owner-1'
  });
  assert.equal(await resolveInviteByToken(client, oldTokenData.token), null);
  assert.equal((await resolveInviteByToken(client, newTokenData.token)).id, target.id);
  assert.match(renewed.url, new RegExp(`#convite=${newTokenData.token}$`));

  await revokeInvite(client, document, target, { actorUserId: 'owner-1' });
  assert.equal(await resolveInviteByToken(client, newTokenData.token), null);
  assert.deepEqual(audits.map(item => item.action), ['CONVITE_RENOVADO', 'CONVITE_REVOGADO']);
});

test('assinatura e renovação concorrentes não podem vencer sobre o mesmo token', async () => {
  const oldTokenData = signatureTokenData();
  const document = { id: 'document-race', status: 'AGUARDANDO_ASSINATURAS', deletedAt: null, signers: [] };
  const target = { ...invite(), ...oldTokenData, documentId: document.id, document, renewalCount: 0 };
  const { client } = invitationLifecycleClient(target);

  const signed = await client.signatureDocumentSigner.updateMany({
    where: { id: target.id, status: { in: ['PENDENTE', 'VISUALIZADO'] }, tokenHash: oldTokenData.tokenHash },
    data: { status: 'ASSINADO' }
  });
  assert.equal(signed.count, 1);
  await assert.rejects(
    () => renewInvite(client, document, target, new Date('2026-10-01T12:00:00.000Z')),
    error => error?.statusCode === 409
  );
  assert.equal(target.status, 'ASSINADO');
});
