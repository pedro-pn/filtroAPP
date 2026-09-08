import { randomUUID } from 'node:crypto';

import prisma from '../prisma.js';
import {
  createQualityEvidenceAttachment,
  publicQualityAttachmentUrl,
  removeQualityEvidenceAttachment
} from './attachments.js';
import { nextQualityRecordNumber } from './numbering.js';
import { calculateQualityRecurrence } from './recurrence.js';

const RECORD_INCLUDE = {
  project: { select: { id: true, code: true, name: true, isActive: true } },
  nature: { select: { id: true, name: true, isActive: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  evidences: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }
};

export class QualidadeError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'QualidadeError';
    this.statusCode = statusCode;
  }
}

function parsePage(value, fallback = 1) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function parsePageSize(value, fallback = 50, max = 200) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, Math.trunc(parsed))) : fallback;
}

function parseBoolean(value) {
  return ['1', 'true', 'sim', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function dateOnly(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00.000Z`)
    : new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function serializeDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function isHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function projectFilter(projectId) {
  const text = String(projectId || '').trim();
  if (!text) return {};
  if (['INTERNAL', 'INTERNO', '__internal__'].includes(text)) return { projectId: null };
  return { projectId: text };
}

function recordWhereFromQuery(query = {}) {
  const q = String(query.q || '').trim();
  return {
    deletedAt: null,
    ...(q ? {
      OR: [
        { number: { contains: q, mode: 'insensitive' } },
        { origin: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { linkedRnc: { contains: q, mode: 'insensitive' } },
        { evidence: { contains: q, mode: 'insensitive' } },
        { evidences: { some: {
          OR: [
            { label: { contains: q, mode: 'insensitive' } },
            { url: { contains: q, mode: 'insensitive' } },
            { fileName: { contains: q, mode: 'insensitive' } }
          ]
        } } }
      ]
    } : {}),
    ...(query.type ? { type: String(query.type) } : {}),
    ...(query.status ? { status: String(query.status) } : {}),
    ...(query.impact ? { impact: String(query.impact) } : {}),
    ...(query.natureId ? { natureId: String(query.natureId) } : {}),
    ...projectFilter(query.projectId)
  };
}

async function recordsForRecurrence(client, records) {
  const natureIds = Array.from(new Set(records.map(record => record.natureId).filter(Boolean)));
  if (!natureIds.length) return records;

  const eventTimes = records
    .map(record => record.eventDate instanceof Date ? record.eventDate.getTime() : new Date(record.eventDate).getTime())
    .filter(Number.isFinite);
  if (!eventTimes.length) return records;

  const minDate = new Date(Math.min(...eventTimes));
  minDate.setUTCMonth(minDate.getUTCMonth() - 12);
  const maxDate = new Date(Math.max(...eventTimes));

  return client.qualityRecord.findMany({
    where: {
      deletedAt: null,
      natureId: { in: natureIds },
      eventDate: { gte: minDate, lte: maxDate }
    },
    select: { id: true, natureId: true, eventDate: true }
  });
}

function serializeEvidenceItem(evidence) {
  if (!evidence) return null;
  if (evidence.kind === 'LINK') {
    if (!isHttpUrl(evidence.url)) return null;
    return {
      id: evidence.id,
      kind: 'LINK',
      label: evidence.label,
      url: evidence.url,
      createdAt: evidence.createdAt
    };
  }
  if (!evidence.publicToken || !evidence.storagePath) return null;
  return {
    id: evidence.id,
    kind: 'ATTACHMENT',
    label: evidence.label,
    fileName: evidence.fileName || 'evidencia',
    mimeType: evidence.mimeType || 'application/octet-stream',
    publicUrl: publicQualityAttachmentUrl(evidence.publicToken),
    createdAt: evidence.createdAt
  };
}

function serializeEvidences(record) {
  const evidences = (Array.isArray(record.evidences) ? record.evidences : [])
    .map(serializeEvidenceItem)
    .filter(Boolean);
  if (!evidences.length && isHttpUrl(record.evidence)) {
    return [{
      id: `legacy-${record.id}`,
      kind: 'LINK',
      label: 'Evidência',
      url: record.evidence,
      createdAt: record.createdAt
    }];
  }
  return evidences;
}

export function serializeQualityRecord(record, recurrence = {}) {
  const evidences = serializeEvidences(record);
  const firstLink = evidences.find(item => item.kind === 'LINK')?.url || (isHttpUrl(record.evidence) ? record.evidence : null);
  return {
    id: record.id,
    number: record.number,
    type: record.type,
    seq: record.seq,
    year: record.year,
    registeredAt: serializeDateOnly(record.registeredAt),
    origin: record.origin,
    project: record.project ? {
      id: record.project.id,
      code: record.project.code,
      name: record.project.name,
      isActive: record.project.isActive
    } : null,
    projectId: record.projectId || null,
    eventDate: serializeDateOnly(record.eventDate),
    nature: record.nature ? {
      id: record.nature.id,
      name: record.nature.name,
      isActive: record.nature.isActive
    } : null,
    natureId: record.natureId,
    description: record.description,
    impact: record.impact,
    occurrences12m: recurrence.occurrences12m ?? 1,
    recurrent: Boolean(recurrence.recurrent),
    linkedRnc: record.linkedRnc,
    disposition: record.disposition,
    definedAction: record.definedAction,
    actionOwner: record.actionOwner,
    actionDeadline: serializeDateOnly(record.actionDeadline),
    evidence: firstLink,
    evidenceAttachment: evidences.find(item => item.kind === 'ATTACHMENT') || null,
    evidences,
    resultVerification: record.resultVerification,
    status: record.status,
    createdBy: record.createdBy ? { id: record.createdBy.id, name: record.createdBy.name } : null,
    updatedBy: record.updatedBy ? { id: record.updatedBy.id, name: record.updatedBy.name } : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function serializeQualityNature(nature) {
  return {
    id: nature.id,
    name: nature.name,
    isActive: Boolean(nature.isActive),
    position: Number.isFinite(Number(nature.position)) ? Number(nature.position) : 0,
    inUse: (nature?._count?.records ?? nature.recordCount ?? 0) > 0,
    recordCount: nature?._count?.records ?? nature.recordCount ?? 0,
    createdAt: nature.createdAt,
    updatedAt: nature.updatedAt
  };
}

async function enrichRecords(client, records) {
  const recurrenceRows = await recordsForRecurrence(client, records);
  const recurrence = calculateQualityRecurrence(recurrenceRows);
  return records.map(record => serializeQualityRecord(record, recurrence.get(record.id)));
}

export async function listRecords(client = prisma, query = {}) {
  const page = parsePage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  const where = recordWhereFromQuery(query);
  const [records, total] = await Promise.all([
    client.qualityRecord.findMany({
      where,
      include: RECORD_INCLUDE,
      orderBy: [{ registeredAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    client.qualityRecord.count({ where })
  ]);

  return {
    items: await enrichRecords(client, records),
    total,
    page,
    pageSize
  };
}

export async function listRecordsForExport(client = prisma, query = {}) {
  const records = await client.qualityRecord.findMany({
    where: recordWhereFromQuery(query),
    include: RECORD_INCLUDE,
    orderBy: [{ registeredAt: 'asc' }, { createdAt: 'asc' }]
  });
  return enrichRecords(client, records);
}

export async function getRecord(client = prisma, id) {
  const record = await client.qualityRecord.findFirst({
    where: { id, deletedAt: null },
    include: RECORD_INCLUDE
  });
  if (!record) throw new QualidadeError('Registro de qualidade não encontrado.', 404);
  return (await enrichRecords(client, [record]))[0];
}

async function assertProject(client, projectId) {
  if (!projectId) return null;
  const project = await client.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true }
  });
  if (!project) throw new QualidadeError('Projeto inválido.', 400);
  return project.id;
}

async function assertNatureForRecord(client, natureId, { currentNatureId = null } = {}) {
  if (!natureId) return null;
  const nature = await client.qualityNature.findUnique({
    where: { id: natureId },
    select: { id: true, isActive: true }
  });
  if (!nature) throw new QualidadeError('Natureza inválida.', 400);
  if (!nature.isActive && nature.id !== currentNatureId) {
    throw new QualidadeError('Natureza inativa.', 400);
  }
  return nature.id;
}

function recordDataFromPayload(data) {
  const firstLink = (Array.isArray(data.evidences) ? data.evidences : [])
    .find(item => item?.kind === 'LINK' && item.url)?.url;
  return {
    registeredAt: dateOnly(data.registeredAt),
    origin: normalizeOptionalText(data.origin),
    projectId: normalizeOptionalText(data.projectId),
    eventDate: dateOnly(data.eventDate),
    natureId: normalizeOptionalText(data.natureId),
    description: normalizeOptionalText(data.description),
    impact: data.impact || null,
    linkedRnc: data.linkedRnc,
    disposition: data.disposition || null,
    definedAction: data.definedAction,
    actionOwner: data.actionOwner,
    actionDeadline: dateOnly(data.actionDeadline),
    evidence: normalizeOptionalText(firstLink || data.evidence),
    resultVerification: data.resultVerification,
    status: data.status || null
  };
}

function evidenceItemsFromPayload(data) {
  if (Array.isArray(data.evidences)) return data.evidences;
  const link = normalizeOptionalText(data.evidence);
  return link ? [{ kind: 'LINK', label: null, url: link }] : [];
}

function existingEvidenceMap(evidences = []) {
  return new Map((Array.isArray(evidences) ? evidences : []).map(item => [item.id, item]));
}

async function evidenceRowsFromPayload(data, currentEvidences = []) {
  const currentById = existingEvidenceMap(currentEvidences);
  const rows = [];
  const createdAttachments = [];
  const currentAttachmentIdsKept = new Set();

  for (const [position, item] of evidenceItemsFromPayload(data).entries()) {
    if (item.kind === 'LINK') {
      const url = normalizeOptionalText(item.url);
      if (!url) continue;
      const current = item.id ? currentById.get(item.id) : null;
      rows.push({
        id: current?.kind === 'LINK' ? current.id : randomUUID(),
        kind: 'LINK',
        label: normalizeOptionalText(item.label),
        url,
        fileName: null,
        mimeType: null,
        storagePath: null,
        publicToken: null,
        position
      });
      continue;
    }

    if (item.kind !== 'ATTACHMENT') continue;
    const current = item.id ? currentById.get(item.id) : null;
    if (current?.kind === 'ATTACHMENT' && !item.dataUrl) {
      currentAttachmentIdsKept.add(current.id);
      rows.push({
        id: current.id,
        kind: 'ATTACHMENT',
        label: normalizeOptionalText(item.label) ?? current.label ?? null,
        url: null,
        fileName: current.fileName,
        mimeType: current.mimeType,
        storagePath: current.storagePath,
        publicToken: current.publicToken,
        position
      });
      continue;
    }

    const created = await createQualityEvidenceAttachment({ upload: item });
    if (!created) continue;
    createdAttachments.push(created);
    rows.push({
      id: randomUUID(),
      kind: 'ATTACHMENT',
      label: normalizeOptionalText(item.label),
      url: null,
      fileName: created.fileName,
      mimeType: created.mimeType,
      storagePath: created.storagePath,
      publicToken: created.publicToken,
      position
    });
  }

  const removedAttachments = currentEvidences
    .filter(item => item.kind === 'ATTACHMENT' && item.storagePath && !currentAttachmentIdsKept.has(item.id));

  return { rows, createdAttachments, removedAttachments };
}

async function replaceRecordEvidences(tx, recordId, rows) {
  await tx.qualityEvidence.deleteMany({ where: { recordId } });
  if (rows.length) {
    await tx.qualityEvidence.createMany({
      data: rows.map(row => ({ ...row, recordId }))
    });
  }
}

export async function createRecord(client = prisma, { data, userId = null }) {
  await Promise.all([
    assertProject(client, data.projectId),
    assertNatureForRecord(client, data.natureId)
  ]);

  const evidence = await evidenceRowsFromPayload(data);
  let created;
  try {
    created = await client.$transaction(async tx => {
      const registeredAt = dateOnly(data.registeredAt);
      const numbering = await nextQualityRecordNumber(tx, { type: data.type, registeredAt });
      const row = await tx.qualityRecord.create({
        data: {
          ...recordDataFromPayload(data),
          type: data.type,
          registeredAt,
          seq: numbering.seq,
          year: numbering.year,
          number: numbering.number,
          createdById: userId,
          updatedById: userId
        },
        include: RECORD_INCLUDE
      });
      await replaceRecordEvidences(tx, row.id, evidence.rows);
      return tx.qualityRecord.findUnique({
        where: { id: row.id },
        include: RECORD_INCLUDE
      });
    });
  } catch (error) {
    await Promise.all(evidence.createdAttachments.map(removeQualityEvidenceAttachment));
    throw error;
  }

  return (await enrichRecords(client, [created]))[0];
}

export async function updateRecord(client = prisma, id, { data, userId = null }) {
  const current = await client.qualityRecord.findFirst({
    where: { id, deletedAt: null },
    include: { evidences: true }
  });
  if (!current) throw new QualidadeError('Registro de qualidade não encontrado.', 404);

  await Promise.all([
    assertProject(client, data.projectId),
    assertNatureForRecord(client, data.natureId, { currentNatureId: current.natureId })
  ]);

  const evidence = await evidenceRowsFromPayload(data, current.evidences);
  let updated;
  try {
    updated = await client.$transaction(async tx => {
      await tx.qualityRecord.update({
        where: { id },
        data: {
          ...recordDataFromPayload(data),
          updatedById: userId
        }
      });
      await replaceRecordEvidences(tx, id, evidence.rows);
      return tx.qualityRecord.findUnique({
        where: { id },
        include: RECORD_INCLUDE
      });
    });
  } catch (error) {
    await Promise.all(evidence.createdAttachments.map(removeQualityEvidenceAttachment));
    throw error;
  }

  await Promise.all(evidence.removedAttachments.map(removeQualityEvidenceAttachment));

  return (await enrichRecords(client, [updated]))[0];
}

export async function deleteRecord(client = prisma, id, { userId = null } = {}) {
  const current = await client.qualityRecord.findFirst({
    where: { id, deletedAt: null },
    select: { id: true }
  });
  if (!current) {
    throw new QualidadeError('Registro de qualidade não encontrado.', 404);
  }

  await client.qualityRecord.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedById: userId,
      updatedById: userId
    }
  });
}

export async function listProjectDeviations(client = prisma, projectId) {
  const records = await client.qualityRecord.findMany({
    where: { projectId, type: 'DESVIO', deletedAt: null },
    include: RECORD_INCLUDE,
    orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }]
  });

  const enriched = await enrichRecords(client, records);
  return enriched.map(record => ({
    id: record.id,
    number: record.number,
    registeredAt: record.registeredAt,
    eventDate: record.eventDate,
    origin: record.origin,
    nature: record.nature,
    description: record.description,
    impact: record.impact,
    occurrences12m: record.occurrences12m,
    recurrent: record.recurrent,
    linkedRnc: record.linkedRnc,
    disposition: record.disposition,
    definedAction: record.definedAction,
    actionOwner: record.actionOwner,
    actionDeadline: record.actionDeadline,
    status: record.status
  }));
}

export async function listQualityProjects(client = prisma) {
  return client.project.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: [{ code: 'asc' }, { name: 'asc' }]
  });
}

export async function listNatures(client = prisma, query = {}) {
  const includeInactive = parseBoolean(query.includeInactive);
  const natures = await client.qualityNature.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: { _count: { select: { records: true } } },
    orderBy: [{ position: 'asc' }, { name: 'asc' }]
  });
  return natures.map(serializeQualityNature);
}

async function findNatureByName(client, name, ignoreId = null) {
  const existing = await client.qualityNature.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' }
    },
    select: { id: true }
  });
  return existing && existing.id !== ignoreId ? existing : null;
}

async function nextNaturePosition(client) {
  const natures = await client.qualityNature.findMany({
    select: { position: true }
  });
  const maxPosition = natures.reduce((max, nature) => Math.max(max, Number(nature.position) || 0), -1);
  return maxPosition + 1;
}

export async function createNature(client = prisma, data) {
  if (await findNatureByName(client, data.name)) {
    throw new QualidadeError('Natureza já cadastrada.', 409);
  }
  const position = await nextNaturePosition(client);
  const nature = await client.qualityNature.create({
    data: { name: data.name, position },
    include: { _count: { select: { records: true } } }
  });
  return serializeQualityNature(nature);
}

export async function renameNature(client = prisma, id, data) {
  const current = await client.qualityNature.findUnique({ where: { id }, select: { id: true } });
  if (!current) throw new QualidadeError('Natureza não encontrada.', 404);
  if (await findNatureByName(client, data.name, id)) {
    throw new QualidadeError('Natureza já cadastrada.', 409);
  }
  const nature = await client.qualityNature.update({
    where: { id },
    data: { name: data.name },
    include: { _count: { select: { records: true } } }
  });
  return serializeQualityNature(nature);
}

function uniqueNatureIds(ids) {
  const seen = new Set();
  const unique = [];
  for (const id of ids) {
    const text = String(id || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  return unique;
}

export async function reorderNatures(client = prisma, ids = []) {
  const orderedIds = uniqueNatureIds(ids);
  if (!orderedIds.length) throw new QualidadeError('Informe a ordem das Naturezas.', 400);

  const allNatures = await client.qualityNature.findMany({
    select: { id: true, name: true, position: true },
    orderBy: [{ position: 'asc' }, { name: 'asc' }]
  });
  const byId = new Map(allNatures.map(nature => [nature.id, nature]));
  const missing = orderedIds.find(id => !byId.has(id));
  if (missing) throw new QualidadeError('Natureza inválida para ordenação.', 400);

  const nextOrder = [
    ...orderedIds.map(id => byId.get(id)),
    ...allNatures.filter(nature => !orderedIds.includes(nature.id))
  ];

  await client.$transaction(async tx => {
    await Promise.all(nextOrder.map((nature, position) => (
      tx.qualityNature.update({
        where: { id: nature.id },
        data: { position }
      })
    )));
  });

  return listNatures(client, { includeInactive: true });
}

export async function setNatureActive(client = prisma, id, isActive) {
  const nature = await client.qualityNature.update({
    where: { id },
    data: { isActive },
    include: { _count: { select: { records: true } } }
  });
  return serializeQualityNature(nature);
}

export async function deleteNature(client = prisma, id) {
  const current = await client.qualityNature.findUnique({
    where: { id },
    include: { _count: { select: { records: true } } }
  });
  if (!current) throw new QualidadeError('Natureza não encontrada.', 404);
  if ((current._count?.records || 0) > 0) {
    throw new QualidadeError('Natureza em uso; desative-a em vez de excluir.', 409);
  }
  await client.qualityNature.delete({ where: { id } });
}
