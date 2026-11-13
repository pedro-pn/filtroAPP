import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { isSedeCostCenterCode, SEDE_OMIE_CODES } from '../acompanhamento/sede-cost-centers.js';
import { projectChannelWhere } from '../projects/distribution.js';

const text = value => value == null ? null : String(value).trim() || null;
const canceled = value => /CANCELAD[OA]|CANCELLED|CANCELED|^C$/i.test(text(value) ?? '');
const validId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function parseDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = match && `${match[3]}-${match[2]}-${match[1]}`;
  const date = iso && new Date(`${iso}T00:00:00.000Z`);
  if (!date || Number.isNaN(+date) || !date.toISOString().startsWith(iso)) {
    throw new Error('Data inválida no histórico de compras Omie; versão anterior preservada.');
  }
  return date;
}

// Exclusões não aparecem na janela de alterações. Leia sem filtros de data,
// projeto ou status, inclusive títulos antigos, pagos e de projetos inativos.
async function readSnapshot(call, linked, categoryNames) {
  let pages = 1;
  let total = null;
  let read = 0;
  let canceledIgnored = 0;
  const seen = new Set();
  const purchases = [];
  for (let page = 1; page <= pages; page++) {
    const response = await call('/financas/contapagar/', 'ListarContasPagar', {
      pagina: page, registros_por_pagina: 50, apenas_importado_api: 'N',
      ordenar_por: 'CODIGO', ordem_descrescente: 'N'
    });
    const pageCount = Number(response.total_de_paginas);
    const recordCount = Number(response.total_de_registros);
    const rows = response.conta_pagar_cadastro;
    if (Number(response.pagina) !== page || !Number.isInteger(pageCount) || pageCount < 0
      || !Number.isInteger(recordCount) || recordCount < 0 || !Array.isArray(rows)
      || Number(response.registros) !== rows.length
      || (recordCount === 0 ? pageCount > 1 || rows.length !== 0 : pageCount < page || rows.length === 0)
      || (total !== null && (recordCount !== total || pageCount !== pages))) {
      throw new Error('Paginação incompleta ou alterada de ListarContasPagar; versão anterior preservada.');
    }
    pages = pageCount;
    total = recordCount;
    for (const row of rows) {
      if (!validId(row.codigo_lancamento_omie) || seen.has(String(row.codigo_lancamento_omie))) {
        throw new Error('Identificador inválido ou repetido de ListarContasPagar; versão anterior preservada.');
      }
      const omieId = String(row.codigo_lancamento_omie);
      seen.add(omieId);
      read++;
      const codigoProjeto = text(row.codigo_projeto);
      const project = linked.get(codigoProjeto);
      if (!project) continue;
      if (canceled(row.status_titulo)) { canceledIgnored++; continue; }
      if (row.valor_documento == null || row.valor_documento === '' || !Number.isFinite(Number(row.valor_documento))) {
        throw new Error('Valor inválido no histórico de compras Omie; versão anterior preservada.');
      }
      const categoriaCodigo = text(row.codigo_categoria);
      purchases.push({
        id: randomUUID(), omieId, codigoProjeto, projectId: project.projectId ?? null,
        osNumber: project.osNumber ?? null, valor: Number(row.valor_documento),
        statusTitulo: text(row.status_titulo), categoriaCodigo,
        categoriaDescricao: categoryNames.get(categoriaCodigo) ?? null,
        fornecedorCodigo: text(row.codigo_cliente_fornecedor),
        numeroDocumento: text(row.numero_documento), numeroDocumentoFiscal: text(row.numero_documento_fiscal),
        origem: text(row.id_origem), dataEmissao: parseDate(row.data_emissao),
        dataVencimento: parseDate(row.data_vencimento), dataPrevisao: parseDate(row.data_previsao),
        linkStatus: project.projectId ? 'LINKED' : isSedeCostCenterCode(project.osNumber ?? codigoProjeto) ? 'SEDE' : 'UNMATCHED',
        rawPayload: row
      });
    }
  }
  if (read !== total) {
    throw new Error('Contagem incompleta de ListarContasPagar; versão anterior preservada.');
  }
  return { purchases, read, pages, canceledIgnored };
}

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

export async function syncOmiePurchases({ triggeredBy = 'SCRIPT', sinceDays = null, db = null, call = null } = {}) {
  db ??= (await import('../prisma.js')).default;
  call ??= (await import('./client.js')).omieCall;
  const run = await db.integrationSyncRun.create({
    data: { integration: 'OMIE', scope: 'purchases', status: 'RUNNING', triggeredBy }
  });
  try {
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
    const { purchases, read, pages, canceledIgnored } = await readSnapshot(call, linked,
      new Map(categories.map(category => [category.codigo, category.descricao])));
    const codes = [...linked.keys()];
    const tracked = [...linked.values()];
    const projectsCount = tracked.filter(project => project.projectId).length;
    const sedeCenters = tracked.filter(project => !project.projectId && isSedeCostCenterCode(project.osNumber ?? project.codigo)).length;
    const summary = { mode: 'FULL_SNAPSHOT', incremental: false, requestedSinceDays: sinceDays,
      linkedProjects: projectsCount, sedeCenters, pagesRead: pages, canceledIgnored };
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
        const existing = await tx.omiePurchase.findMany({ where: {
          AND: [
            { OR: [{ codigoProjeto: { in: codes } }, { project: { is: projectChannelWhere('omie') } }] },
            { OR: [{ projectId: null }, { project: { is: projectChannelWhere('omie') } }] }
          ]
        }, select: { id: true, omieId: true } });
        const currentIds = new Set(purchases.map(row => row.omieId));
        const obsolete = existing.filter(row => !currentIds.has(row.omieId));
        // Mantém cada DELETE abaixo do limite de parâmetros do PostgreSQL,
        // mesmo na primeira limpeza de um espelho com milhares de títulos.
        for (let offset = 0; offset < obsolete.length; offset += 500) {
          const result = await tx.omiePurchase.deleteMany({ where: {
            id: { in: obsolete.slice(offset, offset + 500).map(row => row.id) }
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
