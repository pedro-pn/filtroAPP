import prisma from '../prisma.js';
import { divisionDateWhere } from './tracking-divisions.js';

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeText(value, { maxLength, required = false } = {}) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (required && !text) throw new Error('Informe a descrição do custo manual.');
  if (text.length > maxLength) throw new Error(`Texto muito longo. Use no máximo ${maxLength} caracteres.`);
  return text || null;
}

function normalizeCostDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00.000Z`)
    : new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error('Data do custo manual inválida.');
  return date;
}

export function normalizeManualProjectCostInput(input = {}) {
  const amount = toNumber(input.amount);
  if (amount === null || amount <= 0) throw new Error('Informe um valor de custo manual maior que zero.');
  if (amount > 999999999.99) throw new Error('Valor de custo manual muito alto.');

  return {
    description: normalizeText(input.description, { maxLength: 120, required: true }),
    amount: roundMoney(amount),
    costDate: normalizeCostDate(input.costDate),
    note: normalizeText(input.note, { maxLength: 500 })
  };
}

export function manualProjectCostToResponse(row) {
  return {
    id: row.id,
    projectId: row.projectId,
    projectCode: row.project?.code ?? null,
    description: row.description,
    amount: toNumber(row.amount) ?? 0,
    costDate: row.costDate ?? null,
    note: row.note ?? null,
    createdAt: row.createdAt ?? null,
    createdBy: row.createdBy
      ? { id: row.createdBy.id, name: row.createdBy.name }
      : null
  };
}

export function summarizeManualProjectCostRows(rows = []) {
  const byProject = new Map();
  for (const row of rows) {
    const amount = toNumber(row.amount) ?? 0;
    if (amount <= 0) continue;
    const current = byProject.get(row.projectId) ?? { total: 0, entries: [], categories: [] };
    current.total += amount;
    current.entries.push(manualProjectCostToResponse(row));
    current.categories.push({
      categoria: `Manual: ${row.description}`,
      total: amount
    });
    byProject.set(row.projectId, current);
  }

  for (const item of byProject.values()) {
    item.total = roundMoney(item.total);
    item.entries.sort((a, b) => {
      const aDate = new Date(a.costDate ?? a.createdAt ?? 0).getTime();
      const bDate = new Date(b.costDate ?? b.createdAt ?? 0).getTime();
      return bDate - aDate;
    });
    item.categories = item.categories
      .filter(category => category.total > 0)
      .map(category => ({ ...category, total: roundMoney(category.total) }));
  }

  return byProject;
}

export async function getManualProjectCostsByProject(projectIds, { includeEntries = false, division = null } = {}) {
  const ids = Array.from(new Set((projectIds ?? []).filter(Boolean)));
  if (ids.length === 0) return new Map();

  const select = {
    id: true,
    projectId: true,
    description: true,
    amount: true,
    costDate: true,
    note: true,
    createdAt: true
  };
  if (includeEntries) {
    select.createdByUserId = true;
  }

  const rows = await prisma.projectManualCost.findMany({
    where: { projectId: { in: ids }, deletedAt: null,
      ...(division ? { OR: [
        { costDate: { not: null }, ...divisionDateWhere('costDate', division) },
        { costDate: null, ...divisionDateWhere('createdAt', division) }
      ] } : {}) },
    select,
    orderBy: [{ costDate: 'desc' }, { createdAt: 'desc' }]
  });
  if (!rows.length) return new Map();
  // Resolve display metadata only for returned costs. Prisma's nested reads
  // otherwise query Project/User even when there are no manual entries.
  const userIds = [...new Set(rows.map(row => row.createdByUserId).filter(Boolean))];
  const [projects, users] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: [...new Set(rows.map(row => row.projectId))] } }, select: { id: true, code: true } }),
    includeEntries && userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []
  ]);
  const projectsById = new Map(projects.map(({ id, code }) => [id, { code }]));
  const usersById = new Map(users.map(user => [user.id, user]));
  return summarizeManualProjectCostRows(rows.map(row => ({ ...row,
    project: projectsById.get(row.projectId) ?? null,
    createdBy: usersById.get(row.createdByUserId) ?? null
  })));
}

async function assertActiveProject(client, projectId) {
  const project = await client.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true }
  });
  if (!project) throw new Error('Projeto não encontrado.');
}

export async function createManualProjectCost(projectId, input, { userId = null, client = prisma } = {}) {
  const data = normalizeManualProjectCostInput(input);
  await assertActiveProject(client, projectId);
  const created = await client.projectManualCost.create({
    data: {
      projectId,
      description: data.description,
      amount: data.amount,
      costDate: data.costDate,
      note: data.note,
      createdByUserId: userId
    },
    include: {
      project: { select: { code: true } },
      createdBy: { select: { id: true, name: true } }
    }
  });
  return manualProjectCostToResponse(created);
}

export async function deleteManualProjectCost(projectId, costId, { client = prisma } = {}) {
  const result = await client.projectManualCost.updateMany({
    where: { id: costId, projectId, deletedAt: null },
    data: { deletedAt: new Date() }
  });
  if (result.count === 0) throw new Error('Custo manual não encontrado.');
  return { ok: true, id: costId };
}
