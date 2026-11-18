import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fieldRowsForDocument,
  normalizeSignerInputs,
  publishDocument,
  publicationExpiresAt,
  replaceFields,
  replaceSigners,
  unpublishDocument,
  validatePublishableSnapshot
} from '../src/lib/assinaturas/service.js';

const pageDimensions = [
  { page: 1, widthPt: 612, heightPt: 792, rotation: 0 },
  { page: 2, widthPt: 792, heightPt: 612, rotation: 90 },
  { page: 3, widthPt: 612, heightPt: 792, rotation: 180 },
  { page: 4, widthPt: 792, heightPt: 612, rotation: 270 }
];

function publicationClient({ signed = false } = {}) {
  const document = {
    id: 'document-1',
    ownerUserId: 'user-1',
    status: 'RASCUNHO',
    archivedAt: null,
    deletedAt: null,
    pageCount: 1,
    pageDimensions: [pageDimensions[0]],
    sourceStoragePath: 'Assinaturas/Documentos/source.pdf',
    sourceDocumentHash: 'a'.repeat(64),
    signers: [
      { id: 'signer-1', documentId: 'document-1', name: 'Ana Souza', email: null, position: 1, status: signed ? 'ASSINADO' : 'PENDENTE', fields: [{ id: 'field-1' }] },
      { id: 'signer-2', documentId: 'document-1', name: 'Bia Souza', email: 'bia@example.com', position: 2, status: 'PENDENTE', fields: [{ id: 'field-2' }] }
    ],
    fields: [{ id: 'field-1' }, { id: 'field-2' }]
  };
  const audits = [];
  const client = {
    signatureDocument: {
      async findFirst({ where }) {
        return where.id === document.id && where.ownerUserId === document.ownerUserId ? document : null;
      },
      async update({ data }) {
        Object.assign(document, data);
        return document;
      },
      async findUnique() { return document; }
    },
    signatureDocumentSigner: {
      async update({ where, data }) {
        const signer = document.signers.find(item => item.id === where.id);
        Object.assign(signer, data);
        return signer;
      },
      async updateMany({ data }) {
        for (const signer of document.signers) Object.assign(signer, data);
        return { count: document.signers.length };
      },
      async deleteMany() { return { count: document.signers.length }; },
      async create() { throw new Error('não esperado'); }
    },
    signatureDocumentField: {
      async deleteMany() { return { count: document.fields.length }; },
      async createMany() { return { count: 0 }; }
    },
    signatureDocumentAuditLog: {
      async create({ data }) { audits.push(data); return data; }
    },
    async $transaction(operation) { return operation(client); }
  };
  return { client, document, audits };
}

test('assinantes exigem nome, posições sequenciais e e-mails únicos', () => {
  assert.throws(() => normalizeSignerInputs([{ name: '', position: 1 }]), /nome/i);
  assert.throws(() => normalizeSignerInputs([
    { name: 'Ana Souza', email: 'ana@example.com', position: 1 },
    { name: 'Bia Souza', email: 'ANA@example.com', position: 2 }
  ]), /repetido/i);
  assert.throws(() => normalizeSignerInputs([{ name: 'Ana Souza', position: 2 }]), /sequencial/i);

  assert.deepEqual(normalizeSignerInputs([{ name: ' Ana Souza ', email: '', position: 1 }]), [{
    name: 'Ana Souza', email: null, position: 1
  }]);
});

test('campos rejeitam propriedades físicas do cliente e derivam as quatro rotações do documento', () => {
  const document = {
    id: 'document-1',
    pageCount: 4,
    pageDimensions,
    signers: [{ id: 'signer-1' }]
  };
  assert.throws(() => fieldRowsForDocument(document, [{
    signerId: 'signer-1', pageNumber: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.1, pageRotation: 180
  }]), /não reconhecido|unrecognized/i);

  const rows = fieldRowsForDocument(document, pageDimensions.map(page => ({
    signerId: 'signer-1', pageNumber: page.page, x: 0.1, y: 0.2, width: 0.3, height: 0.1
  })));
  assert.deepEqual(rows.map(row => row.pageRotation), [0, 90, 180, 270]);
  assert.deepEqual(rows.map(row => row.pageWidthPt), [612, 792, 612, 792]);
});

