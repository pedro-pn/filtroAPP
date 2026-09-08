/*
 * Importação da planilha de ponto (Pontomais) — módulo Acompanhamento.
 *
 * Enquanto não há integração automática com o VR Ponto Mais, o gestor envia o .xlsx semanalmente.
 * Cada import: valida idempotência (hash), casa os nomes com Collaborator (via alias ou nome
 * normalizado), grava PontoImport + PontoPeriodSummary e devolve um resumo (casados/não-casados).
 */

import { createHash } from 'node:crypto';

import prisma from '../prisma.js';
import { parsePonto } from './ponto-parser.js';

// Normaliza nomes para casamento: sem acento, minúsculo, espaços colapsados.
export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// Agrega os dias do ponto por mês (para dividir a folha por mês e aplicar o teto de HE por mês).
function buildMonthly(days = []) {
  const monthly = {};
  for (const day of days) {
    const mk = day.date.slice(0, 7);
    if (!monthly[mk]) monthly[mk] = { normalMinutes: 0, extrasMinutes: 0, nightMinutes: 0, workedDates: [], days: [] };
    monthly[mk].normalMinutes += day.workedMinutes;
    monthly[mk].extrasMinutes += day.extrasMinutes;
    monthly[mk].nightMinutes += day.nightMinutes;
    if (day.workedMinutes > 0) monthly[mk].workedDates.push(day.date);
    monthly[mk].days.push({
      date: day.date,
      workedMinutes: day.workedMinutes,
      extrasMinutes: day.extrasMinutes,
      nightMinutes: day.nightMinutes
    });
  }
  return monthly;
}

function consolidateBlocks(blocks = []) {
  const byName = new Map();
  for (const block of blocks) {
    const normalizedName = normalizeName(block.rawName);
    if (!normalizedName) continue;
    let entry = byName.get(normalizedName);
    if (!entry) {
      entry = { ...block, normalizedName, daysByDate: new Map() };
      byName.set(normalizedName, entry);
    }
    entry.rawName = block.rawName || entry.rawName;
    entry.he70Minutes = Math.max(Number(entry.he70Minutes) || 0, Number(block.he70Minutes) || 0);
    entry.he100Minutes = Math.max(Number(entry.he100Minutes) || 0, Number(block.he100Minutes) || 0);
    for (const day of block.days || []) {
      if (day?.date) entry.daysByDate.set(day.date, day);
    }
  }

  return [...byName.values()].map(entry => {
    const days = [...entry.daysByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    const dates = days.map(day => day.date);
    return {
      ...entry,
      days,
      workedMinutes: days.reduce((sum, day) => sum + (Number(day.workedMinutes) || 0), 0),
      nightMinutes: days.reduce((sum, day) => sum + (Number(day.nightMinutes) || 0), 0),
      workedDays: days.filter(day => (Number(day.workedMinutes) || 0) > 0).map(day => day.date),
      periodStart: dates[0] || entry.periodStart,
      periodEnd: dates.at(-1) || entry.periodEnd
    };
  });
}

// Constrói o resolvedor nome-normalizado -> collaboratorId (aliases têm prioridade sobre o nome).
async function buildNameResolver() {
  const [collaborators, aliases] = await Promise.all([
    prisma.collaborator.findMany({ select: { id: true, name: true } }),
    prisma.pontoNameAlias.findMany({ select: { normalizedName: true, collaboratorId: true } })
  ]);
  const byName = new Map();
  for (const c of collaborators) byName.set(normalizeName(c.name), c.id);
  const byAlias = new Map();
  for (const a of aliases) byAlias.set(a.normalizedName, a.collaboratorId);
  return normalized => byAlias.get(normalized) ?? byName.get(normalized) ?? null;
}

export async function importPonto({ buffer, fileName, importedByUserId = null }) {
  const contentHash = hashBuffer(buffer);
  const existing = await prisma.pontoImport.findFirst({ where: { contentHash }, orderBy: { createdAt: 'desc' } });
  if (existing) {
    return { skippedDuplicate: true, importId: existing.id, contentHash };
  }

  const { blocks, periodStart, periodEnd, rowsRead } = parsePonto(buffer);
  if (!blocks.length) throw new Error('Nenhum colaborador encontrado na planilha do ponto.');
  if (!periodStart || !periodEnd) throw new Error('Não foi possível determinar o período da planilha.');

  const resolve = await buildNameResolver();
  const unmatched = [];
  const summaryRows = consolidateBlocks(blocks).map(block => {
    const normalizedName = block.normalizedName;
    const collaboratorId = resolve(normalizedName);
    if (!collaboratorId) unmatched.push({ rawName: block.rawName, normalizedName });
    return {
      collaboratorId,
      sourceKey: `xlsx:${normalizedName}`,
      rawName: block.rawName,
      normalizedName,
      periodStart: new Date(`${block.periodStart}T00:00:00.000Z`),
      periodEnd: new Date(`${block.periodEnd}T00:00:00.000Z`),
      workedMinutes: block.workedMinutes,
      he70Minutes: block.he70Minutes,
      he100Minutes: block.he100Minutes,
      nightMinutes: block.nightMinutes,
      workedDates: block.workedDays,
      monthly: buildMonthly(block.days)
    };
  });

  const matched = summaryRows.length - unmatched.length;
  const created = await prisma.pontoImport.create({
    data: {
      fileName,
      contentHash,
      source: 'XLSX',
      periodStart: new Date(`${periodStart}T00:00:00.000Z`),
      periodEnd: new Date(`${periodEnd}T00:00:00.000Z`),
      rowsRead,
      collaboratorsTotal: summaryRows.length,
      collaboratorsMatched: matched,
      summary: { unmatched },
      importedByUserId,
      periods: { create: summaryRows }
    }
  });

  return {
    skippedDuplicate: false,
    importId: created.id,
    contentHash,
    periodStart,
    periodEnd,
    rowsRead,
    collaboratorsTotal: summaryRows.length,
    collaboratorsMatched: matched,
    unmatched
  };
}

// Vincula um nome do ponto a um colaborador: cria/atualiza o alias e re-liga os resumos existentes.
export async function linkPontoName({ normalizedName, rawName, collaboratorId, createdByUserId = null }) {
  const normalized = normalizeName(normalizedName || rawName);
  if (!normalized) throw new Error('Nome inválido.');
  const collaborator = await prisma.collaborator.findUnique({ where: { id: collaboratorId } });
  if (!collaborator) throw new Error('Colaborador não encontrado.');

  await prisma.pontoNameAlias.upsert({
    where: { normalizedName: normalized },
    create: { normalizedName: normalized, rawName: rawName || normalized, collaboratorId, createdByUserId },
    update: { collaboratorId, rawName: rawName || normalized, createdByUserId }
  });
  const relinked = await prisma.pontoPeriodSummary.updateMany({
    where: { normalizedName: normalized },
    data: { collaboratorId }
  });
  return { normalizedName: normalized, collaboratorId, relinked: relinked.count };
}
