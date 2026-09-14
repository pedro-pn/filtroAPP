#!/usr/bin/env node
// Correção pontual e manual. Não importar no servidor nem executar em migrações.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OLD_DATE = '2026-04-17T00:00:00.000Z';
export const CORRECT_DATE = '2026-04-01T00:00:00.000Z';
// PDF original conferido: Missão 5719 / RLQ nº 17 / Data: 01/04/2026.
export const SOURCE_SHA256 = '65784daf6b14b947ffe08d8c9f896945b15613ac9b195cd8dcbacea27911191f';
const SCRIPT = 'fix-rlq17-project-5719-date';
const include = {
  ...Object.fromEntries(['versions', 'reportSignatures', 'services', 'attachments', 'auditLogs']
    .map(relation => [relation, { orderBy: { id: 'asc' } }])),
  collaborators: { orderBy: { collaboratorId: 'asc' } }
};
const hash = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };

export function parseArgs(args) {
  let mode;
  const options = { apply: false, help: false };
  for (const arg of args) {
    if (arg === '--help') options.help = true;
    else if (arg === '--apply' || arg === '--dry-run') {
      check(!mode, 'Informe somente um modo: --dry-run ou --apply.');
      mode = arg;
      options.apply = arg === '--apply';
    } else if (arg.startsWith('--backup-dir=')) {
      check(!options.backupDir, 'Não repita --backup-dir.');
      options.backupDir = arg.slice('--backup-dir='.length);
      check(path.isAbsolute(options.backupDir), '--backup-dir exige um caminho absoluto.');
    } else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return options;
}

async function loadTarget(client) {
  const project = await client.project.findUnique({
    where: { code: '5719' }, select: { id: true, code: true, name: true, deletedAt: true }
  });
  check(project && project.deletedAt === null, 'Projeto 5719 não encontrado ou excluído.');
  check(project.code === '5719' && project.name.trim().toLowerCase() === 'ilha solteira', 'Identidade do projeto divergente.');
  const report = await client.report.findUnique({
    where: { projectId_reportType_sequenceNumber: { projectId: project.id, reportType: 'RLQ', sequenceNumber: 17 } }, include
  });
  check(report && report.deletedAt === null, 'RLQ 017 não encontrado ou excluído no projeto 5719.');
  check(report.projectId === project.id && report.reportType === 'RLQ' && report.sequenceNumber === 17, 'Identidade do relatório divergente.');
  check(report.status === 'SIGNED', 'O relatório não está SIGNED; revisar antes de corrigir.');
  check(report.specialConditions?.source === 'MANUAL_UPLOAD' && report.specialConditions?.serviceOnly === true,
    'O relatório não é um PDF de serviço importado manualmente.');
  check(!report.specialConditions?.parentRdoId && report.services.length === 0,
    'O relatório possui serviços próprios ou deriva de RDO; correção automática bloqueada.');
  check([OLD_DATE, CORRECT_DATE].includes(report.reportDate.toISOString()),
    'Data inesperada: só é permitida a correção de 17/04/2026 para 01/04/2026.');
  const active = report.versions.filter(version => version.status === 'ACTIVE');
  check(active.length === 1 && active[0].sourcePdfUrl && active[0].finalPdfUrl, 'Esperada uma versão ativa com PDF original e assinado.');
  check(report.reportSignatures.some(signature => signature.versionId === active[0].id && signature.status === 'SIGNED'),
    'Assinatura concluída da versão ativa não encontrada.');
  return { project, report, activeVersion: active[0] };
}

function assertInside(root, candidate) {
  const relative = path.relative(root, candidate);
  check(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'Caminho de PDF fora de REPORTS_DIR; correção bloqueada.');
}

export async function snapshotTarget(target, reportsDir) {
  const root = await realpath(reportsDir);
  const { reportDate, updatedAt, ...protectedData } = target.report;
  const urls = [...new Set(target.report.versions.flatMap(version => [version.sourcePdfUrl, version.finalPdfUrl]).filter(Boolean))].sort();
  const files = [];
  for (const url of urls) {
    check(typeof url === 'string' && !path.isAbsolute(url) && !/^[a-z][a-z\d+.-]*:/i.test(url), 'Esperado um PDF local relativo a REPORTS_DIR.');
    const absolute = path.resolve(root, url);
    assertInside(root, absolute);
    const resolved = await realpath(absolute);
    assertInside(root, resolved);
    const bytes = await readFile(resolved);
    check(bytes.length > 0, 'PDF vazio; correção bloqueada.');
    files.push({ path: url, bytes: bytes.length, sha256: hash(bytes) });
  }
  for (const version of target.report.versions) {
    for (const [url, storedHash] of [[version.sourcePdfUrl, version.sourceDocumentHash], [version.finalPdfUrl, version.finalDocumentHash]]) {
      if (url && storedHash) check(files.find(file => file.path === url)?.sha256 === storedHash, 'Hash do PDF diverge do registrado na versão.');
    }
  }
  const protectedHash = hash({ project: target.project, report: protectedData });
  const integrityHash = hash({ protectedHash, files });
  // Só metadados e hashes: não exportar tokens, imagens de assinaturas ou dados dos signatários.
  return {
    projectId: target.project.id, projectCode: target.project.code,
    reportId: target.report.id, reportType: 'RLQ', sequenceNumber: 17,
    reportDate: reportDate.toISOString(), updatedAt: updatedAt.toISOString(), status: target.report.status,
    signatureCount: target.report.reportSignatures.length,
    versionCount: target.report.versions.length, protectedHash, files, integrityHash
  };
}

async function writeReceipt(file, data) {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`);
    await handle.sync();
  } finally { await handle.close(); }
}

export async function runCorrection({
  client, reportsDir, apply = false, backupDir = path.join(reportsDir, 'maintenance-corrections'),
  log = message => console.log(message),
  // Injeção apenas para testes com PDFs sintéticos; a CLI sempre usa o hash fixo acima.
  expectedSourceSha256 = SOURCE_SHA256
}) {
  const target = await loadTarget(client);
  const before = await snapshotTarget(target, reportsDir);
  check(before.files.find(file => file.path === target.activeVersion.sourcePdfUrl)?.sha256 === expectedSourceSha256,
    'O PDF original não é o documento conferido (SHA-256 divergente). Não aplique a correção sem nova análise.');
  log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', before, targetDate: CORRECT_DATE }, null, 2));
  if (before.reportDate === CORRECT_DATE) {
    log('ALREADY_CORRECT: data já corrigida; nenhuma gravação realizada.');
    return { status: 'ALREADY_CORRECT', updatedRecords: 0, before };
  }
  if (!apply) {
    log('READY: simulação concluída sem gravações. Use --apply para corrigir somente a data.');
    return { status: 'READY', updatedRecords: 0, before };
  }

  // Falha ao persistir a conferência impede qualquer alteração no banco.
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const receiptDir = await mkdtemp(path.join(backupDir, `${SCRIPT}-`));
  await writeReceipt(path.join(receiptDir, 'before.json'), {
    script: SCRIPT, createdAt: new Date().toISOString(), state: 'PREPARED', targetDate: CORRECT_DATE, before
  });
  log(`Registro prévio salvo em ${receiptDir}/before.json`);

  const after = await client.$transaction(async tx => {
    const current = await snapshotTarget(await loadTarget(tx), reportsDir);
    check(hash(current) === hash(before), 'O relatório, projeto ou PDFs mudaram desde a conferência; nenhuma correção aplicada.');
    const update = await tx.report.updateMany({
      where: {
        id: before.reportId, projectId: before.projectId, reportType: 'RLQ', sequenceNumber: 17,
        reportDate: new Date(OLD_DATE), updatedAt: new Date(before.updatedAt), status: 'SIGNED', deletedAt: null
      },
      data: { reportDate: new Date(CORRECT_DATE) }
    });
    check(update.count === 1, 'Atualização concorrente detectada; transação cancelada.');
    const result = await snapshotTarget(await loadTarget(tx), reportsDir);
    check(result.reportDate === CORRECT_DATE && result.integrityHash === before.integrityHash,
      'Conferência de integridade falhou; transação cancelada.');
    return result;
  }, { isolationLevel: 'Serializable', timeout: 20000 });

  // A transação já foi confirmada: eventuais falhas daqui em diante não significam rollback.
  log('COMMITTED: data corrigida para 01/04/2026. PDFs e assinaturas preservados na transação.');
  try {
    const persisted = await snapshotTarget(await loadTarget(client), reportsDir);
    check(hash(persisted) === hash(after), 'O registro mudou depois do commit.');
    await writeReceipt(path.join(receiptDir, 'result.json'), {
      script: SCRIPT, checkedAt: new Date().toISOString(), state: 'COMMITTED_VERIFIED', updatedRecords: 1,
      pdfAndSignaturesUnchanged: true, before, after: persisted
    });
    log(`VERIFIED: conferência pós-commit concluída. Auditoria: ${receiptDir}/result.json`);
    return { status: 'CORRECTED', updatedRecords: 1, receiptDir, before, after: persisted };
  } catch (error) {
    throw new Error(`A data FOI corrigida, mas a conferência/gravação final falhou. Consulte ${receiptDir}/before.json e execute --dry-run novamente. Motivo: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Uso: node scripts/${SCRIPT}.js [--dry-run | --apply] [--backup-dir=/caminho/absoluto]
Sem argumentos: somente conferência, sem gravações.
Corrige exclusivamente o RLQ 017 do projeto 5719: 17/04/2026 → 01/04/2026.
O PDF deve coincidir com o original já conferido. Não altera arquivos nem assinaturas.
Em --apply, salva auditoria em REPORTS_DIR/maintenance-corrections por padrão.
Não é executado automaticamente no deploy. Leia docs/CORRECAO_RLQ_017_PROJETO_5719.md.`);
    return;
  }
  const [{ default: client }, { default: env }] = await Promise.all([
    import('../src/lib/prisma.js'), import('../src/config/env.js')
  ]);
  try { await runCorrection({ client, reportsDir: env.reportsDir, ...options }); }
  finally { await client.$disconnect(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Correção interrompida: ${error.message}`);
    process.exitCode = 1;
  });
}
