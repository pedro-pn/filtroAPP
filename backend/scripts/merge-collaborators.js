// Unifica dois cadastros da mesma pessoa: tudo do colaborador removido passa ao mantido.
//
// Uso (dentro do container do backend):
//   node scripts/merge-collaborators.js --keep <código-mantido> --remove <código-removido>                 # dry-run
//   node scripts/merge-collaborators.js --keep <código-mantido> --remove <código-removido> --apply --backup /tmp/merge.json
//
// Garantias:
// - Uma única transação: qualquer conflito (ex.: UNIQUE) desfaz tudo.
// - As FKs para "Collaborator" vêm do catálogo do banco, não de uma lista fixa.
// - Referências sem FK conhecidas (ConectaRhAggregate.localId, WorkforceClassificationEvent.entityId)
//   são migradas; antes de apagar, todas as colunas text/json são varridas e qualquer
//   resto do id removido aborta a operação.
// - O dry-run executa tudo e desfaz no final, mostrando os números reais.
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROLLBACK = Symbol('dry-run rollback');

// Dados de RH/identidade do cadastro removido preenchem apenas lacunas do mantido.
const FILL_IF_EMPTY = [
  'email', 'cpf', 'registrationNumber', 'admissionDate', 'terminationDate', 'signatureImage',
  'signatureNoticeAcceptedAt', 'signatureNoticeVersion', 'rhEmploymentId', 'rhFirstReceivedAt',
  'rhStatus', 'sourceIsOperational', 'workforceSector', 'efetivoNote'
];

const normalizeName = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .trim().toLowerCase().replace(/\s+/g, ' ');

/** Campos a gravar no colaborador mantido. `currentJobRoleId` = cargo do histórico mais recente. */
export function mergedCollaboratorFields(keep, remove, currentJobRoleId) {
  const data = {};
  for (const field of FILL_IF_EMPTY) {
    if ((keep[field] === null || keep[field] === undefined || keep[field] === '') && remove[field] !== null && remove[field] !== undefined && remove[field] !== '') {
      data[field] = remove[field];
    }
  }
  if (data.admissionDate) data.admissionDateProvisional = remove.admissionDateProvisional;
  if (!keep.isActive && remove.isActive) data.isActive = true;
  if (!keep.workforceClassificationOverride && remove.workforceClassificationOverride) {
    data.workforceClassificationOverride = remove.workforceClassificationOverride;
  }
  if (currentJobRoleId && currentJobRoleId !== keep.jobRoleId) data.jobRoleId = currentJobRoleId;
  return data;
}

function parseArgs(argv) {
  const args = { apply: false, allowDifferentNames: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--allow-different-names') args.allowDifferentNames = true;
    else if (['--keep', '--remove', '--backup', '--actor'].includes(argv[i])) args[argv[i].slice(2)] = argv[++i];
    else throw new Error(`Argumento desconhecido: ${argv[i]}`);
  }
  if (!args.keep || !args.remove) throw new Error('Informe --keep <código> e --remove <código>.');
  if (args.keep === args.remove) throw new Error('--keep e --remove devem ser diferentes.');
  if (args.apply && !args.backup) throw new Error('--apply exige --backup /caminho/arquivo.json (arquivo novo).');
  return args;
}

const quote = identifier => `"${String(identifier).replace(/"/g, '""')}"`;

// pg_constraint, não information_schema: com o papel de privilégio mínimo do app,
// constraint_column_usage só lista tabelas das quais o usuário é dono (retornaria vazio).
async function collaboratorForeignKeys(tx) {
  return tx.$queryRawUnsafe(`
    SELECT src.relname AS "table", att.attname AS "column"
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = src.relnamespace AND ns.nspname = 'public'
    JOIN pg_class ref ON ref.oid = con.confrelid AND ref.relname = 'Collaborator'
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
    ORDER BY 1, 2`);
}

async function remainingReferences(tx, id) {
  const columns = await tx.$queryRawUnsafe(`
    SELECT c.table_name AS "table", c.column_name AS "column"
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY')`);
  const found = [];
  for (const { table, column } of columns) {
    // O próprio cadastro e ids de eventos (texto histórico que embute o id) não são referências vivas.
    if (table === 'Collaborator' || (table === 'WorkforceClassificationEvent' && column === 'id')) continue;
    const [{ count }] = await tx.$queryRawUnsafe(
      `SELECT count(*)::int AS count FROM ${quote(table)} WHERE ${quote(column)}::text LIKE $1`, `%${id}%`);
    if (count > 0) found.push({ table, column, count });
  }
  return found;
}

