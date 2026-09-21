// Incompatibilidades entre a data de mobilização e os recursos (equipe e equipamentos) já definidos no D-30.
// Quando a data prevista muda, cada tipo de conflito vira uma pendência única do projeto, que bloqueia a
// mobilização até ser resolvida e é resolvida automaticamente quando a nova data deixa de ter conflitos.

export const RESOURCE_CONFLICT_KEYS = {
  TEAM: 'RESOURCE_TEAM_CONFLICT',
  EQUIPMENT: 'RESOURCE_EQUIPMENT_CONFLICT'
};

const RESOURCE_CONFLICT_AREAS = { TEAM: 'Operações', EQUIPMENT: 'Ativos' };
const RESOURCE_CONFLICT_TITLES = { TEAM: 'Equipe', EQUIPMENT: 'Equipamentos' };
const ISSUE_DESCRIPTION_LIMIT = 480;

export function isResourceConflictIssue(issue) {
  return Object.values(RESOURCE_CONFLICT_KEYS).includes(issue?.sourceQuestion);
}

function displayDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

function truncate(value) {
  return value.length > ISSUE_DESCRIPTION_LIMIT ? `${value.slice(0, ISSUE_DESCRIPTION_LIMIT - 1)}…` : value;
}

function teamConflicts(planning) {
  const catalogIds = new Set((planning?.team?.catalog || []).map(role => role.id));
  return (planning?.team?.demands || [])
    // sem o cargo no catálogo não há como calcular disponibilidade; isso não é um conflito de calendário
    .filter(demand => catalogIds.has(demand.jobRoleId) && demand.requiredCount > demand.availableCount)
    .map(demand => `${demand.jobRoleName}: necessário ${demand.requiredCount}, disponível ${demand.availableCount}`);
}

function equipmentConflicts(planning) {
  const conflicts = [];
  for (const category of planning?.equipment?.categories || []) {
    for (const item of category.equipment || []) {
      const reasons = [];
      if (item.availableAtMobilization === false) {
        reasons.push(item.availabilityStatus === 'RESERVED' ? 'reservado para outra obra no período' : 'alocado em outra obra na data');
      }
      if (item.calibration?.status === 'EXPIRED') reasons.push('calibração vencida na data');
      if (item.maintenance?.status === 'OVERDUE') reasons.push('manutenção vencida na data');
      if (reasons.length) conflicts.push(`${item.code ? `${item.code} · ` : ''}${item.name}: ${reasons.join('; ')}`);
    }
  }
  return conflicts;
}

/** Retorna, por tipo, o conflito encontrado (ou null) para a data de referência informada. */
export function detectResourceConflicts(planning, date) {
  const label = displayDate(date);
  const build = (type, items) => items.length
    ? {
      type,
      key: RESOURCE_CONFLICT_KEYS[type],
      title: RESOURCE_CONFLICT_TITLES[type],
      area: RESOURCE_CONFLICT_AREAS[type],
      items,
      description: truncate(`${RESOURCE_CONFLICT_TITLES[type]} incompatível com a mobilização em ${label}: ${items.join(' | ')}`)
    }
    : null;
  return {
    TEAM: build('TEAM', teamConflicts(planning)),
    EQUIPMENT: build('EQUIPMENT', equipmentConflicts(planning))
  };
}

/**
 * Cria, reabre ou resolve as pendências de conflito de recursos. Devolve os conflitos que merecem aviso
 * (novos, reabertos ou com detalhes diferentes) e os tipos resolvidos automaticamente.
 */
export async function syncResourceConflictIssues(tx, workflow, detected, date) {
  const notify = [];
  const resolved = [];
  const dueDate = new Date(`${date}T00:00:00.000Z`);
  for (const type of Object.keys(RESOURCE_CONFLICT_KEYS)) {
    const key = RESOURCE_CONFLICT_KEYS[type];
    const existing = (workflow.issues || []).find(issue => issue.sourceQuestion === key);
    const conflict = detected[type];
    if (conflict) {
      const reopened = !existing || existing.status === 'RESOLVED';
      const changed = reopened || existing.description !== conflict.description;
      await tx.projectWorkflowIssue.upsert({
        where: { projectId_sourceQuestion: { projectId: workflow.projectId, sourceQuestion: key } },
        create: {
          projectId: workflow.projectId,
          sourceQuestion: key,
          description: conflict.description,
          area: conflict.area,
          criticality: 'HIGH',
          status: 'OPEN',
          dueDate
        },
        update: {
          description: conflict.description,
          area: conflict.area,
          dueDate,
          ...(reopened ? { status: 'OPEN' } : {})
        }
      });
      if (changed) notify.push(conflict);
    } else if (existing && existing.status !== 'RESOLVED') {
      await tx.projectWorkflowIssue.updateMany({
        where: { projectId: workflow.projectId, sourceQuestion: key },
        data: { status: 'RESOLVED' }
      });
      resolved.push(type);
    }
  }
  return { notify, resolved };
}
