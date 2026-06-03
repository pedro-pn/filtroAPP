import fs from 'node:fs';
import path from 'node:path';

import env from '../src/config/env.js';
import prisma from '../src/lib/prisma.js';
import { normalizeReportUploadReference } from '../src/lib/report-upload-attachments.js';
import { normalizeRelativeUploadPath } from '../src/lib/transient-upload-access.js';

const apply = process.argv.includes('--apply');
const help = process.argv.includes('--help') || process.argv.includes('-h');

function argValue(name, fallback = '') {
  const arg = process.argv.find(item => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1).trim() : fallback;
}

const projectFilter = argValue('--project').toLowerCase();
const reportFilter = argValue('--report').toLowerCase();
const limit = Math.max(1, Number(argValue('--limit', '50')) || 50);
const only = argValue('--only').toLowerCase();
const manualAttachmentId = argValue('--attachment-id');
const manualNewPath = argValue('--new-path');

if (help) {
  console.log(`Uso: npm run repair:report-file-paths -- [opcoes]

Opcoes:
  --dry-run             Modo padrao; lista reparos sem alterar o banco
  --apply               Aplica somente reparos com candidato unico e seguro
  --project=texto       Filtra por codigo/nome do projeto
  --report=RDO29        Filtra por relatorio, ex.: RDO29, RCPU11
  --only=ambiguous      Mostra somente amostras ambiguas
  --only=unmatched      Mostra somente amostras sem candidato automatico
  --attachment-id=ID    Seleciona uma referencia especifica para reparo manual
  --new-path=caminho    Caminho escolhido para --attachment-id
  --limit=N             Limite de amostras por categoria (padrao: 50)
  --help, -h            Mostra esta ajuda
`);
  process.exit(0);
}

function text(value) {
  return String(value ?? '').trim();
}

