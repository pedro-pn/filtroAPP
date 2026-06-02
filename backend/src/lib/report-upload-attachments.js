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

function uploadPathFromReference(value) {
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
    const storagePath = uploadPathFromReference(value);
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
  const storagePath = uploadPathFromReference(source);
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

export function extractReportUploadAttachments(report) {
  const records = [
    ...reportUploadRecords(report),
    ...(report?.services || []).flatMap(serviceUploadRecords)
  ];
  const seen = new Set();
  return records.filter(record => {
    const key = `${record.reportId || ''}:${record.reportServiceId || ''}:${record.storagePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  const attachments = extractReportUploadAttachments(report);
  const deleteWhere = serviceIds.length
    ? { OR: [{ reportId: report.id }, { reportServiceId: { in: serviceIds } }] }
    : { reportId: report.id };

  const deleted = await client.reportAttachment.deleteMany({ where: deleteWhere });
  if (attachments.length) {
    await client.reportAttachment.createMany({
      data: attachments.map(attachment => ({
        reportId: attachment.reportId,
        reportServiceId: attachment.reportServiceId,
        label: attachment.label,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        storagePath: attachment.storagePath
      }))
    });
  }

  return {
    reportId: report.id,
    deleted: deleted.count || 0,
    created: attachments.length
  };
}
