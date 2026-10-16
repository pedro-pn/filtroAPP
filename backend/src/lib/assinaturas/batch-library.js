import { z } from 'zod';

export function aggregateDocumentStatus(documents) {
  for (const status of ['FINALIZANDO', 'AGUARDANDO_ASSINATURAS', 'RASCUNHO']) {
    if (documents.some(document => document.status === status)) return status;
  }
  return documents.every(document => document.status === 'CANCELADO') ? 'CANCELADO' : 'CONCLUIDO';
}

export async function listGroupedDocuments(client, ownerUserId, where, filters, limit, documentCard) {
  let cursor;
  if (filters.cursor) {
    try {
      cursor = z.strictObject({ id: z.string().min(1), kind: z.enum(['batch', 'document']), createdAt: z.iso.datetime() })
        .parse(JSON.parse(Buffer.from(String(filters.cursor), 'base64url').toString()));
    } catch {
      throw Object.assign(new Error('Página inválida. Atualize a lista.'), { statusCode: 400 });
    }
  }
  const after = kind => cursor ? { OR: [
    { createdAt: { lt: new Date(cursor.createdAt) } },
    { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
    ...(kind < cursor.kind ? [{ createdAt: new Date(cursor.createdAt), id: cursor.id }] : [])
  ] } : {};
  const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }];
  const [batches, documents] = await Promise.all([
    client.signatureDocumentBatch.findMany({
      where: { ownerUserId, documents: { some: where }, ...after('batch') },
      include: { documents: {
        where: { ownerUserId, deletedAt: null, archivedAt: where.archivedAt },
        include: { signers: { select: { status: true } } },
        orderBy: [{ batchPosition: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
      } }, orderBy, take: limit + 1
    }),
    client.signatureDocument.findMany({
      where: { AND: [where, { batchId: null }, after('document')] },
      include: { signers: { select: { status: true } } }, orderBy, take: limit + 1
    })
  ]);
  const entries = [
    ...documents.map(document => ({ kind: 'document', ...documentCard(document) })),
    ...batches.filter(batch => batch.documents.length).map(batch => {
      const children = batch.documents.map(documentCard);
      const signedCount = children.reduce((sum, document) => sum + document.signedCount, 0);
      const signerCount = children.reduce((sum, document) => sum + document.signerCount, 0);
      const status = aggregateDocumentStatus(children);
      return {
        kind: 'batch', id: batch.id, batchId: batch.id, batchDocuments: children,
        title: `Lote de ${children.length} documentos`, originalFileName: `${children.length} PDFs separados`,
        status, pageCount: children.reduce((sum, document) => sum + document.pageCount, 0),
        signedCount, signerCount, progressLabel: `${signedCount} de ${signerCount} assinaturas`,
        hasExpiredInvites: children.some(document => document.hasExpiredInvites),
        isArchived: Boolean(filters.archived), createdAt: batch.createdAt,
        completedAt: status === 'CONCLUIDO' ? children.map(document => document.completedAt).filter(Boolean).sort((a, b) => new Date(a) - new Date(b)).at(-1) || null : null
      };
    })
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id.localeCompare(a.id, 'en') || b.kind.localeCompare(a.kind, 'en'));
  const page = entries.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ kind: _kind, ...item }) => item),
    nextCursor: entries.length > limit && last ? Buffer.from(JSON.stringify({
      id: last.id, kind: last.kind, createdAt: new Date(last.createdAt).toISOString()
    })).toString('base64url') : null
  };
}
