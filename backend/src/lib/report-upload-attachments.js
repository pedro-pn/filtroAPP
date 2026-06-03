import path from 'node:path';

import prisma from './prisma.js';
import { hasTransientUploadAccess, normalizeRelativeUploadPath } from './transient-upload-access.js';

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

function normalizePathSet(paths) {
  const set = new Set();
  for (const pathValue of paths || []) {
    const normalized = normalizeRelativeUploadPath(pathValue);
    if (normalized) set.add(normalized);
  }
  return set;
}

function existingAttachmentPaths(rows) {
  return normalizePathSet((rows || []).map(row => row.storagePath));
}

function attachmentKey(attachment) {
  return [
    attachment.reportId || '',
    attachment.reportServiceId || '',
    normalizeRelativeUploadPath(attachment.storagePath)
  ].join(':');
}

function trustedAttachmentPathsFromUrlMap(urlMap, { auth, trustedPaths }) {
  const next = new Set();
  if (!urlMap || typeof urlMap[Symbol.iterator] !== 'function') return next;

  for (const [source, target] of urlMap) {
    const sourcePath = normalizeReportUploadReference(source);
    const targetPath = normalizeReportUploadReference(target);
    if (!sourcePath || !targetPath) continue;
    if (trustedPaths.has(sourcePath) || (auth && hasTransientUploadAccess(sourcePath, auth))) {
      next.add(targetPath);
    }
  }

  return next;
}

function isTrustedAttachment(record, { auth, trustedPaths, trustLegacyProjectScoped }) {
  if (trustLegacyProjectScoped) return true;
  const normalizedPath = normalizeRelativeUploadPath(record.storagePath);
  return trustedPaths.has(normalizedPath) || Boolean(auth && hasTransientUploadAccess(normalizedPath, auth));
}

export async function syncReportUploadAttachments(client = prisma, reportOrId, options = {}) {
  const report = typeof reportOrId === 'string'
    ? await client.report.findUnique({
        where: { id: reportOrId },
        select: {
          id: true,
          project: {
            select: {
              code: true,
              name: true
            }
          },
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
  const trustedPaths = existingAttachmentPaths(existingRows);
  for (const pathValue of options.trustedStoragePaths || []) {
    const normalized = normalizeRelativeUploadPath(pathValue);
    if (normalized) trustedPaths.add(normalized);
  }
  for (const targetPath of trustedAttachmentPathsFromUrlMap(options.trustedUrlMap, {
    auth: options.auth,
    trustedPaths
  })) {
    trustedPaths.add(targetPath);
  }
  const attachments = extractReportUploadAttachments(report, { requireProjectScope: true })
    .filter(attachment => isTrustedAttachment(attachment, {
      auth: options.auth,
      trustedPaths,
      trustLegacyProjectScoped: options.trustLegacyProjectScoped === true
    }));

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

export function reportUploadAttachmentsNeedSync(report) {
  if (!report?.id) return false;
  const expected = extractReportUploadAttachments(report, { requireProjectScope: true });
  if (!expected.length) return false;

  const existing = new Set([
    ...(report.attachments || []).map(attachment => `report:${normalizeRelativeUploadPath(attachment.storagePath)}`),
    ...(report.services || []).flatMap(service => (
      service.attachments || []
    ).map(attachment => `service:${service.id}:${normalizeRelativeUploadPath(attachment.storagePath)}`))
  ]);

  return expected.some(attachment => {
    const normalizedPath = normalizeRelativeUploadPath(attachment.storagePath);
    const key = attachment.reportId
      ? `report:${normalizedPath}`
      : `service:${attachment.reportServiceId}:${normalizedPath}`;
    return !existing.has(key);
  });
}
