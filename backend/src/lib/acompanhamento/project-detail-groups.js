import {
  combineAlerts,
  combineEquipment,
  combinePresumedProfitTaxes,
  combineProgress,
  combineProgressHistory,
  maxIsoDate,
  minIsoDate,
  ratioPct,
  round1,
  round2,
  sumValues,
  toNumber
} from './project-card-groups.js';
import { sameClientName } from './client-identity.js';
import { getActiveMissionGroup } from './mission-groups.js';
import { combineProgressBreakdowns, progressContributionWeight } from './progress-groups.js';

const DAY_STATUS_ORDER = {
  TRABALHADO: 0,
  STANDBY: 1,
  PARADO: 2
};

function groupCode(members) {
  const codes = members.map(member => member.code).filter(Boolean);
  return codes.length ? codes.join(' + ') : 'Grupo';
}

function sameOrNull(values) {
  const distinct = Array.from(new Set(values.filter(value => value !== null && value !== undefined && value !== '')));
  return distinct.length === 1 ? distinct[0] : null;
}

function proposalCode(details) {
  const codes = Array.from(new Set(details.map(item => item.detail.header.proposalCode).filter(Boolean)));
  return codes.length ? codes.join(' + ') : null;
}

function progressContributionWeightSafe(progress) {
  return progressContributionWeight(progress);
}

function memberSummary(member, detail) {
  const project = member.project ?? {};
  return {
    projectId: member.projectId,
    code: detail?.header?.code ?? project.code ?? '',
    name: project.name ?? '',
    clientName: detail?.header?.clientName ?? project.clientName ?? '',
    clientCnpj: detail?.header?.clientCnpj ?? project.clientCnpj ?? '',
    order: member.order ?? 0,
    visible: Boolean(detail)
  };
}

function combineRoleCounts(details) {
  const byRole = new Map();
  for (const { detail } of details) {
    for (const role of detail.workedHours?.roleCounts ?? []) {
      const key = role.roleName || 'Sem cargo';
      const existing = byRole.get(key) ?? {
        roleName: key,
        collaboratorCount: 0,
        usedHours: 0
      };
      existing.collaboratorCount += toNumber(role.collaboratorCount) ?? 0;
      existing.usedHours += toNumber(role.usedHours) ?? 0;
      byRole.set(key, existing);
    }
  }

  const plannedTotalHours = sumValues(details, item => item.detail.workedHours?.plannedTotalHours, { nullWhenEmpty: false });
  return Array.from(byRole.values())
    .map(item => ({
      roleName: item.roleName,
      collaboratorCount: item.collaboratorCount,
      usedHours: round1(item.usedHours),
      pctOfPlannedTotal: plannedTotalHours > 0 ? Math.round((item.usedHours / plannedTotalHours) * 100) : null
    }))
    .filter(item => item.collaboratorCount > 0)
    .sort((a, b) => a.roleName.localeCompare(b.roleName, 'pt-BR'));
}

function combineWorkedHours(details) {
  const normalWorkedHours = sumValues(details, item => item.detail.workedHours?.normalWorkedHours, { nullWhenEmpty: false });
  const overtimeWorkedHours = sumValues(details, item => item.detail.workedHours?.overtimeWorkedHours, { nullWhenEmpty: false });
  const plannedNormalHours = sumValues(details, item => item.detail.workedHours?.plannedNormalHours, { nullWhenEmpty: false });
  const plannedOvertimeHours = sumValues(details, item => item.detail.workedHours?.plannedOvertimeHours, { nullWhenEmpty: false });
  const totalWorkedHours = round1(normalWorkedHours + overtimeWorkedHours);
  const plannedTotalHours = round1(plannedNormalHours + plannedOvertimeHours);

  return {
    normalWorkedHours: round1(normalWorkedHours),
    overtimeWorkedHours: round1(overtimeWorkedHours),
    totalWorkedHours,
    plannedNormalHours: round1(plannedNormalHours),
    plannedOvertimeHours: round1(plannedOvertimeHours),
    plannedTotalHours: plannedTotalHours > 0 ? plannedTotalHours : null,
    normalPct: plannedTotalHours > 0 ? Math.round((normalWorkedHours / plannedTotalHours) * 100) : null,
    overtimePct: plannedTotalHours > 0 ? Math.round((overtimeWorkedHours / plannedTotalHours) * 100) : null,
    totalPct: plannedTotalHours > 0 ? Math.round((totalWorkedHours / plannedTotalHours) * 100) : null,
    roleCounts: combineRoleCounts(details)
  };
}

