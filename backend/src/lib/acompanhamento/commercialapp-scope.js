import { createHash } from 'node:crypto';
import { assertDistinctScopeMeasurements } from './scope-groups.js';
import { normalizeRdoServiceType } from './service-types.js';
import { resolvePlannedSystem } from './project-systems.js';

const SERVICE_TYPES = {
  limpeza_quimica: 'LIMPEZA_QUIMICA',
  teste_hidrostatico: 'TESTE_PRESSAO',
  flushing_primario: 'FLUSHING',
  flushing_secundario: 'FLUSHING',
  flushing_agua: 'FLUSHING'
};
const SERVICE_LABELS = {
  LIMPEZA_QUIMICA: 'Limpeza química',
  TESTE_PRESSAO: 'Teste de pressão',
  FLUSHING: 'Flushing',
  FILTRAGEM: 'Filtragem'
};
const ITEM_TYPES = {
  pipes: 'pipeSegments',
  reservoirs: 'reservoirVolumes',
  oil: 'manualVolumes',
  equipment: 'equipmentVolumes'
};
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const rows = value => Array.isArray(value) ? value : [];
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
const text = value => String(value ?? '').trim();
const serviceType = id => SERVICE_TYPES[id] || (id.startsWith('filtragem_') ? 'FILTRAGEM' : null);
const issue = (items, value) => { if (!items.includes(value)) items.push(value); };

function measurement(itemType, item, type) {
  if (itemType === 'pipes' && ['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING'].includes(type)) {
    const quantity = round(Number(item.quantity) * Number(item.lengthM));
    const diameterMm = Number(item.internalDiameterMm);
    // Orçamentos novos informam a unidade; os antigos sem unidade guardavam mm.
    const diameterUnit = item.diameterUnit === 'mm' ? 'mm'
      : item.diameterUnit === 'in' || positive(item.nominalDiameterIn) ? 'pol' : 'mm';
    const selectedDiameter = diameterUnit === 'pol' && positive(item.nominalDiameterIn)
      ? Number(item.nominalDiameterIn) : diameterUnit === 'mm' ? diameterMm : diameterMm / 25.4;
    const diameter = positive(selectedDiameter)
      ? String(Math.round(selectedDiameter * 1e8) / 1e8) : null;
    return { systemType: 'TUBULACAO', quantity, unit: 'M', diameter, diameterUnit };
  }
  if (itemType === 'oil' && ['FILTRAGEM', 'FLUSHING'].includes(type)) {
    return { systemType: 'OLEO', quantity: round(Number(item.quantity) * Number(item.volumeLiters)),
      unit: 'L', diameter: null, diameterUnit: null };
  }
  if (['reservoirs', 'equipment'].includes(itemType) && type === 'LIMPEZA_QUIMICA') {
    return { systemType: 'SISTEMA', quantity: round(Number(item.quantity)), unit: 'UN',
      diameter: null, diameterUnit: null };
  }
  if (['reservoirs', 'equipment'].includes(itemType) && ['FILTRAGEM', 'FLUSHING'].includes(type)) {
    return { systemType: 'OLEO', quantity: round(Number(item.quantity) * Number(item.volumeLiters)),
      unit: 'L', diameter: null, diameterUnit: null };
  }
  return null;
}

function assignWeight(services) {
  if (!services.length) return [];
  const units = Math.floor(10000 / services.length);
  return services.map((service, index) => ({
    ...service, weight: (units + (index < 10000 - units * services.length ? 1 : 0)) / 100
  }));
}

