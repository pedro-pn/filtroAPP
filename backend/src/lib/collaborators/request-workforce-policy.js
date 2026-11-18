import { requireVisibleCollaborators } from './workforce-policy.js';

const singularFields = new Set(['collaboratorId', 'operatorId', 'supervisorCollaboratorId', 'headquartersResponsibleCollaboratorId']);
const pluralFields = new Set(['collaboratorIds', 'laborCollaboratorIds', 'confirmedInactiveCollaboratorIds', 'confirmedPreAdmissionCollaboratorIds', 'confirmedMissionOverlapCollaboratorIds']);

export function requestCollaboratorIds(input) {
  const ids = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, child] of Object.entries(value)) {
      if (singularFields.has(key) && typeof child === 'string' && child) ids.add(child);
      else if (pluralFields.has(key) && Array.isArray(child)) child.filter(id => typeof id === 'string' && id).forEach(id => ids.add(id));
      else visit(child);
    }
  }
  visit(input);
  return [...ids];
}

export async function requireOperationalRequestParticipants(database, req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return;
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/|$)/, '');
  // Master data and RH reception retain every sector. EPI validates visibility
  // when creating a new delivery; existing signatures and documents remain valid.
  // This does not change login/module permissions of these employees.
  if (/^\/(?:epi|admin|users|auth|privacy|notifications|assinaturas)(?:\/|$)/.test(path)
    || /^\/integracoes\/v1\/rh\/conecta(?:\/|$)/.test(path)) return;
  const ids = requestCollaboratorIds(req.body);
  if (ids.length) await requireVisibleCollaborators(database, ids);
}