function combineTopExpenses(details) {
  const byCategory = new Map();
  for (const { detail } of details) {
    for (const item of detail.maioresGastos ?? []) {
      const category = item.categoria || 'Sem categoria';
      byCategory.set(category, (byCategory.get(category) || 0) + (toNumber(item.total) ?? 0));
    }
  }
  return Array.from(byCategory.entries())
    .map(([categoria, total]) => ({ categoria, total: round2(total) }))
    .filter(item => item.total > 0)
    .sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, 'pt-BR'))
    .slice(0, 5);
}

export function combineRecentDays(details) {
  const byDate = new Map();
  for (const { detail } of details) {
    for (const item of detail.ultimosDias ?? []) {
      const existing = byDate.get(item.date) ?? {
        date: item.date,
        status: 'TRABALHADO',
        workedMinutes: 0,
        standbyMinutes: 0
      };
      existing.workedMinutes += toNumber(item.workedMinutes) ?? 0;
      existing.standbyMinutes += toNumber(item.standbyMinutes) ?? 0;
      if (DAY_STATUS_ORDER[item.status] > DAY_STATUS_ORDER[existing.status]) {
        existing.status = item.status;
      }
      byDate.set(item.date, existing);
    }
  }
  return Array.from(byDate.values())
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-10);
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function combineCollaborators(details) {
  const byPerson = new Map();
  for (const { detail } of details) {
    for (const item of detail.colaboradores ?? []) {
      const name = item.name || '—';
      const role = item.role || '—';
      const key = `${normalizeKey(name)}|${normalizeKey(role)}`;
      const existing = byPerson.get(key) ?? {
        name,
        role,
        horasLancadas: 0,
        horasApropriadas: null,
        horasDeslocamento: 0,
        diasApropriados: new Map(),
        horasRelatoriosPorData: new Map(),
        custo: null,
        custoHora: null,
        custoDeslocamento: null
      };
      existing.horasLancadas += toNumber(item.horasLancadas) ?? toNumber(item.horas) ?? 0;
      const horasApropriadas = toNumber(item.horasApropriadas);
      if (horasApropriadas !== null) {
        existing.horasApropriadas = (existing.horasApropriadas ?? 0) + horasApropriadas;
      }
      existing.horasDeslocamento += toNumber(item.horasDeslocamento) ?? 0;
      for (const day of item.diasApropriados ?? []) {
        if (!day?.data) continue;
        const currentDay = existing.diasApropriados.get(day.data) ?? {
          data: day.data,
          horas: 0,
          horasNormais: 0,
          horasExtras: 0,
          emViagem: false,
          rdos: new Map()
        };
        currentDay.horas += toNumber(day.horas) ?? 0;
        currentDay.horasNormais += toNumber(day.horasNormais) ?? 0;
        currentDay.horasExtras += toNumber(day.horasExtras) ?? 0;
        currentDay.emViagem = currentDay.emViagem || Boolean(day.emViagem);
        for (const rdo of day.rdos ?? []) {
          const rdoKey = `${rdo?.projetoId || ''}:${rdo?.numero ?? 'sem-numero'}`;
          currentDay.rdos.set(rdoKey, rdo);
        }
        existing.diasApropriados.set(day.data, currentDay);
      }
      for (const day of item.horasRelatoriosPorData ?? []) {
        if (!day?.data) continue;
        const horas = toNumber(day.horas) ?? 0;
        const currentDay = existing.horasRelatoriosPorData.get(day.data) ?? { horas: 0, relatorios: new Map() };
        currentDay.horas = Math.max(currentDay.horas, horas);
        for (const report of day.relatorios ?? []) {
          currentDay.relatorios.set(report.id, report);
        }
        existing.horasRelatoriosPorData.set(day.data, currentDay);
      }
      const cost = toNumber(item.custo);
      if (cost !== null) existing.custo = round2((existing.custo ?? 0) + cost);
      const travelCost = toNumber(item.custoDeslocamento);
      if (travelCost !== null) {
        existing.custoDeslocamento = round2((existing.custoDeslocamento ?? 0) + travelCost);
      }
      byPerson.set(key, existing);
    }
  }
  return Array.from(byPerson.values())
    .map(item => {
      const horasRelatoriosPorData = [...item.horasRelatoriosPorData.entries()]
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([data, day]) => ({
          data,
          horas: day.horas,
          relatorios: [...day.relatorios.values()].sort((a, b) => (
            String(a.projetoCodigo || '').localeCompare(String(b.projetoCodigo || ''), 'pt-BR', { numeric: true })
            || String(a.tipo).localeCompare(String(b.tipo))
            || (a.numero ?? 0) - (b.numero ?? 0)
            || a.id.localeCompare(b.id)
          ))
        }));
      const diasApropriados = [...item.diasApropriados.values()]
        .sort((left, right) => left.data.localeCompare(right.data))
        .map(day => ({
          ...day,
          rdos: [...day.rdos.values()]
        }));
      const horasSemSobreposicao = horasRelatoriosPorData.length
        ? horasRelatoriosPorData.reduce((sum, day) => sum + day.horas, 0)
        : item.horasLancadas;
      const horasLancadas = round1(item.horasLancadas);
      const horas = round1(horasSemSobreposicao);
      const sobreposicaoHoras = round1(Math.max(0, item.horasLancadas - horasSemSobreposicao));
      const custoHora = item.custo !== null && item.horasApropriadas > 0
        ? item.custo / item.horasApropriadas
        : null;
      return {
        name: item.name,
        role: item.role,
        horas,
        horasLancadas,
        horasApropriadas: item.horasApropriadas,
        horasDeslocamento: round1(item.horasDeslocamento),
        diasApropriados,
        sobreposicaoHoras,
        horasRelatoriosPorData,
        custo: item.custo,
        custoHora,
        custoDeslocamento: item.custoDeslocamento
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function combineHoursRows(scopes, key) {
  const byRole = new Map();
  for (const scope of scopes) {
    for (const item of scope?.[key] ?? []) {
      const roleName = item.roleName || 'Sem cargo';
      const existing = byRole.get(roleName) ?? {
        jobRoleId: item.jobRoleId ?? null,
        roleName,
        collaboratorCount: 0,
        hours: 0
      };
      existing.collaboratorCount += toNumber(item.collaboratorCount) ?? 0;
      existing.hours += toNumber(item.hours) ?? 0;
      byRole.set(roleName, existing);
    }
  }
  return Array.from(byRole.values())
    .map(item => ({
      jobRoleId: item.jobRoleId,
      roleName: item.roleName,
      collaboratorCount: item.collaboratorCount,
      hours: round1(item.hours)
    }))
    .sort((a, b) => String(a.roleName).localeCompare(String(b.roleName), 'pt-BR'));
}

function combinePlannedServices(scopes) {
  const byService = new Map();
  for (const scope of scopes) {
    for (const service of scope?.services ?? []) {
      const key = service.serviceType || 'SERVICO';
      const existing = byService.get(key) ?? {
        serviceType: key,
        weightSum: 0,
        weightCount: 0,
        systems: new Map()
      };
      const weight = toNumber(service.weight);
      if (weight !== null) {
        existing.weightSum += weight;
        existing.weightCount += 1;
      }
      for (const system of service.systems ?? []) {
        const systemKey = [
          system.systemType ?? '',
          system.description ?? '',
          system.diameter ?? '',
          system.diameterUnit ?? '',
          system.unit ?? ''
        ].join('|');
        const current = existing.systems.get(systemKey) ?? {
          systemType: system.systemType,
          description: system.description ?? null,
          diameter: system.diameter ?? null,
          diameterUnit: system.diameterUnit ?? null,
          quantity: 0,
          unit: system.unit ?? null,
          hasQuantity: false
        };
        const quantity = toNumber(system.quantity);
        if (quantity !== null) {
          current.quantity += quantity;
          current.hasQuantity = true;
        }
        existing.systems.set(systemKey, current);
      }
      byService.set(key, existing);
    }
  }

  return Array.from(byService.values())
    .map(service => ({
      serviceType: service.serviceType,
      weight: service.weightCount > 0 ? round1(service.weightSum / service.weightCount) : null,
      note: null,
      systems: Array.from(service.systems.values()).map(system => ({
        systemType: system.systemType,
        description: system.description,
        diameter: system.diameter,
        diameterUnit: system.diameterUnit,
        quantity: system.hasQuantity ? round2(system.quantity) : null,
        unit: system.unit
      }))
    }))
    .sort((a, b) => String(a.serviceType).localeCompare(String(b.serviceType), 'pt-BR'));
}

function combinePlannedScopes(scopes) {
  return {
    services: combinePlannedServices(scopes),
    normalHours: combineHoursRows(scopes, 'normalHours'),
    overtime: combineHoursRows(scopes, 'overtime')
  };
}

export function groupProjectDetails(group, memberDetails = []) {
  const details = memberDetails
    .filter(item => item?.detail)
    .slice()
    .sort((a, b) => (a.member?.order ?? 0) - (b.member?.order ?? 0));
  if (details.length === 0) return null;

  const members = (group.members ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(member => memberSummary(member, details.find(item => item.projectId === member.projectId)?.detail));
  const visibleMembers = members.filter(member => member.visible);
  const groupedScopeProgress = combineProgressBreakdowns(details.map(item => item.progress).filter(Boolean));
  const fallbackProgress = combineProgress(details.map(({ detail, progress }) => ({
    progressPct: detail.avancoPct,
    progressWeight: progressContributionWeightSafe(progress),
    plannedCost: detail.consumo?.previsto,
    salePrice: detail.faturamento?.previsto
  })));
  const progress = groupedScopeProgress?.progressPct !== null && groupedScopeProgress?.progressPct !== undefined
    ? groupedScopeProgress
    : fallbackProgress;

  const gasto = sumValues(details, item => item.detail.consumo?.gasto, { nullWhenEmpty: false });
  const previsto = sumValues(details, item => item.detail.consumo?.previsto);
  const laborCost = sumValues(details, item => item.detail.maoDeObra?.custo);
  const laborCostBase = sumValues(details, item => item.detail.maoDeObra?.custoBase);
  const elapsedCorridos = sumValues(details, item => item.detail.diasCorridos?.elapsed);
  const plannedCorridos = sumValues(details, item => item.detail.diasCorridos?.planned);
  const workedDays = sumValues(details, item => item.detail.diasTrabalhados?.worked, { nullWhenEmpty: false });
  const plannedWorkedDays = sumValues(details, item => item.detail.diasTrabalhados?.planned);

  return {
    group: {
      id: group.id,
      name: group.name,
      laborAllocationMode: group.laborAllocationMode || 'VISUAL_ONLY',
      primaryLaborProjectId: group.primaryLaborProjectId || null,
      members
    },
    header: {
      code: groupCode(visibleMembers),
      clientName: sameClientName(visibleMembers),
      proposalCode: proposalCode(details),
      lastRdoDate: maxIsoDate(details.map(item => item.detail.header.lastRdoDate)),
      segment: sameOrNull(details.map(item => item.detail.header.segment))
    },
    alerts: combineAlerts(details.map(item => ({ alerts: item.detail.alerts ?? [] }))),
    avancoMethod: progress.progressMethod,
    diasCorridos: {
      elapsed: elapsedCorridos,
      planned: plannedCorridos,
      pct: ratioPct(elapsedCorridos, plannedCorridos)
    },
    diasTrabalhados: {
      worked: workedDays,
      planned: plannedWorkedDays,
      pct: ratioPct(workedDays, plannedWorkedDays)
    },
    consumo: {
      gasto,
      omie: sumValues(details, item => item.detail.consumo?.omie, { nullWhenEmpty: false }),
      pago: sumValues(details, item => item.detail.consumo?.pago, { nullWhenEmpty: false }),
      previstoPagar: sumValues(details, item => item.detail.consumo?.previstoPagar, { nullWhenEmpty: false }),
      estoque: sumValues(details, item => item.detail.consumo?.estoque, { nullWhenEmpty: false }),
      manual: sumValues(details, item => item.detail.consumo?.manual, { nullWhenEmpty: false }),
      previsto,
      previstoOriginal: sumValues(details, item => item.detail.consumo?.previstoOriginal),
      previstoAdicional: sumValues(details, item => item.detail.consumo?.previstoAdicional),
      pct: ratioPct(gasto, previsto)
    },
    faturamento: {
      previsto: sumValues(details, item => item.detail.faturamento?.previsto),
      previstoOriginal: sumValues(details, item => item.detail.faturamento?.previstoOriginal),
      previstoAdicional: sumValues(details, item => item.detail.faturamento?.previstoAdicional),
      realizado: sumValues(details, item => item.detail.faturamento?.realizado),
      notas: sumValues(details, item => item.detail.faturamento?.notas, { nullWhenEmpty: false })
    },
    budgetBreakdown: {
      original: {
        salePrice: sumValues(details, item => item.detail.faturamento?.previstoOriginal),
        plannedTotalCost: sumValues(details, item => item.detail.consumo?.previstoOriginal)
      },
      additionals: details.flatMap(item => item.detail.budgetBreakdown?.additionals ?? []),
      additionalCount: sumValues(details, item => item.detail.budgetBreakdown?.additionalCount, { nullWhenEmpty: false }),
      additionalTotals: {
        salePrice: sumValues(details, item => item.detail.faturamento?.previstoAdicional),
        plannedTotalCost: sumValues(details, item => item.detail.consumo?.previstoAdicional)
      }
    },
    maoDeObra: {
      custo: laborCost,
      custoBase: laborCostBase,
      horas: sumValues(details, item => item.detail.maoDeObra?.horas),
      periodStart: minIsoDate(details.map(item => item.detail.maoDeObra?.periodStart)),
      periodEnd: maxIsoDate(details.map(item => item.detail.maoDeObra?.periodEnd))
    },
    presumedProfitTaxes: combinePresumedProfitTaxes(details.map(item => ({
      presumedProfitTaxes: item.detail.presumedProfitTaxes
    }))),
    workedHours: combineWorkedHours(details),
    maioresGastos: combineTopExpenses(details),
    manualCosts: details.flatMap(item => item.detail.manualCosts ?? []),
    avancoPct: progress.progressPct,
    progressHistory: combineProgressHistory(details.map(({ detail, progress }) => ({
      progressHistory: detail.progressHistory,
      progressWeight: progressContributionWeightSafe(progress),
      plannedCost: detail.consumo?.previsto,
      salePrice: detail.faturamento?.previsto
    }))),
    standby: {
      count: sumValues(details, item => item.detail.standby?.count, { nullWhenEmpty: false }),
      minutes: sumValues(details, item => item.detail.standby?.minutes, { nullWhenEmpty: false })
    },
    ultimosDias: combineRecentDays(details),
    overtimeMinutes: sumValues(details, item => item.detail.overtimeMinutes, { nullWhenEmpty: false }),
    colaboradores: combineCollaborators(details),
    equipamentos: combineEquipment(details.map(item => ({ equipment: item.detail.equipamentos ?? [] }))),
    plannedScope: combinePlannedScopes(details.map(item => item.plannedScope).filter(Boolean)),
    footer: {
      mobilizationDate: minIsoDate(details.map(item => item.detail.footer?.mobilizationDate)),
      startDate: minIsoDate(details.map(item => item.detail.footer?.startDate)),
      expectedEndDate: maxIsoDate(details.map(item => item.detail.footer?.expectedEndDate)),
      projectedEndByPace: maxIsoDate(details.map(item => item.detail.footer?.projectedEndByPace))
    }
  };
}

export async function getMissionGroupDetail(groupId, {
  includeCollaboratorCosts = false,
  includeAdminOnlyCategories = true
} = {}) {
  const [{ getProjectDetail }, { getPlannedScope }, { computeProjectProgress }] = await Promise.all([
    import('./project-detail.js'),
    import('./planned-scope.js'),
    import('./avanco.js')
  ]);
  const group = await getActiveMissionGroup({ groupId });
  const entries = await Promise.all(
    (group.members ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(async member => {
        const [detail, plannedScope, progress] = await Promise.all([
          getProjectDetail(member.projectId, { includeCollaboratorCosts, includeAdminOnlyCategories }),
          getPlannedScope(member.projectId).catch(() => null),
          computeProjectProgress(member.projectId).catch(() => null)
        ]);
        return { projectId: member.projectId, member, detail, plannedScope, progress };
      })
  );
  return groupProjectDetails(group, entries);
}