// O snapshot do levantamento já contém os vínculos entre circuito, item e serviço.
// A projeção usa as unidades que o RDO consegue medir; insumos e ciclos não
// multiplicam o quantitativo vendido.
export function projectScopeFromCommercialApp(snapshot) {
  const cost = snapshot?.costBreakdown;
  const issues = [];
  if (!cost || !Array.isArray(cost.volumeSystems)) {
    return { services: [], issues: ['Proposta sem levantamento estruturado de sistemas.'] };
  }
  const systems = new Map(rows(cost.volumeSystems).filter(system => system?.enabled !== false)
    .map(system => [text(system.id), system]));
  const finalServices = snapshot?.proposalSnapshot?.technicalServices;
  const contracted = rows(finalServices)
    .map(service => text(service?.serviceId || service?.id)).filter(Boolean);
  const allowed = Array.isArray(finalServices) ? new Set(contracted) : null;
  const scopeTitles = new Map(rows(snapshot?.scope)
    .filter(item => item && typeof item === 'object')
    .map(item => [text(item.id), text(item.title)]));
  const grouped = new Map();
  const seenItems = new Set();
  if (!rows(cost.circuitServices).length) {
    issue(issues, 'Levantamento sem vínculos entre serviços e sistemas.');
  }
  for (const assignment of rows(cost.circuitServices)) {
    const id = text(assignment?.serviceId);
    if (allowed && !allowed.has(id)) {
      issue(issues, `Serviço orçado "${id || 'sem código'}" não consta da proposta final; não foi importado.`);
      continue;
    }
    const type = serviceType(id);
    if (!type) {
      issue(issues, `Serviço comercial "${id || 'sem código'}" não possui medição de avanço configurada.`);
      continue;
    }
    const system = systems.get(text(assignment?.systemId));
    if (!system) {
      issue(issues, `Serviço "${id}" aponta para um circuito ausente ou inativo.`);
      continue;
    }
    const itemType = text(assignment?.itemType);
    const candidates = itemType && assignment?.itemId
      ? [{ itemType, item: rows(system[ITEM_TYPES[itemType]]).find(item => text(item?.id) === text(assignment.itemId)) }]
      : Object.entries(ITEM_TYPES).flatMap(([kind, collection]) =>
        rows(system[collection]).map(item => ({ itemType: kind, item })));
    if (!candidates.length) issue(issues, `Circuito "${text(system.name)}" não tem itens dimensionados para "${id}".`);
    for (const { itemType: kind, item } of candidates) {
      if (!item) {
        issue(issues, `Sistema dimensionado do serviço "${id}" não foi encontrado no circuito "${text(system.name)}".`);
        continue;
      }
      if (item.included === false) continue;
      const physicalKey = JSON.stringify([type, text(system.id), kind, text(item.id)]);
      const mapped = measurement(kind, item, type);
      if (!mapped) {
        issue(issues, `"${id}" em "${text(item.description)}" exige escolha da unidade de acompanhamento.`);
        continue;
      }
      if (!positive(mapped.quantity) || mapped.quantity > 999999999999.99 ||
        (mapped.systemType === 'SISTEMA' && !Number.isSafeInteger(mapped.quantity)) ||
        (mapped.systemType === 'TUBULACAO' && !mapped.diameter)) {
        issue(issues, `"${text(item.description)}" de "${text(system.name)}" não tem quantidade ou bitola válida.`);
        continue;
      }
      const equipment = text(system.name), systemName = text(item.description);
      if (!equipment || !systemName) {
        issue(issues, `Circuito ou sistema sem nome no serviço "${id}".`);
        continue;
      }
      if (!grouped.has(type)) grouped.set(type, { serviceType: type, scopeName: SERVICE_LABELS[type],
        serviceIds: new Set(), systems: new Map() });
      const group = grouped.get(type);
      group.serviceIds.add(id);
      if (seenItems.has(physicalKey)) continue;
      const key = JSON.stringify([equipment, systemName, mapped.systemType,
        mapped.diameter, mapped.diameterUnit]);
      const previous = group.systems.get(key);
      const totalQuantity = round((previous?.quantity ?? 0) + mapped.quantity);
      if (totalQuantity > 999999999999.99) {
        issue(issues, `Quantidade total de "${systemName}" excede o limite do cronograma.`);
        continue;
      }
      seenItems.add(physicalKey);
      group.systems.set(key, { equipment, systemName, description: null, ...mapped,
        quantity: totalQuantity });
    }
  }
  const services = assignWeight([...grouped.values()].map(group => {
    const ids = [...group.serviceIds];
    const title = ids.length === 1 ? scopeTitles.get(`escopo-levantamento-${ids[0]}`) : null;
    if (title?.length > 180) issue(issues, `Título do escopo "${ids[0]}" excede 180 caracteres; foi usado o nome do serviço.`);
    return { serviceType: group.serviceType, scopeName: title && title.length <= 180 ? title : group.scopeName,
      systems: [...group.systems.values()] };
  }));
  assertDistinctScopeMeasurements(services, normalizeRdoServiceType);
  return { services, issues };
}

function scopeFingerprint(services) {
  return createHash('sha256').update(JSON.stringify(services)).digest('hex');
}

// Mantém o escopo manual. Uma nova revisão só substitui o escopo que a
// integração anterior criou, e a edição manual retira esse vínculo.
export async function syncCommercialAppScope(tx, projectId, proposal) {
  const project = await tx.project.findUnique({
    where: { id: projectId }, select: { commercialScopeImport: true }
  });
  const current = await tx.projectPlannedService.count({ where: { projectId } });
  if (project?.commercialScopeImport?.status === 'MANUAL_OVERRIDE') {
    return { status: 'MANUAL_PRESERVED', issues: [] };
  }
  if (current && !project?.commercialScopeImport) return { status: 'MANUAL_PRESERVED', issues: [] };
  const mapped = projectScopeFromCommercialApp(proposal.snapshot);
  const fingerprint = scopeFingerprint(mapped.services);
  if (!mapped.services.length && current) {
    const issues = [...mapped.issues, 'O escopo da revisão anterior foi preservado até a conferência da nova revisão.'];
    await tx.project.update({ where: { id: projectId }, data: { commercialScopeImport: {
      ...project.commercialScopeImport, pendingExternalId: proposal.externalId, issues
    } } });
    return { status: 'NEEDS_REVIEW', issues };
  }
  if (project?.commercialScopeImport?.externalId === proposal.externalId &&
    project.commercialScopeImport.fingerprint === fingerprint) {
    return { status: 'UNCHANGED', issues: mapped.issues };
  }
  await tx.projectPlannedService.deleteMany({ where: { projectId } });
  for (const [order, service] of mapped.services.entries()) {
    const systems = [];
    for (const [index, row] of service.systems.entries()) {
      const projectSystemId = await resolvePlannedSystem(tx, projectId, row);
      systems.push({ projectSystemId, systemType: row.systemType,
        description: row.description, diameter: row.diameter, diameterUnit: row.diameterUnit,
        quantity: row.quantity, unit: row.unit, order: index });
    }
    await tx.projectPlannedService.create({ data: { projectId, serviceType: service.serviceType,
      scopeName: service.scopeName, weight: service.weight, order, systems: { create: systems } } });
  }
  const metadata = { externalId: proposal.externalId, fingerprint, issues: mapped.issues };
  await tx.project.update({ where: { id: projectId }, data: { commercialScopeImport: metadata } });
  return { status: !mapped.services.length ? 'NEEDS_REVIEW'
    : mapped.issues.length ? 'PARTIAL' : 'IMPORTED', issues: mapped.issues };
}
