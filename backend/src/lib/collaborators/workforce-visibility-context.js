import { AsyncLocalStorage } from 'node:async_hooks';
import { defaultWorkforceVisibilityRules, WORKFORCE_VISIBILITY_TARGETS } from '../../../../shared/modules/workforce-visibility.js';
import { invalidateCollaboratorDerivedCaches } from '../cache/invalidation.js';

const scope = new AsyncLocalStorage();
let current = { version: 1, rules: defaultWorkforceVisibilityRules() };

export function publishWorkforceVisibility(configuration) {
  // Keep request snapshots immutable when an administrator saves during a read.
  const next = structuredClone(configuration);
  if (next.version < current.version) return;
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  current = next;
  if (changed) invalidateCollaboratorDerivedCaches();
}

export function withWorkforceVisibility(target, callback, configuration = scope.getStore()?.configuration || current) {
  return scope.run({ target: target || scope.getStore()?.target || null, configuration }, callback);
}

export function workforceVisibilityTarget(preferredTarget = 'RDO') {
  return scope.getStore()?.target || preferredTarget;
}

export function workforceVisibilityClasses(preferredTarget = 'RDO') {
  const configuration = scope.getStore()?.configuration || current;
  return configuration.rules[workforceVisibilityTarget(preferredTarget)] || [];
}

export function workforceVisibilityCacheKey(preferredTarget = 'RDO') {
  const configuration = scope.getStore()?.configuration || current;
  return JSON.stringify([workforceVisibilityTarget(preferredTarget), configuration.version, workforceVisibilityClasses(preferredTarget)]);
}

export function workforceVisibilityTargetLabel(preferredTarget) {
  return WORKFORCE_VISIBILITY_TARGETS.find(item => item.key === workforceVisibilityTarget(preferredTarget))?.label || 'esta listagem';
}

export function workforceVisibilityRequestTarget(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/|$)/, '');
  if (/^\/integracoes\//.test(path)) return 'API';
  if (/^\/epi(?:\/|$)/.test(path)) return 'EPI';
  if (/^\/efetivo\/conferencia-alocacao(?:\/|$)/.test(path)) return 'ALLOCATION_REVIEW';
  if (/^\/efetivo\/(?:produtividade|colaboradores|ausencias)(?:\/|$)/.test(path)) return 'PRODUCTIVITY';
  if (/^\/(?:efetivo|workforce)(?:\/|$)/.test(path)) return 'EFETIVO';
  if (/^\/acompanhamento(?:\/|$)/.test(path)) return 'ACOMPANHAMENTO';
  if (/^\/equipamentos(?:\/|$)/.test(path)) return 'EQUIPMENT';
  if (/^\/(?:romaneio|logistica)(?:\/|$)/.test(path)) return 'ROMANEIO';
  if (/^\/(?:rdo|collaborators|reports|bootstrap|operational-reports|job-roles)(?:\/|$)/.test(path)) return 'RDO';
  return null;
}
