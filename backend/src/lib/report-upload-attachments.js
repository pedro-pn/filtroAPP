import path from 'node:path';

import prisma from './prisma.js';
import { normalizeRelativeUploadPath } from './transient-upload-access.js';

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safePath(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function projectFolderName(report) {
  const code = stringValue(report?.project?.code);
  const name = stringValue(report?.project?.name);
  if (!code || !name) return '';
  return safePath(`Missão ${code} - ${name}`);
}

function isProjectScopedAttachment(record, report) {
  const folder = projectFolderName(report);
  if (!folder) return false;
  const normalizedPath = normalizeRelativeUploadPath(record.storagePath);
  if (normalizedPath === folder || normalizedPath.startsWith(`${folder}/`)) return true;

  const code = safePath(stringValue(report?.project?.code));
  const firstFolder = normalizedPath.split('/').filter(Boolean)[0] || '';
  return Boolean(code && firstFolder.startsWith(`Missão ${code} - `));
}

// Identifica se uma string é uma referência a um arquivo de upload (URL absoluta,
// caminho servido por /relatorios|/uploads|/api/.../file, ou caminho relativo de
// projeto terminando num arquivo conhecido). Evita "canonicalizar" textos comuns
// (datas, nomes, descrições) que por acaso contenham "/".
export function looksLikeUploadReference(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:')) return false;
  if (/^https?:\/\//i.test(raw)) {
    return /\/(relatorios|uploads)\//i.test(raw) || /\/api\/(rdo\/)?uploads\/file\//i.test(raw);
  }
  // Protocol-relative (//host/...): só tratamos como upload se for um dos nossos
  // prefixos; URLs externas (//cdn.exemplo/...) são deixadas intactas.
  if (raw.startsWith('//')) {
    return /^\/\/(api\/(rdo\/)?uploads\/file|relatorios|uploads)\//i.test(raw);
  }
  if (/^\/?(api\/(rdo\/)?uploads\/file|relatorios|uploads)\//i.test(raw)) return true;
  return raw.includes('/') && /\.(jpe?g|png|gif|webp|heic|heif|dng|pdf)$/i.test(raw);
}

// Forma canônica única de uma referência de imagem: caminho relativo a reportsDir,
// percent-DECODED, com "/", sem scheme/host/prefixo. Idempotente.
export function canonicalizeUploadReference(value) {
  if (!looksLikeUploadReference(value)) return value;
  const canonical = normalizeReportUploadReference(value);
  return canonical || value;
}

function uploadReferenceOf(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return item.url || item.storagePath || item.path || item.publicUrl || item.href || item.src || '';
  }
  return '';
}

// Remove recursivamente toda referência (string ou objeto {url}) cujo caminho
// canônico seja igual a `targetCanonicalPath`, de qualquer array dentro do JSON
// (generalUploads, __uploads__.files, campos nomeados, serviceData, etc.).
export function removeUploadReferenceDeep(value, targetCanonicalPath) {
  if (!targetCanonicalPath) return value;
  if (Array.isArray(value)) {
    return value
      .filter(item => normalizeReportUploadReference(uploadReferenceOf(item)) !== targetCanonicalPath)
      .map(item => removeUploadReferenceDeep(item, targetCanonicalPath));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, removeUploadReferenceDeep(item, targetCanonicalPath)])
    );
  }
  return value;
}

// Percorre recursivamente specialConditions / extraData reescrevendo TODA referência
// de upload para a forma canônica, independentemente de onde ela esteja (generalUploads,
// __uploads__, campos nomeados como "Fotos do sistema", serviceData, etc.).
export function normalizeStoredReportUploadUrls(value) {
  if (typeof value === 'string') return canonicalizeUploadReference(value);
  if (Array.isArray(value)) return value.map(item => normalizeStoredReportUploadUrls(item));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeStoredReportUploadUrls(item)])
  );
}

export function normalizeReportUploadReference(value) {
  const raw = stringValue(value);
  if (!raw || raw.startsWith('data:')) return '';

  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return '';
    }
  }
  if (pathname.startsWith('//api/uploads/file/')) pathname = pathname.slice(1);
  if (pathname.startsWith('//api/rdo/uploads/file/')) pathname = pathname.slice(1);
  if (pathname.startsWith('//relatorios/')) pathname = pathname.slice(1);
  if (pathname.startsWith('//uploads/')) pathname = pathname.slice(1);

  if (pathname.startsWith('/api/uploads/file/')) return normalizeRelativeUploadPath(pathname.slice('/api/uploads/file/'.length));
  if (pathname.startsWith('/api/rdo/uploads/file/')) return normalizeRelativeUploadPath(pathname.slice('/api/rdo/uploads/file/'.length));
  if (pathname.startsWith('/relatorios/')) return normalizeRelativeUploadPath(pathname.slice('/relatorios/'.length));
  if (pathname.startsWith('/uploads/')) return normalizeRelativeUploadPath(pathname.slice('/uploads/'.length));
  if (pathname.startsWith('relatorios/')) return normalizeRelativeUploadPath(pathname.slice('relatorios/'.length));
  if (pathname.startsWith('uploads/')) return normalizeRelativeUploadPath(pathname.slice('uploads/'.length));
  if (pathname.includes('/')) return normalizeRelativeUploadPath(pathname);
  return '';
}

