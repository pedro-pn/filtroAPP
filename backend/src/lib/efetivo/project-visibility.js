import { efetivoProjectBaseWhere } from './project-visibility-rules.js';
import { projectChannelWhere } from '../projects/distribution.js';

export function efetivoProjectWhere() {
  return {
    ...efetivoProjectBaseWhere(),
    ...projectChannelWhere('efetivo'),
  };
}

export function efetivoWorkflowProjectWhere(extra = {}, { includeFinished = false, includeInactive = false } = {}) {
  const where = { ...efetivoProjectWhere(), ...extra };
  if (!includeInactive) {
    if (!includeFinished) where.isActive = true;
    else where.AND = [...(where.AND || []), { OR: [
      { isActive: true },
      { workflow: { is: { stage: 'FINISHED' } } },
      { workflow: { is: null }, efetivoMissionPlans: { some: {
        stage: 'FINISHED', deletedAt: null, scheduleStatus: { not: 'CANCELLED' },
        plan: { kind: 'OFFICIAL', status: 'ACTIVE' }
      } } }
    ] }];
  }
  return where;
}
