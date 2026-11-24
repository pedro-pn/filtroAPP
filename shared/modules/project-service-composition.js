// Projeção dos cartões do detalhe, compartilhada com a API de integração.
export const SERVICE_LABELS = Object.freeze({
  DIAS_TRABALHADOS: 'Dias trabalhados', LIMPEZA_QUIMICA: 'Limpeza química',
  TESTE_PRESSAO: 'Teste de pressão', FLUSHING: 'Flushing', FILTRAGEM: 'Filtragem',
  LIMPEZA_MECANICA: 'Limpeza mecânica', LOCACAO: 'Locação'
});
export const UNIT_LABELS = Object.freeze({ M: 'm', KG: 'kg', T: 't', UN: 'un', L: 'L', DIA: 'dias', PESSOA_DIA: 'pessoas-dia' });

export function physicalUnit(systemType, unit) {
  return { TUBULACAO: 'M', SISTEMA: 'UN', MANGOTE: 'UN', OLEO: 'L' }[systemType] ?? unit ?? null;
}

function progressOfSystems(systems) {
  const byType = new Map();
  for (const system of systems) {
    if (system.plannedQty == null || system.plannedQty <= 0 || system.realizedQty == null) continue;
    const metric = byType.get(system.systemType) ?? { planned: 0, realized: 0 };
    metric.planned += system.plannedQty;
    metric.realized += system.realizedQty;
    byType.set(system.systemType, metric);
  }
  return byType.size
    ? Math.round([...byType.values()].reduce((sum, metric) => sum + metric.realized / metric.planned * 100, 0) / byType.size * 10) / 10
    : null;
}

function servicesOf(progress) {
  const grouped = progress?.scopeGroups?.flatMap(group => group.services.map(service => ({ ...service, scopeName: group.scopeName })));
  return grouped?.length ? grouped : progress?.services?.map(service => ({ ...service, scopeName: null })) ?? [];
}

export function projectServiceComposition({ target, fallbackProgress, fallbackServices } = {}) {
  const targetServices = servicesOf(target);
  const progressServices = servicesOf(fallbackProgress);
  const services = targetServices.length ? targetServices : progressServices.length ? progressServices
    : fallbackServices?.map(service => ({ ...service, scopeName: null })) ?? [];
  const cards = services.flatMap(service => {
    const linkedUnits = service.systems.filter(system => ['SISTEMA', 'MANGOTE'].includes(system.systemType)
      && (system.equipment?.trim() || system.systemName?.trim()));
    if (!linkedUnits.length) return [{ ...service, systems: service.totals ?? service.systems, equipmentName: null }];
    const systemsByEquipment = new Map();
    for (const system of linkedUnits) {
      const name = system.equipment?.trim() || system.systemName?.trim();
      const systems = systemsByEquipment.get(name) ?? [];
      systems.push(system);
      systemsByEquipment.set(name, systems);
    }
    const otherSystems = service.systems.filter(system => !linkedUnits.includes(system));
    return [
      ...(otherSystems.length ? [{ ...service, systems: otherSystems, executionPct: progressOfSystems(otherSystems), equipmentName: null }] : []),
      ...[...systemsByEquipment].map(([equipmentName, systems]) => ({ ...service, systems, executionPct: progressOfSystems(systems), equipmentName }))
    ];
  });
  return cards.map(service => {
    const measured = service.systems.filter(system => system.plannedQty != null && system.realizedQty != null);
    const unit = measured[0] ? physicalUnit(measured[0].systemType, measured[0].unit) : null;
    const canSum = measured.length === service.systems.length && measured.length > 0
      && measured.every(system => physicalUnit(system.systemType, system.unit) === unit);
    // Allowlist também nos objetos aninhados: nunca publica os sistemas ou textos do RDO.
    return {
      escopo: service.scopeName ?? null,
      servico: service.serviceType,
      rotuloServico: SERVICE_LABELS[service.serviceType] ?? service.serviceType,
      equipamento: service.equipmentName,
      avancoPct: service.executionPct ?? null,
      unidade: canSum ? unit : null,
      rotuloUnidade: canSum && unit ? UNIT_LABELS[unit] ?? unit : null,
      previsto: canSum ? measured.reduce((sum, system) => sum + system.plannedQty, 0) : null,
      realizado: canSum ? measured.reduce((sum, system) => sum + system.realizedQty, 0) : null,
      sistemas: service.systems.length
    };
  });
}
