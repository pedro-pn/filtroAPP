import { Prisma } from '@prisma/client';
import { isSedeCostCenterCode, SEDE_OMIE_CODES } from '../acompanhamento/sede-cost-centers.js';
import { projectChannelWhere } from '../projects/distribution.js';
import { readPurchaseSnapshot } from './purchase-snapshot.js';

async function writeBatch(tx, rows, syncedAt) {
  const payload = JSON.stringify(rows.map(row => ({ ...row, syncedAt })));
  // Upsert em lotes preserva o id local dos títulos existentes e evita uma
  // consulta por título na carga histórica de todos os projetos.
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "OmiePurchase" (id,"omieId","codigoProjeto","projectId","osNumber",valor,
      "statusTitulo","categoriaCodigo","categoriaDescricao","fornecedorCodigo","numeroDocumento",
      "numeroDocumentoFiscal",origem,"dataEmissao","dataVencimento","dataPrevisao","linkStatus","rawPayload","syncedAt")
    SELECT id,"omieId","codigoProjeto","projectId","osNumber",valor,"statusTitulo","categoriaCodigo",
      "categoriaDescricao","fornecedorCodigo","numeroDocumento","numeroDocumentoFiscal",origem,
      "dataEmissao","dataVencimento","dataPrevisao","linkStatus","rawPayload","syncedAt"
    FROM jsonb_to_recordset(${payload}::jsonb) AS n(id text,"omieId" text,"codigoProjeto" text,
      "projectId" text,"osNumber" text,valor numeric,"statusTitulo" text,"categoriaCodigo" text,
      "categoriaDescricao" text,"fornecedorCodigo" text,"numeroDocumento" text,"numeroDocumentoFiscal" text,
      origem text,"dataEmissao" timestamp,"dataVencimento" timestamp,"dataPrevisao" timestamp,
      "linkStatus" text,"rawPayload" jsonb,"syncedAt" timestamp)
    ON CONFLICT ("omieId") DO UPDATE SET "codigoProjeto"=EXCLUDED."codigoProjeto",
      "projectId"=EXCLUDED."projectId","osNumber"=EXCLUDED."osNumber",valor=EXCLUDED.valor,
      "statusTitulo"=EXCLUDED."statusTitulo","categoriaCodigo"=EXCLUDED."categoriaCodigo",
      "categoriaDescricao"=EXCLUDED."categoriaDescricao","fornecedorCodigo"=EXCLUDED."fornecedorCodigo",
      "numeroDocumento"=EXCLUDED."numeroDocumento","numeroDocumentoFiscal"=EXCLUDED."numeroDocumentoFiscal",
      origem=EXCLUDED.origem,"dataEmissao"=EXCLUDED."dataEmissao","dataVencimento"=EXCLUDED."dataVencimento",
      "dataPrevisao"=EXCLUDED."dataPrevisao","linkStatus"=EXCLUDED."linkStatus",
      "rawPayload"=EXCLUDED."rawPayload","syncedAt"=EXCLUDED."syncedAt"`);
}

export async function syncOmiePurchases({ triggeredBy = 'SCRIPT', sinceDays = null, db = null, call = null, requestDelayMs = 100 } = {}) {
  db ??= (await import('../prisma.js')).default;
  call ??= (await import('./client.js')).omieCall;
  const run = await db.integrationSyncRun.create({
    data: { integration: 'OMIE', scope: 'purchases', status: 'RUNNING', triggeredBy }
  });
  try {
    if (!Number.isInteger(requestDelayMs) || requestDelayMs < 0 || requestDelayMs > 10_000) {
      throw new Error('Pausa entre consultas Omie deve ser um inteiro de 0 a 10000 ms.');
    }
    const [categories, projects] = await Promise.all([
      db.omieCategory.findMany({ select: { codigo: true, descricao: true } }),
      db.omieProject.findMany({
        where: {
          AND: [{ OR: [{ projectId: null }, { project: projectChannelWhere('omie') }] }],
          OR: [{ projectId: { not: null } }, { osNumber: { in: SEDE_OMIE_CODES } }, { codigo: { in: SEDE_OMIE_CODES } }]
        },
        select: { codigo: true, osNumber: true, projectId: true }
      })
    ]);
    const linked = new Map(projects.map(project => [project.codigo, project]));
    for (const codigo of SEDE_OMIE_CODES) {
      if (!linked.has(codigo)) linked.set(codigo, { codigo, osNumber: codigo, projectId: null });
    }
    const codes = [...linked.keys()];
    const existing = await db.omiePurchase.findMany({ where: {
      AND: [
        { OR: [{ codigoProjeto: { in: codes } }, { project: { is: projectChannelWhere('omie') } }] },
        { OR: [{ projectId: null }, { project: { is: projectChannelWhere('omie') } }] }
      ]
    }, select: { id: true, omieId: true, syncedAt: true } });
    const { purchases, removals, read, summary: readSummary } = await readPurchaseSnapshot({
      call, linked, categoryNames: new Map(categories.map(category => [category.codigo, category.descricao])),
      existing, requestDelayMs
    });
    const tracked = [...linked.values()];
    const projectsCount = tracked.filter(project => project.projectId).length;
    const sedeCenters = tracked.filter(project => !project.projectId && isSedeCostCenterCode(project.osNumber ?? project.codigo)).length;
    const summary = { mode: 'FULL_SNAPSHOT', incremental: false, requestedSinceDays: sinceDays,
      linkedProjects: projectsCount, sedeCenters, ...readSummary };
    // Só publique após validar TODAS as páginas. Exclusões, alterações e os
    // marcadores são atômicos; uma falha no banco desfaz também a limpeza.
    return await db.$transaction(async tx => {
      // Serializa publicação entre worker/script. Um ciclo antigo que terminar
      // depois de outro já publicado não pode restaurar custos obsoletos.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('omie-purchases-snapshot'))::text`;
      const newerRun = await tx.integrationSyncRun.findFirst({ where: {
        integration: 'OMIE', scope: 'purchases', status: 'SUCCESS', startedAt: { gt: run.startedAt }
      }, select: { id: true } });
      const finishedAt = new Date();
      let deleted = 0;
      if (!newerRun) {
        // Só exclua ausências confirmadas na API. O timestamp impede apagar um
        // registro atualizado por outra execução enquanto consultávamos o Omie.
        for (let offset = 0; offset < removals.length; offset += 500) {
          const result = await tx.omiePurchase.deleteMany({ where: {
            OR: removals.slice(offset, offset + 500).map(row => ({ id: row.id, syncedAt: row.syncedAt }))
          } });
          deleted += result.count;
        }
        for (let offset = 0; offset < purchases.length; offset += 500) {
          await writeBatch(tx, purchases.slice(offset, offset + 500), finishedAt);
        }
        await tx.omieProject.updateMany({
          where: { codigo: { in: codes }, projectId: { not: null }, project: projectChannelWhere('omie') },
          data: { purchasesBackfilledAt: finishedAt }
        });
      }
      const written = newerRun ? 0 : purchases.length;
      await tx.integrationSyncRun.update({ where: { id: run.id }, data: {
        status: 'SUCCESS', finishedAt, recordsRead: read, recordsWritten: written,
        summary: { ...summary, recordsDeleted: deleted, superseded: Boolean(newerRun) }
      } });
      return { read, written, deleted, projects: projectsCount, sedeCenters, superseded: Boolean(newerRun) };
    }, { timeout: 60_000 });
  } catch (error) {
    await db.integrationSyncRun.update({ where: { id: run.id }, data: {
      status: 'ERROR', finishedAt: new Date(), error: error.message
    } });
    throw error;
  }
}
