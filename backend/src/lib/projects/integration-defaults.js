import { Prisma } from '@prisma/client';
import { clearProjectDerivedCaches } from '../resource-list-cache.js';

export const PROJECT_DEFAULT_VALUES = Object.freeze({
  clientSegment: null, workdayHours: '09:00', weekendWorkdayHours: '08:00',
  includesSaturday: false, includesSunday: false
});
export const projectIntegrationSelect = {
  integrationDefaults: true, registrationPending: true,
  ...Object.fromEntries(Object.keys(PROJECT_DEFAULT_VALUES).map(key => [key, true]))
};

export const initialIntegrationDefaults = () => ({ values: { ...PROJECT_DEFAULT_VALUES }, overrides: [] });

// Só os campos realmente alterados pelo gestor deixam de acompanhar a origem.
export function manualIntegrationDefaults(project, input) {
  const changed = Object.keys(PROJECT_DEFAULT_VALUES).filter(key =>
    Object.hasOwn(input, key) && input[key] !== project[key]);
  if (!changed.length) return {};
  const state = project.integrationDefaults || { values: {}, overrides: [] };
  return { integrationDefaults: { ...state, overrides: [...new Set([...(state.overrides || []), ...changed])] } };
}

export function projectDefaultsUpdate(project, incoming) {
  const state = project.integrationDefaults || { values: {}, overrides: [] };
  const values = { ...state.values };
  const data = {};
  for (const key of Object.keys(PROJECT_DEFAULT_VALUES)) {
    if (!Object.hasOwn(incoming, key) || incoming[key] == null || state.overrides?.includes(key)) continue;
    const tracked = Object.hasOwn(values, key);
    const untouched = tracked ? project[key] === values[key]
      : key === 'clientSegment' ? !project.clientSegment
        : project.registrationPending && project[key] === PROJECT_DEFAULT_VALUES[key];
    if (!untouched) continue;
    if (project[key] !== incoming[key]) data[key] = incoming[key];
    values[key] = incoming[key];
  }
  if (JSON.stringify(values) !== JSON.stringify(state.values)) {
    data.integrationDefaults = { ...state, values };
  }
  return data;
}

export async function applyProjectIntegrationDefaults(tx, projectId, incoming) {
  if (!Object.keys(incoming).length) return;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: projectIntegrationSelect });
  if (!project) return;
  const data = projectDefaultsUpdate(project, incoming);
  if (!Object.keys(data).length) return;
  const current = Object.fromEntries(Object.keys(PROJECT_DEFAULT_VALUES).map(key => [key, project[key]]));
  const saved = await tx.project.updateMany({ where: { id: projectId, ...current,
    integrationDefaults: { equals: project.integrationDefaults ?? Prisma.DbNull } }, data });
  if (saved.count !== 1) throw Object.assign(new Error('O cadastro do projeto mudou durante a integração.'), { code: 'P2034' });
  clearProjectDerivedCaches();
}