function safePath(value) {
  return text(value).replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function projectFolderName(project) {
  if (!project) return '';
  return safePath(`Missão ${project.code || ''} - ${project.name || ''}`);
}

function projectKey(project) {
  return project?.id || projectLabel(project);
}

function reportLabel(report) {
  if (!report) return 'sem relatorio';
  return `${report.reportType || 'REL'} ${report.sequenceNumber ?? report.id}`;
}

function reportKey(report) {
  return report?.id || reportLabel(report);
}

function compactReportLabel(report) {
  return reportLabel(report).replace(/\s+/g, '').toLowerCase();
}

function projectLabel(project) {
  if (!project) return 'sem projeto';
  return `${project.code || '---'} - ${project.name || 'Sem nome'}`;
}

function relativePathForAbsolute(filePath) {
  return normalizeRelativeUploadPath(path.relative(env.reportsDir, filePath).split(path.sep).join('/'));
}

function walkFiles(root) {
  const files = [];
  if (!root || !fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function listReportFolders() {
  if (!fs.existsSync(env.reportsDir)) return [];
  return fs.readdirSync(env.reportsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
}

function normalizeSearchName(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function fileStem(value) {
  return path.basename(text(value), path.extname(text(value)));
}

function leadingNumber(value) {
  const match = path.basename(text(value)).match(/^(\d+)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function naturalPathCompare(left, right) {
  return text(left.storagePath || left).localeCompare(text(right.storagePath || right), 'pt-BR', {
    numeric: true,
    sensitivity: 'base'
  });
}

function firstPathSegment(value) {
  return normalizeRelativeUploadPath(value).split('/').filter(Boolean)[0] || '';
}

function projectFolderCandidates(project, storagePath, reportFolders) {
  const candidates = [
    projectFolderName(project),
    firstPathSegment(storagePath)
  ];
  const missionPrefix = normalizeSearchName(`Missão ${project?.code || ''} -`);
  if (missionPrefix) {
    candidates.push(...reportFolders.filter(folder => normalizeSearchName(folder).startsWith(missionPrefix)));
  }
  return [...new Set(candidates.filter(Boolean))];
}

function urlForStoragePath(storagePath) {
  return `/relatorios/${normalizeRelativeUploadPath(storagePath)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')}`;
}

function isUploadObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function replaceUploadReferences(value, oldPath, newPath) {
  let changed = false;
  const oldNormalized = normalizeRelativeUploadPath(oldPath);
  const newUrl = urlForStoragePath(newPath);
  const newStoragePath = normalizeRelativeUploadPath(newPath);

  function visit(node) {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isUploadObject(node)) return;

    for (const key of ['url', 'storagePath', 'path', 'publicUrl']) {
      const current = text(node[key]);
      if (!current) continue;
      const normalized = normalizeReportUploadReference(current);
      if (normalized === oldNormalized) {
        node[key] = key === 'url' || key === 'publicUrl' ? newUrl : newStoragePath;
        changed = true;
      }
    }

    for (const value of Object.values(node)) visit(value);
  }

  const next = cloneJson(value);
  visit(next);
  return { changed, value: next };
}

function uniqueByPath(candidates) {
  const seen = new Set();
  return candidates.filter(candidate => {
    if (seen.has(candidate.storagePath)) return false;
    seen.add(candidate.storagePath);
    return true;
  });
}

function filesToRecords(files) {
  return files.map(filePath => ({
    filePath,
    storagePath: relativePathForAbsolute(filePath),
    base: path.basename(filePath).toLowerCase(),
    stem: normalizeSearchName(fileStem(filePath))
  }));
}

function extractReportDocumentDescriptor(file, report) {
  const reportType = text(report?.reportType).toUpperCase();
  const sequenceNumber = text(report?.sequenceNumber);
  if (!reportType || !sequenceNumber) return '';
  const base = path.basename(file.storagePath, path.extname(file.storagePath));
  const marker = `${reportType} ${sequenceNumber} - `;
  const index = normalizeSearchName(base).indexOf(normalizeSearchName(marker));
  if (index === -1) return '';
  return base.slice(index + marker.length).trim();
}

function organizedPhotoCandidates(report, files) {
  const reportType = text(report?.reportType).toUpperCase();
  if (!reportType) return [];

  const records = filesToRecords(files);
  const reportTypeFolder = normalizeSearchName(`/Registros Fotográficos/${reportType}/`);
  const documentFolder = normalizeSearchName(`/${reportType}/`);
  const documents = records.filter(file => {
    const normalizedPath = normalizeSearchName(`/${file.storagePath}`);
    return normalizedPath.includes(documentFolder) && /\.(pdf|docx)$/i.test(file.storagePath);
  });
  const descriptors = [...new Set(documents
    .map(file => extractReportDocumentDescriptor(file, report))
    .filter(Boolean)
    .map(descriptor => normalizeSearchName(descriptor)))];

  if (!descriptors.length) return [];

  return uniqueByPath(records.filter(file => {
    const normalizedPath = normalizeSearchName(`/${file.storagePath}`);
    const normalizedBase = normalizeSearchName(fileStem(file.storagePath));
    return normalizedPath.includes(reportTypeFolder)
      && descriptors.some(descriptor => normalizedBase.startsWith(`${descriptor} - foto `));
  })).sort(naturalPathCompare);
}

function chooseCandidate(attachment, files, existingAttachmentCandidates = []) {
  const currentPath = normalizeRelativeUploadPath(attachment.storagePath);
  const currentBase = path.basename(currentPath).toLowerCase();
  const fileName = text(attachment.fileName);
  const fileNameBase = path.basename(fileName).toLowerCase();
  const fileNameStem = normalizeSearchName(fileStem(fileName));

  const sameExistingFileName = uniqueByPath(existingAttachmentCandidates
    .filter(candidate => path.basename(candidate.fileName).toLowerCase() === fileNameBase));
  if (sameExistingFileName.length === 1) {
    return { status: 'repairable', strategy: 'existing_attachment_fileName', candidate: sameExistingFileName[0] };
  }
  if (sameExistingFileName.length > 1) {
    return { status: 'ambiguous', strategy: 'existing_attachment_fileName', candidates: sameExistingFileName };
  }

  const fileRecords = filesToRecords(files);

  const sameBase = uniqueByPath(fileRecords.filter(file => file.base === currentBase));
  if (sameBase.length === 1) return { status: 'repairable', strategy: 'same_basename', candidate: sameBase[0] };
  if (sameBase.length > 1) return { status: 'ambiguous', strategy: 'same_basename', candidates: sameBase };

  const sameFileName = uniqueByPath(fileRecords.filter(file => file.base === fileNameBase));
  if (sameFileName.length === 1) return { status: 'repairable', strategy: 'same_fileName', candidate: sameFileName[0] };
  if (sameFileName.length > 1) return { status: 'ambiguous', strategy: 'same_fileName', candidates: sameFileName };

  if (fileNameStem && fileNameStem.length >= 8) {
    const containsStem = uniqueByPath(fileRecords.filter(file => file.stem.includes(fileNameStem) || fileNameStem.includes(file.stem)));
    if (containsStem.length === 1) return { status: 'repairable', strategy: 'fileName_stem', candidate: containsStem[0] };
    if (containsStem.length > 1) return { status: 'ambiguous', strategy: 'fileName_stem', candidates: containsStem };
  }

  return { status: 'unmatched', strategy: 'none', candidates: [] };
}

async function fetchAttachments() {
  return prisma.reportAttachment.findMany({
    select: {
      id: true,
      reportId: true,
      reportServiceId: true,
      createdAt: true,
      label: true,
      fileName: true,
      mimeType: true,
      storagePath: true,
      report: {
        select: {
          id: true,
          projectId: true,
          reportType: true,
          sequenceNumber: true,
          specialConditions: true,
          project: { select: { id: true, code: true, name: true } }
        }
      },
      reportService: {
        select: {
          id: true,
          extraData: true,
          report: {
            select: {
              id: true,
              projectId: true,
              reportType: true,
              sequenceNumber: true,
              specialConditions: true,
              project: { select: { id: true, code: true, name: true } }
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  });
}

async function applyRepair(repair) {
  const attachment = repair.attachment;
  const report = attachment.report || attachment.reportService?.report;
  const service = attachment.reportService || null;
  const newPath = repair.candidate.storagePath;
  const oldPath = attachment.storagePath;

  await prisma.$transaction(async tx => {
    await tx.reportAttachment.update({
      where: { id: attachment.id },
      data: { storagePath: newPath }
    });

    if (attachment.reportId && report?.specialConditions) {
      const nextSpecial = replaceUploadReferences(report.specialConditions, oldPath, newPath);
      if (nextSpecial.changed) {
        await tx.report.update({
          where: { id: report.id },
          data: { specialConditions: nextSpecial.value }
        });
      }
    }

    if (attachment.reportServiceId && service?.extraData) {
      const nextExtra = replaceUploadReferences(service.extraData, oldPath, newPath);
      if (nextExtra.changed) {
        await tx.reportService.update({
          where: { id: service.id },
          data: { extraData: nextExtra.value }
        });
      }
    }
  });
}

function printManualResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

function publicRepairItem(item) {
  const {
    attachment: _attachment,
    candidate: _candidate,
    candidates: rawCandidates,
    ...publicItem
  } = item;
  return {
    ...publicItem,
    ...(rawCandidates?.length ? { candidates: rawCandidates.slice(0, 10).map(candidate => candidate.storagePath || candidate) } : {})
  };
}

async function handleManualRepair(attachments, reportFolders) {
  if (!manualAttachmentId && !manualNewPath) return false;
  if (!manualAttachmentId || !manualNewPath) {
    throw new Error('Use --attachment-id e --new-path juntos para reparo manual.');
  }

  const attachment = attachments.find(item => item.id === manualAttachmentId);
  if (!attachment) {
    throw new Error(`ReportAttachment nao encontrado: ${manualAttachmentId}`);
  }

  const report = attachment.report || attachment.reportService?.report || null;
  const project = report?.project || null;
  const normalizedNewPath = normalizeRelativeUploadPath(manualNewPath);
  const newAbsolutePath = path.resolve(env.reportsDir, normalizedNewPath);
  const allowedFolders = projectFolderCandidates(project, attachment.storagePath, reportFolders);
  const newFolder = firstPathSegment(normalizedNewPath);

  if (!fs.existsSync(newAbsolutePath)) {
    throw new Error(`Arquivo escolhido nao existe em ${newAbsolutePath}`);
  }
  if (!allowedFolders.includes(newFolder)) {
    throw new Error(`Arquivo escolhido esta fora das pastas esperadas do projeto: ${allowedFolders.join(', ')}`);
  }

  const result = {
    mode: apply ? 'manual-apply' : 'manual-dry-run',
    applied: false,
    attachmentId: attachment.id,
    report: reportLabel(report),
    project: projectLabel(project),
    fileName: attachment.fileName,
    oldPath: attachment.storagePath,
    newPath: normalizedNewPath
  };

  if (apply) {
    await applyRepair({ attachment, candidate: { storagePath: normalizedNewPath } });
    result.applied = true;
  }

  printManualResult(result);
  return true;
}

async function main() {
  const attachments = await fetchAttachments();
  const existingCandidatesByProject = new Map();
  const filesByProjectFolder = new Map();
  const reportFolders = listReportFolders();
  const repairable = [];
  const ambiguous = [];
  const unmatched = [];
  let present = 0;
  let missing = 0;

  for (const attachment of attachments) {
    const report = attachment.report || attachment.reportService?.report || null;
    const project = report?.project || null;
    const key = projectKey(project);
    if (!key) continue;
    const currentPath = path.resolve(env.reportsDir, text(attachment.storagePath));
    if (!fs.existsSync(currentPath)) continue;
    const candidates = existingCandidatesByProject.get(key) || [];
    candidates.push({
      fileName: attachment.fileName,
      storagePath: normalizeRelativeUploadPath(attachment.storagePath),
      filePath: currentPath
    });
    existingCandidatesByProject.set(key, candidates);
  }

  if (await handleManualRepair(attachments, reportFolders)) return;

  function projectFilesForAttachment(attachment) {
    const report = attachment.report || attachment.reportService?.report || null;
    const project = report?.project || null;
    const folders = projectFolderCandidates(project, attachment.storagePath, reportFolders);
    return folders.flatMap(folder => {
      const folderPath = path.resolve(env.reportsDir, folder);
      if (!filesByProjectFolder.has(folder)) filesByProjectFolder.set(folder, walkFiles(folderPath));
      return filesByProjectFolder.get(folder);
    });
  }

  for (const attachment of attachments) {
    const report = attachment.report || attachment.reportService?.report || null;
    const project = report?.project || null;
    const projectName = projectLabel(project);
    const reportName = compactReportLabel(report);
    if (projectFilter && !projectName.toLowerCase().includes(projectFilter)) continue;
    if (reportFilter && !reportName.includes(reportFilter.replace(/\s+/g, '').toLowerCase())) continue;

    const currentPath = path.resolve(env.reportsDir, text(attachment.storagePath));
    if (fs.existsSync(currentPath)) {
      present += 1;
      continue;
    }
    missing += 1;

    const projectFiles = projectFilesForAttachment(attachment);
    const choice = chooseCandidate(attachment, projectFiles, existingCandidatesByProject.get(projectKey(project)) || []);
    const item = {
      attachmentId: attachment.id,
      report: reportLabel(report),
      project: projectName,
      fileName: attachment.fileName,
      oldPath: attachment.storagePath,
      strategy: choice.strategy,
      ...(choice.candidate ? { newPath: choice.candidate.storagePath } : {}),
      ...(choice.candidates?.length ? { candidates: choice.candidates.slice(0, 10).map(candidate => candidate.storagePath) } : {})
    };

    if (choice.status === 'repairable') {
      repairable.push({ ...item, attachment, candidate: choice.candidate });
    } else if (choice.status === 'ambiguous') {
      ambiguous.push(item);
    } else {
      unmatched.push({ ...item, attachment });
    }
  }

  const remainingUnmatched = [];
  const unmatchedByReport = new Map();
  for (const item of unmatched) {
    const report = item.attachment.report || item.attachment.reportService?.report || null;
    const key = reportKey(report);
    const items = unmatchedByReport.get(key) || [];
    items.push(item);
    unmatchedByReport.set(key, items);
  }

  for (const group of unmatchedByReport.values()) {
    const report = group[0]?.attachment.report || group[0]?.attachment.reportService?.report || null;
    const projectFiles = projectFilesForAttachment(group[0].attachment);
    const candidates = organizedPhotoCandidates(report, projectFiles);

    if (candidates.length && candidates.length === group.length) {
      const sortedGroup = [...group].sort((left, right) => {
        const leftNumber = leadingNumber(left.oldPath);
        const rightNumber = leadingNumber(right.oldPath);
        if (leftNumber !== rightNumber) return leftNumber - rightNumber;
        return naturalPathCompare(left.oldPath, right.oldPath);
      });
      const sortedCandidates = [...candidates].sort(naturalPathCompare);
      sortedGroup.forEach((item, index) => {
        repairable.push({
          ...item,
          strategy: 'organized_report_photos',
          newPath: sortedCandidates[index].storagePath,
          candidate: sortedCandidates[index]
        });
      });
    } else {
      remainingUnmatched.push(...group.map(item => ({
        ...item,
        ...(candidates.length ? { candidates } : {})
      })));
    }
  }

  if (apply) {
    for (const repair of repairable) {
      await applyRepair(repair);
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    reportsDir: env.reportsDir,
    projectFilter: projectFilter || null,
    reportFilter: reportFilter || null,
    present,
    missing,
    repairable: repairable.length,
    ambiguous: ambiguous.length,
    unmatched: remainingUnmatched.length,
    applied: apply ? repairable.length : 0,
    repairableSamples: only ? [] : repairable.slice(0, limit).map(publicRepairItem),
    ambiguousSamples: only === 'unmatched' ? [] : ambiguous.slice(0, limit),
    unmatchedSamples: only === 'ambiguous' ? [] : remainingUnmatched.slice(0, limit).map(publicRepairItem)
  }, null, 2));
}

main()
  .catch(error => {
    console.error('[repair-report-file-paths] erro', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