test('prazo de publicação respeita mínimo de uma hora e teto configurado', () => {
  const now = new Date('2026-08-28T12:00:00.000Z');
  assert.throws(() => publicationExpiresAt({ expiresAt: '2026-08-28T12:30:00.000Z' }, now), /uma hora/i);
  assert.throws(() => publicationExpiresAt({ expiresInDays: 91 }, now), /90 dias/i);
  assert.equal(
    publicationExpiresAt({ expiresInDays: 15 }, now).toISOString(),
    '2026-09-12T12:00:00.000Z'
  );
});

test('publicação lista pendências e aceita snapshot íntegro', () => {
  const invalid = validatePublishableSnapshot({
    status: 'RASCUNHO',
    archivedAt: null,
    deletedAt: null,
    signers: [{ id: 'signer-1', name: 'Ana Souza', email: null, fields: [] }]
  });
  assert.match(invalid[0], /campo/i);

  assert.deepEqual(validatePublishableSnapshot({
    status: 'RASCUNHO',
    archivedAt: null,
    deletedAt: null,
    signers: [{
      id: 'signer-1',
      name: 'Ana Souza',
      email: null,
      fields: [{ id: 'field-1' }]
    }]
  }), []);
});

test('publicação emite hashes distintos, protege edição e despublicação zera os convites', async () => {
  const { client, document, audits } = publicationClient();
  const now = new Date('2026-08-28T12:00:00.000Z');
  const result = await publishDocument(client, document.id, document.ownerUserId, { expiresInDays: 15 }, {
    now,
    loadSource: async () => Buffer.from('%PDF')
  });

  assert.equal(result.document.status, 'AGUARDANDO_ASSINATURAS');
  assert.equal(document.signers.every(signer => Boolean(signer.tokenHash)), true);
  assert.equal(new Set(document.signers.map(signer => signer.tokenHash)).size, 2);
  assert.deepEqual(document.signers.map(signer => signer.emailStatus), ['NAO_APLICAVEL', 'PENDENTE']);
  assert.deepEqual(audits.map(item => item.action), ['CONVITE_CRIADO', 'CONVITE_CRIADO', 'DOCUMENTO_PUBLICADO']);

  await assert.rejects(
    () => replaceSigners(client, document, [{ id: 'signer-1', name: 'Ana Souza', email: null, position: 1 }], document.ownerUserId),
    error => error?.statusCode === 409
  );
  await assert.rejects(
    () => replaceFields(client, document, [], document.ownerUserId),
    error => error?.statusCode === 409
  );

  await unpublishDocument(client, document.id, document.ownerUserId);
  assert.equal(document.status, 'RASCUNHO');
  assert.equal(document.signers.every(signer => signer.tokenHash === null), true);
});

test('despublicação é recusada depois da primeira assinatura', async () => {
  const { client, document } = publicationClient({ signed: true });
  document.status = 'AGUARDANDO_ASSINATURAS';

  await assert.rejects(
    () => unpublishDocument(client, document.id, document.ownerUserId),
    error => error?.statusCode === 409 && /assinatura/i.test(error.message)
  );
});

test('falha do envio pós-commit não bloqueia a publicação', async () => {
  const { client, document } = publicationClient();
  const result = await publishDocument(client, document.id, document.ownerUserId, { expiresInDays: 15 }, {
    now: new Date('2026-08-28T12:00:00.000Z'),
    loadSource: async () => Buffer.from('%PDF'),
    deliverInvites: async () => { throw new Error('SMTP indisponível'); }
  });

  assert.equal(result.document.status, 'AGUARDANDO_ASSINATURAS');
  assert.equal(document.signers.every(item => Boolean(item.tokenHash)), true);
});
