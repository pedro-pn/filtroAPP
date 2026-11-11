import { createHash } from 'node:crypto';
import { normalizeReportUploadReference } from '../report-upload-attachments.js';
const sha256Hex = value => createHash('sha256').update(value).digest('hex');
const ReportType = { RDO: 'RDO' };
function reportUpdatedAtToken(report) {
  if (!report?.updatedAt) return '';
  const date = new Date(report.updatedAt);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function calibrationCertificateUrlsForReport(report) {
  const sc = report?.specialConditions || {};
  const urls = [];
  if (Array.isArray(sc.resolvedManometers)) {
    urls.push(...sc.resolvedManometers.map(item => item?.certificate?.publicUrl));
  }
  urls.push(sc.resolvedCounter?.certificate?.publicUrl);
  return [...new Set(urls.map(url => String(url || '').trim()).filter(Boolean))];
}

function uploadFingerprintValue(value) {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return '';
    const normalized = normalizeReportUploadReference(raw);
    if (normalized) return normalized;
    return /^data:image\//i.test(raw) ? raw : '';
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const raw = String(
    value.url
    || value.storagePath
    || value.path
    || value.publicUrl
    || value.href
    || value.src
    || value.source
    || value.dataUrl
    || ''
  ).trim();
  if (raw) {
    const normalized = normalizeReportUploadReference(raw);
    if (normalized) return normalized;
    if (/^data:image\//i.test(raw)) return raw;
  }

  const fileName = String(value.fileName || value.name || '').trim();
  const mimeType = String(value.mimeType || '').trim().toLowerCase();
  return fileName && mimeType.startsWith('image/') ? fileName : '';
}

function addUploadFingerprint(urls, value) {
  const fingerprint = uploadFingerprintValue(value);
  if (fingerprint) urls.push(fingerprint);
}

function collectUploadFingerprintsFromGroups(urls, groups) {
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    if (!Array.isArray(group.files)) continue;
    for (const file of group.files) addUploadFingerprint(urls, file);
  }
}

function collectUploadFingerprintsFromServiceData(urls, serviceData) {
  if (!serviceData || typeof serviceData !== 'object' || Array.isArray(serviceData)) return;
  collectUploadFingerprintsFromGroups(urls, serviceData.__uploads__);
  for (const [key, value] of Object.entries(serviceData)) {
    if (key === '__uploads__') continue;
    if (Array.isArray(value)) {
      for (const item of value) addUploadFingerprint(urls, item);
    } else {
      addUploadFingerprint(urls, value);
    }
  }
}

export function pdfUploadUrlsForReport(report) {
  const urls = [];
  const special = report?.specialConditions || {};
  if (Array.isArray(special.generalUploads)) {
    for (const item of special.generalUploads) addUploadFingerprint(urls, item);
  }
  collectUploadFingerprintsFromServiceData(urls, special.serviceData);
  for (const attachment of report?.attachments || []) {
    addUploadFingerprint(urls, attachment);
  }
  for (const service of report?.services || []) {
    collectUploadFingerprintsFromGroups(urls, service?.extraData?.__uploads__);
    for (const attachment of service?.attachments || []) {
      addUploadFingerprint(urls, attachment);
    }
  }
  return [...new Set(urls.map(url => String(url || '').trim()).filter(Boolean))];
}

export function pdfCacheMetadataForReport(report) {
  return {
    // Bump whenever DOCX/PDF layout rules change so previously rendered files
    // are not served indefinitely with stale pagination or conditional blocks.
    version: report.reportType === ReportType.RDO ? 7 : 3,
    reportId: report.id,
    reportUpdatedAt: reportUpdatedAtToken(report),
    fingerprint: sha256Hex(JSON.stringify({
      photos: pdfUploadUrlsForReport(report).sort(),
      calibrationLinks: calibrationCertificateUrlsForReport(report).sort(),
      overtimeAccepted: report?.specialConditions?.overtimeAccepted !== false,
      daytimeOvertimeMinutes: report?.daytimeOvertimeMinutes || 0,
      nighttimeOvertimeMinutes: report?.nighttimeOvertimeMinutes || 0,
      overtimeReason: report?.overtimeReason || ''
    }))
  };
}

export function pdfCacheMetadataMatches(report, metadata) {
  const expected = pdfCacheMetadataForReport(report);
  return Boolean(
    metadata
    && metadata.version === expected.version
    && metadata.reportId === expected.reportId
    && metadata.reportUpdatedAt === expected.reportUpdatedAt
    && metadata.fingerprint === expected.fingerprint
  );
}