function uploadFileName(source, explicitName = '') {
  const name = stringValue(explicitName);
  if (name && name !== source) return name;
  const lastPart = normalizeRelativeUploadPath(source).split('/').filter(Boolean).pop() || '';
  return safeDecode(lastPart) || 'arquivo';
}

function mimeTypeFor(source, explicitMimeType = '') {
  const mimeType = stringValue(explicitMimeType);
  if (mimeType) return mimeType;
  const ext = path.extname(source).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

function uploadRecord(value, defaultLabel) {
  if (typeof value === 'string') {
    const storagePath = normalizeReportUploadReference(value);
    if (!storagePath) return null;
    return {
      label: defaultLabel,
      fileName: uploadFileName(value),
      mimeType: mimeTypeFor(value),
      storagePath
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value.url || value.storagePath || value.path || value.publicUrl || '';
  const storagePath = normalizeReportUploadReference(source);
  if (!storagePath) return null;

  return {
    label: stringValue(value.label) || defaultLabel,
    fileName: uploadFileName(source, value.fileName || value.name),
    mimeType: mimeTypeFor(source, value.mimeType),
    storagePath
  };
}

function reportUploadRecords(report) {
  const uploads = Array.isArray(report?.specialConditions?.generalUploads)
    ? report.specialConditions.generalUploads
    : [];
  return uploads
    .map(upload => uploadRecord(upload, 'Fotos de registro'))
    .filter(Boolean)
    .map(upload => ({ ...upload, reportId: report.id, reportServiceId: null }));
}

function serviceUploadRecords(service) {
  const groups = Array.isArray(service?.extraData?.__uploads__)
    ? service.extraData.__uploads__
    : [];
  const records = [];

  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    const label = stringValue(group.label) || 'Fotos do serviço';
    const files = Array.isArray(group.files) ? group.files : [];
    for (const file of files) {
      const record = uploadRecord(file, label);
      if (record) records.push({ ...record, reportId: null, reportServiceId: service.id });
    }
  }

  return records;
}

export function extractReportUploadAttachments(report, { requireProjectScope = false } = {}) {
  const records = [
    ...reportUploadRecords(report),
    ...(report?.services || []).flatMap(serviceUploadRecords)
  ].filter(record => !requireProjectScope || isProjectScopedAttachment(record, report));
  const seen = new Set();
  return records.filter(record => {
    const key = `${record.reportId || ''}:${record.reportServiceId || ''}:${record.storagePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attachmentKey(attachment) {
  return [
    attachment.reportId || '',
    attachment.reportServiceId || '',
    normalizeRelativeUploadPath(attachment.storagePath)
  ].join(':');
}

// Reconstrói o índice ReportAttachment 1:1 a partir das referências do JSON do
// relatório. O índice não é mais usado para autorizar acesso (isso agora é por
// escopo de projeto em authorizeStoredFile), então pode refletir exatamente o JSON
// — toda foto referenciada tem sua linha, sem gating de confiança.
export async function syncReportUploadAttachments(client = prisma, reportOrId) {
  const report = typeof reportOrId === 'string'
    ? await client.report.findUnique({
        where: { id: reportOrId },
        select: {
          id: true,
          specialConditions: true,
          services: {
            select: {
              id: true,
              extraData: true
            }
          }
        }
      })
    : reportOrId;
  if (!report?.id) return { reportId: reportOrId, deleted: 0, created: 0 };

  const serviceIds = (report.services || []).map(service => service.id).filter(Boolean);
  const deleteWhere = serviceIds.length
    ? { OR: [{ reportId: report.id }, { reportServiceId: { in: serviceIds } }] }
    : { reportId: report.id };
  const existingRows = await client.reportAttachment.findMany({
    where: deleteWhere,
    select: {
      id: true,
      reportId: true,
      reportServiceId: true,
      storagePath: true
    }
  });

  const attachments = extractReportUploadAttachments(report);
  const expectedKeys = new Set(attachments.map(attachmentKey));
  const existingKeys = new Set(existingRows.map(attachmentKey));
  const attachmentsToCreate = attachments.filter(attachment => !existingKeys.has(attachmentKey(attachment)));
  const staleIds = existingRows
    .filter(row => !expectedKeys.has(attachmentKey(row)))
    .map(row => row.id)
    .filter(Boolean);

  if (attachmentsToCreate.length) {
    await client.reportAttachment.createMany({
      data: attachmentsToCreate.map(attachment => ({
        reportId: attachment.reportId,
        reportServiceId: attachment.reportServiceId,
        label: attachment.label,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        storagePath: attachment.storagePath
      }))
    });
  }
  const deleted = staleIds.length
    ? await client.reportAttachment.deleteMany({ where: { id: { in: staleIds } } })
    : { count: 0 };

  return {
    reportId: report.id,
    deleted: deleted.count || 0,
    created: attachmentsToCreate.length
  };
}
