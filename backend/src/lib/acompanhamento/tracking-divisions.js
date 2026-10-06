import prisma from '../prisma.js';
import { systemNameKey } from './project-systems.js';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function validDay(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function divisionKey(kind, scopeName, equipmentKey = null) {
  return JSON.stringify([kind, scopeName ?? null, equipmentKey]);
}

export function divisionLaborPeriod(division) {
  return division ? { ...division, startDate: division.mobilizationDate ?? null } : null;
}

export function dateInDivision(value, division, now = new Date()) {
  if (!division) return true;
  if (!validDay(division.startDate)) return false;
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  return date >= division.startDate && date <= (division.endDate && division.endDate < today ? division.endDate : today);
}

export function divisionDateWhere(field, division, now = new Date()) {
  if (!division) return {};
  const today = now.toISOString().slice(0, 10);
  const end = division.endDate && division.endDate < today ? division.endDate : today;
  return { [field]: {
    gte: new Date(`${division.startDate}T00:00:00.000Z`),
    lt: new Date(new Date(`${end}T00:00:00.000Z`).getTime() + 86400000)
  } };
}

export function divisionCandidates(services = []) {
  const scopes = new Map();
  for (const service of services) {
    const name = service.scopeName?.trim() || null;
    const key = divisionKey('SCOPE', name);
    if (!scopes.has(key)) scopes.set(key, { key, kind: 'SCOPE', scopeName: name, label: name || 'Sem escopo definido', equipments: new Map() });
    for (const row of service.systems ?? []) {
      if (!row.projectSystemId || !row.projectSystem) continue;
      const sys = row.projectSystem;
      const equipmentKey = sys.equipmentKey || systemNameKey(sys.equipment);
      if (!equipmentKey) continue;
      const childKey = divisionKey('EQUIPMENT', name, equipmentKey);
      const equipments = scopes.get(key).equipments;
      if (!equipments.has(childKey)) equipments.set(childKey, {
        key: childKey, kind: 'EQUIPMENT', scopeName: name, equipmentKey,
        label: sys.equipment, systemIds: new Set()
      });
      equipments.get(childKey).systemIds.add(row.projectSystemId);
    }
  }
  return [...scopes.values()].map(({ equipments, ...scope }) => ({
    ...scope,
    equipments: [...equipments.values()].map(({ systemIds, ...equipment }) => ({ ...equipment, systemCount: systemIds.size }))
  }));
}

export function validateDivisionRows(candidates, rows) {
  const allowed = new Set(candidates.flatMap(scope => [scope.key, ...scope.equipments.map(equipment => equipment.key)]));
  const seen = new Set();
  return rows.map(row => {
    if (!allowed.has(row.key) || seen.has(row.key)) throw new Error('Divisão desconhecida ou repetida. Atualize o painel e tente novamente.');
    seen.add(row.key);
    if (!validDay(row.startDate) || (row.endDate != null && !validDay(row.endDate))) throw new Error('Informe datas válidas para o início e o fim do escopo.');
    if (row.endDate && row.endDate < row.startDate) throw new Error('O fim do escopo deve ser igual ou posterior ao início do escopo.');
    if (!validDay(row.mobilizationDate)) throw new Error('Informe uma data válida para a mobilização do escopo.');
    if (row.endDate && row.mobilizationDate > row.endDate) throw new Error('A mobilização do escopo deve ser igual ou anterior ao fim do escopo.');
    const planned = {};
    for (const field of ['plannedCost', 'plannedRevenue', 'plannedHours', 'plannedDays']) {
      const value = row[field];
      if (value != null && (!Number.isFinite(value) || value < 0 || value > 999999999999)) throw new Error(`Valor previsto inválido: ${field}.`);
      planned[field] = value ?? null;
    }
    if (planned.plannedDays != null && !Number.isInteger(planned.plannedDays)) throw new Error('Dias previstos devem ser inteiros.');
    return { key: row.key, startDate: row.startDate, endDate: row.endDate ?? null, mobilizationDate: row.mobilizationDate, ...planned };
  });
}

// Divisões salvas antes do agrupamento por equipamento continuam disponíveis. Quando
// vários sistemas pertenciam à mesma unidade, conserva a janela total e soma as metas.
export function storedDivisionRows(candidates, services, storedRows) {
  const allowed = new Set(candidates.flatMap(scope => [scope.key, ...scope.equipments.map(equipment => equipment.key)]));
  const legacyKeys = new Map();
  for (const service of services) {
    const scopeName = service.scopeName?.trim() || null;
    for (const row of service.systems ?? []) {
      const equipmentKey = row.projectSystem?.equipmentKey || systemNameKey(row.projectSystem?.equipment);
      if (row.projectSystemId && equipmentKey) {
        legacyKeys.set(divisionKey('SYSTEM', scopeName, row.projectSystemId), divisionKey('EQUIPMENT', scopeName, equipmentKey));
      }
    }
  }
  const current = [], legacy = new Map();
  for (const row of Array.isArray(storedRows) ? storedRows : []) {
    if (!row || !validDay(row.startDate)) continue;
    if (allowed.has(row.key)) { current.push(row); continue; }
    const key = legacyKeys.get(row.key);
    if (!key || !allowed.has(key)) continue;
    if (!legacy.has(key)) legacy.set(key, []);
    legacy.get(key).push(row);
  }
  const currentKeys = new Set(current.map(row => row.key));
  for (const [key, rows] of legacy) {
    if (currentKeys.has(key)) continue;
    const planned = {};
    for (const field of ['plannedCost', 'plannedRevenue', 'plannedHours', 'plannedDays']) {
      const values = rows.map(row => row[field]).filter(value => typeof value === 'number' && Number.isFinite(value));
      planned[field] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    }
    current.push({
      key,
      startDate: rows.map(row => row.startDate).sort()[0],
      endDate: rows.some(row => !row.endDate) ? null : rows.map(row => row.endDate).sort().at(-1),
      mobilizationDate: rows.every(row => validDay(row.mobilizationDate)) ? rows.map(row => row.mobilizationDate).sort()[0] : null,
      ...planned
    });
  }
  return current;
}

export async function getTrackingDivisions(projectId, client = prisma) {
  const [project, services] = await Promise.all([
    client.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { trackingDivisions: true } }),
    client.projectPlannedService.findMany({ where: { projectId }, orderBy: { order: 'asc' }, include: {
      systems: { orderBy: { order: 'asc' }, include: { projectSystem: true } }
    } })
  ]);
  if (!project) throw new Error('Projeto não encontrado.');
  const candidates = divisionCandidates(services);
  const divisions = storedDivisionRows(candidates, services, project.trackingDivisions);
  return { candidates, divisions };
}

export async function setTrackingDivisions(projectId, rows, client = prisma) {
  return client.$transaction(async tx => {
    const { candidates } = await getTrackingDivisions(projectId, tx);
    const divisions = validateDivisionRows(candidates, rows);
    await tx.project.update({ where: { id: projectId }, data: { trackingDivisions: divisions } });
    return { candidates, divisions };
  });
}

export async function setTrackingDivision(projectId, row, client = prisma) {
  return client.$transaction(async tx => {
    const { candidates, divisions: current } = await getTrackingDivisions(projectId, tx);
    const [division] = validateDivisionRows(candidates, [row]);
    const exists = current.some(item => item.key === division.key);
    const divisions = exists
      ? current.map(item => item.key === division.key ? division : item)
      : [...current, division];
    await tx.project.update({ where: { id: projectId }, data: { trackingDivisions: divisions } });
    return { candidates, divisions };
  });
}