export async function mergeCollaborators(tx, { keepCode, removeCode, allowDifferentNames = false, actorUserId = null }) {
  const [keep, remove] = await Promise.all([
    tx.collaborator.findUnique({ where: { code: keepCode } }),
    tx.collaborator.findUnique({ where: { code: removeCode } })
  ]);
  if (!keep) throw new Error(`Colaborador ${keepCode} não encontrado.`);
  if (!remove) throw new Error(`Colaborador ${removeCode} não encontrado.`);
  if (!allowDifferentNames && normalizeName(keep.name) !== normalizeName(remove.name)) {
    throw new Error(`Nomes diferentes (${keep.name} × ${remove.name}). Use --allow-different-names se for a mesma pessoa.`);
  }
  const [keepRh, removeRh] = await Promise.all([
    tx.conectaRhPerson.findUnique({ where: { collaboratorId: keep.id } }),
    tx.conectaRhPerson.findUnique({ where: { collaboratorId: remove.id } })
  ]);
  if (keepRh && removeRh) throw new Error('Os dois cadastros já estão vinculados ao Conecta; unificação manual necessária.');

  const moved = {};
  for (const { table, column } of await collaboratorForeignKeys(tx)) {
    const count = await tx.$executeRawUnsafe(
      `UPDATE ${quote(table)} SET ${quote(column)} = $1 WHERE ${quote(column)} = $2`, keep.id, remove.id);
    if (count) moved[`${table}.${column}`] = count;
  }
  const aggregates = await tx.conectaRhAggregate.updateMany({ where: { localId: remove.id }, data: { localId: keep.id } });
  if (aggregates.count) moved['ConectaRhAggregate.localId'] = aggregates.count;
  const events = await tx.workforceClassificationEvent.updateMany({
    where: { entityType: 'COLLABORATOR', entityId: remove.id }, data: { entityId: keep.id }
  });
  if (events.count) moved['WorkforceClassificationEvent.entityId'] = events.count;

  const remaining = await remainingReferences(tx, remove.id);
  if (remaining.length) {
    throw new Error(`Referências sem FK ao cadastro removido; nada foi alterado: ${JSON.stringify(remaining)}`);
  }

  const currentRole = await tx.collaboratorJobRoleHistory.findFirst({
    where: { collaboratorId: keep.id }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }], select: { jobRoleId: true }
  });
  const data = mergedCollaboratorFields(keep, remove, currentRole?.jobRoleId);
  await tx.collaborator.delete({ where: { id: remove.id } });
  const updated = await tx.collaborator.update({
    where: { id: keep.id }, data: { ...data, classificationVersion: { increment: 1 } }
  });
  await tx.workforceClassificationEvent.create({ data: {
    entityType: 'COLLABORATOR', entityId: keep.id, actorUserId,
    reason: `Unificação de cadastros: ${remove.code} incorporado a ${keep.code} (mesma pessoa).`,
    before: { removedCode: remove.code, removedId: remove.id, jobRoleId: keep.jobRoleId },
    after: { fields: Object.keys(data), jobRoleId: updated.jobRoleId }
  } });
  return { keep: { id: keep.id, code: keep.code }, removed: { id: remove.id, code: remove.code },
    moved, updatedFields: Object.keys(data), jobRoleId: updated.jobRoleId, before: { keep, remove } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { default: prisma } = await import('../src/lib/prisma.js');
  const backup = args.apply ? await open(args.backup, 'wx') : null;
  let report;
  try {
    await prisma.$transaction(async tx => {
      report = await mergeCollaborators(tx, {
        keepCode: args.keep, removeCode: args.remove, allowDifferentNames: args.allowDifferentNames, actorUserId: args.actor || null
      });
      if (!args.apply) throw ROLLBACK;
      await backup.writeFile(JSON.stringify(report.before, null, 2));
    }, { timeout: 120_000, isolationLevel: 'Serializable' });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  } finally {
    await backup?.close();
    await prisma.$disconnect();
  }
  const { before, ...summary } = report;
  console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run (nada gravado)', ...summary }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
