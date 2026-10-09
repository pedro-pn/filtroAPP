import { createHash } from 'node:crypto';
import { extractReportUploadAttachments, normalizeReportUploadReference } from '../report-upload-attachments.js';
import { safeDocumentPathPart } from '../documents/storage.js';
import { databookDate, databookError, databookPeriodWhere } from './policy.js';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const TECHNICAL_DOCUMENT_TYPES = ['TECHNICAL_PROPOSAL', 'DRAWING', 'SPECIFICATION', 'CERTIFICATE', 'CLIENT_REQUIREMENT', 'TECHNICAL_EVIDENCE', 'OTHER'];
export const reportSourceInclude = {
  services: { include: { equipment: true, attachments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  attachments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  versions: { where: { status: 'ACTIVE' }, orderBy: { versionNumber: 'desc' }, take: 1 },
  reportSignatures: { where: { status: { not: 'INVALIDATED' }, version: { status: 'ACTIVE' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  clientReviews: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 }
};

export function reportPhotos(report, project) {
  const raw = [
    ...extractReportUploadAttachments({ ...report, project }, { requireProjectScope: true }),
    ...(report.attachments || []),
    ...(report.services || []).flatMap(service => (service.attachments || []).map(photo => ({ ...photo, reportServiceId: service.id })))
  ];
  const seen = new Set();
  return raw.flatMap(photo => {
    const storagePath = normalizeReportUploadReference(photo.storagePath);
    const first = storagePath?.split('/')[0];
    if (!storagePath || !first?.startsWith(`Missão ${safeDocumentPathPart(project.code)} - `)) return [];
    if (!String(photo.mimeType || '').startsWith('image/')) return [];
    const key = sha256(`${report.id}:${photo.reportServiceId || ''}:${storagePath}`);
    if (seen.has(key)) return [];
    seen.add(key);
    const service = report.services?.find(item => item.id === photo.reportServiceId);
    return [{ key, reportId: report.id, reportServiceId: photo.reportServiceId || null,
      reportLabel: `${report.reportType} ${report.sequenceNumber ?? 's/n'}`,
      date: databookDate(report.reportDate), label: photo.label || 'Registro fotográfico',
      fileName: photo.fileName || storagePath.split('/').at(-1), mimeType: photo.mimeType,
      service: service?.serviceType || '', system: service?.system || '', storagePath }];
  });
}

export function summarizeDatabookReport(report) {
  const signatures = (report.reportSignatures || []).filter(item => item.status !== 'INVALIDATED');
  const clientSignatures = signatures.filter(item => item.signerRole === 'CLIENT' && item.isRequired !== false);
  return {
    id: report.id, reportType: report.reportType, sequenceNumber: report.sequenceNumber,
    date: databookDate(report.reportDate), status: report.status,
    clientReleased: Boolean(report.clientReleasedAt),
    clientSigned: Boolean(report.physicalSignedAt || report.zapsignSignedAt || (clientSignatures.length && clientSignatures.every(item => item.status === 'SIGNED'))),
    clientSignaturesSigned: clientSignatures.filter(item => item.status === 'SIGNED').length,
    clientSignaturesRequired: clientSignatures.length,
    clientAccepted: report.clientReviews?.[0]?.action === 'APPROVED',
    pendingSignatures: signatures.filter(item => item.isRequired !== false && item.status !== 'SIGNED').length,
    description: report.dailyDescription || '',
    // Only technical fields enter the client-facing synthesis, never the entire
    // extraData/specialConditions payload (uploads, contacts and internal keys).
    technical: summarizeTechnicalFields(report.specialConditions?.serviceData),
    services: (report.services || []).map(service => ({ id: service.id, type: service.serviceType,
      system: service.system || '', material: service.material || '', equipment: service.equipment?.name || '', finalized: service.finalized,
      technical: summarizeTechnicalFields(service.extraData) }))
  };
}

const TECHNICAL_FIELDS = ['Sistema', 'Equipamento', 'Equipamento(s)', 'Desenhos / TAGs', 'Material da tubulação',
  'Método de limpeza', 'Local de limpeza', 'Tipo de inspeção', 'Quantidade de sistemas (un)',
  'Serviço finalizado?', 'Aprovado pelo cliente?', 'Etapas realizadas no dia'];
function summarizeTechnicalFields(data) {
  return Object.fromEntries(TECHNICAL_FIELDS.flatMap(key => {
    const value = data?.[key];
    if (['string', 'number', 'boolean'].includes(typeof value)) return [[key, value]];
    if (Array.isArray(value) && value.every(item => ['string', 'number', 'boolean'].includes(typeof item))) return [[key, value]];
    return [];
  }));
}

export async function loadDatabookSources(database, project, period) {
  const [reports, movements, documents] = await Promise.all([
    database.report.findMany({ where: { projectId: project.id, deletedAt: null,
      reportDate: databookPeriodWhere(period.startDate, period.endDate) },
      include: reportSourceInclude, orderBy: [{ reportDate: 'asc' }, { reportType: 'asc' }, { sequenceNumber: 'asc' }, { id: 'asc' }], take: 501 }),
    database.stockMovement.findMany({ where: { projectId: project.id, item: { type: 'PRODUTO_QUIMICO' },
      type: 'SAIDA', reason: 'USO_EM_PROJETO', reversalOfId: null, reversedBy: { is: null } },
      include: { item: { include: { documents: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] } } }, batch: true }, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
    database.projectDocument.findMany({ where: { projectId: project.id, archivedAt: null, type: { in: TECHNICAL_DOCUMENT_TYPES } },
      include: { currentVersion: { include: { signatureDocument: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  ]);
  if (reports.length > 500) throw databookError('Há mais de 500 relatórios no período. Divida o databook em etapas.', 413);
  const productsById = new Map();
  for (const movement of movements) {
    if (!productsById.has(movement.itemId)) productsById.set(movement.itemId, {
      id: movement.itemId, code: movement.item.code, name: movement.item.name,
      manufacturer: movement.item.manufacturer, unitLabel: movement.item.unitLabel,
      casNumber: movement.item.casNumber, unNumber: movement.item.unNumber,
      documents: movement.item.documents, movements: []
    });
    const date = databookDate(movement.date);
    productsById.get(movement.itemId).movements.push({ id: movement.id, date, quantity: Number(movement.quantity),
      lot: movement.batch?.lotNumber || '', inPeriod: date >= period.startDate && date <= period.endDate });
  }
  return { project, period, reports, photos: reports.flatMap(report => reportPhotos(report, project)),
    products: [...productsById.values()], documents: documents.filter(item => item.currentVersion) };
}

export function publicDatabookSources(sources) {
  return {
    reports: sources.reports.map(summarizeDatabookReport),
    photos: sources.photos.map(({ storagePath, ...photo }) => photo),
    products: sources.products.map(product => ({ ...product,
      documents: product.documents.map(document => ({ id: document.id, fileName: document.fileName, createdAt: document.createdAt })) })),
    documents: sources.documents.map(document => ({ id: document.id, title: document.title, type: document.type,
      versionId: document.currentVersion.id, versionLabel: document.currentVersion.versionLabel,
      fileName: document.currentVersion.originalFileName, contentKind: document.currentVersion.contentKind,
      acceptanceStatus: document.currentVersion.acceptanceStatus }))
  };
}

export function selectDatabookSources(sources, options) {
  const choose = (items, key, values, label) => values.map(value => {
    const found = items.find(item => item[key] === value);
    if (!found) throw databookError(`${label} fora do projeto/período ou indisponível.`, 409);
    return found;
  });
  const reports = choose(sources.reports, 'id', options.reportIds, 'Relatório');
  if (reports.some(report => !['APPROVED', 'SIGNED'].includes(report.status))) throw databookError('Selecione somente relatórios aprovados ou assinados.');
  const reportIds = new Set(reports.map(report => report.id));
  const photos = options.photos.map(selection => {
    const photo = choose(sources.photos, 'key', [selection.key], 'Foto')[0];
    if (!reportIds.has(photo.reportId)) throw databookError('A foto pertence a um relatório não selecionado.');
    // The schema supplies these fields in this order. JSONB may reorder their keys
    // on read, so restore the original layout for already persisted fingerprints.
    return { ...photo, key: selection.key, caption: selection.caption, tag: selection.tag, phase: selection.phase };
  });
  const products = options.products.map(selection => {
    const product = choose(sources.products, 'id', [selection.itemId], 'Produto')[0];
    const document = choose(product.documents, 'id', [selection.documentId], 'FDS')[0];
    if (!selection.confirmed || !selection.revision?.trim()) throw databookError('Confirme o uso, a correspondência e a revisão da FDS.');
    return { ...product, documents: undefined, document, revision: selection.revision, confirmed: true };
  });
  const documents = options.documentVersionIds.map(versionId => {
    const document = sources.documents.find(item => item.currentVersion.id === versionId);
    if (!document) throw databookError('Documento técnico fora do projeto ou versão substituída.', 409);
    return document;
  });
  const { code, name, clientName, clientCnpj, contractCode, location, isActive } = sources.project;
  const summaryReports = reports.map(summarizeDatabookReport);
  const warnings = [];
  const unsigned = summaryReports.filter(report => !report.clientSigned).length;
  const unaccepted = summaryReports.filter(report => !report.clientAccepted).length;
  if (unsigned) warnings.push(`${unsigned} relatório(s) sem assinatura concluída do cliente registrada.`);
  if (unaccepted) warnings.push(`${unaccepted} relatório(s) sem aceite do cliente registrado.`);
  if (!products.length && reports.some(report => report.reportType === 'RLQ')) warnings.push('Nenhum produto foi confirmado como utilizado; conferir a rastreabilidade química desta etapa.');
  const snapshot = {
    project: { id: sources.project.id, code, name, clientName, clientCnpj, contractCode, location, isActive },
    title: options.title, startDate: options.startDate, endDate: options.endDate, summary: options.summary,
    reports: summaryReports,
    photos: photos.map(({ storagePath, ...photo }) => photo),
    products: products.map(({ document, ...product }) => ({ ...product,
      document: { id: document.id, fileName: document.fileName, revision: product.revision } })),
    documents: documents.map(document => ({ id: document.id, title: document.title, type: document.type,
      versionId: document.currentVersion.id, versionLabel: document.currentVersion.versionLabel,
      fileName: document.currentVersion.originalFileName, acceptanceStatus: document.currentVersion.acceptanceStatus,
      externalUrl: document.currentVersion.externalUrl || null })), warnings
  };
  // Only selected sources participate: unrelated edits in another scope do not invalidate this stage.
  const sourceState = { project: snapshot.project,
    reports: reports.map(report => ({ id: report.id, updatedAt: report.updatedAt, status: report.status,
      date: report.reportDate, services: report.services, specialConditions: report.specialConditions,
      versions: report.versions, reportSignatures: report.reportSignatures, clientReviews: report.clientReviews })),
    photos, products, documents };
  const legacyFingerprint = sha256(JSON.stringify(sourceState));
  // Sort object keys only; array order is part of the curated evidence. A JSON
  // replacer runs after toJSON, preserving Date/Prisma Decimal serialization.
  const fingerprint = sha256(JSON.stringify(sourceState, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  }));
  return { reports, photos, products, documents, snapshot: JSON.parse(JSON.stringify(snapshot)), fingerprint, legacyFingerprint };
}
