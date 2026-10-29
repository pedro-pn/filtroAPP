import { Prisma } from '@prisma/client';

// JOIN e recorte anteriores a LIMIT: notas sem ligação não consomem página nem contagem.
export async function loadInvoiceRows(client, { query, context, snapshotAt, position }) {
  const clauses = [Prisma.sql`n.source IN ('NFSE','NFE','ND')`, Prisma.sql`p."deletedAt" IS NULL`, Prisma.sql`n."updatedAt" <= ${snapshotAt}`];
  if (context.projectAccessMode === 'SELECTED') clauses.push(Prisma.sql`p.id IN (${Prisma.join([...context.projectIds])})`);
  if (query.projectId) clauses.push(Prisma.sql`p.id = ${query.projectId}`);
  if (query.projectCode) clauses.push(Prisma.sql`p.code = ${query.projectCode}`);
  if (query.updatedSince) clauses.push(Prisma.sql`n."updatedAt" >= ${new Date(query.updatedSince)}`);
  if (position) clauses.push(Prisma.sql`(n."updatedAt", n.id) > (${new Date(position.updatedAt)}, ${position.id})`);
  return client.$queryRaw(Prisma.sql`
    SELECT n.id, p.id AS "projectId", p.code AS "projectCode", n.source AS tipo, n.numero, n.serie,
      n."dataEmissao", n.valor::text AS valor, n."updatedAt",
      CASE n."receiptStatus" WHEN 'RECEIVED' THEN 'RECEBIDA' WHEN 'PARTIAL' THEN 'PARCIAL'
        WHEN 'OPEN' THEN 'EM_ABERTO' WHEN 'OVERDUE' THEN 'ATRASADA' ELSE 'DESCONHECIDA' END AS "situacaoRecebimento"
    FROM "OmieInvoice" n JOIN "OmieProject" op ON op.codigo = n."codigoProjeto"
      JOIN "Project" p ON p.id = op."projectId"
    WHERE ${Prisma.join(clauses, ' AND ')} ORDER BY n."updatedAt", n.id LIMIT ${query.limit + 1}`);
}
