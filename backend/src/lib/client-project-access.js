import { normalizeCnpj } from './cnpj.js';

function clientUsername(auth) {
  return String(auth?.user?.username || '').trim().toLowerCase();
}

function clientAccessKeys(auth) {
  const username = clientUsername(auth);
  const cnpj = normalizeCnpj(username);
  return {
    username,
    cnpj: cnpj.length === 14 ? cnpj : ''
  };
}

export function clientProjectAccessWhere(auth) {
  const { username, cnpj } = clientAccessKeys(auth);
  const OR = [
    ...(cnpj ? [{ clientCnpj: cnpj }] : []),
    ...(username.includes('@') ? [
      { clientEmailPrimary: { equals: username, mode: 'insensitive' } },
      { clientEmailCc: { has: username } }
    ] : [])
  ];

  return {
    managerOnly: false,
    ...(OR.length ? { OR } : { id: '__NO_CLIENT_PROJECT_MATCH__' })
  };
}

export function clientCanAccessProject(auth, project) {
  if (project?.deletedAt) return false;
  if (project?.managerOnly) return false;

  const { username, cnpj } = clientAccessKeys(auth);
  if (cnpj && project?.clientCnpj === cnpj) return true;
  if (!username.includes('@')) return false;

  if (String(project?.clientEmailPrimary || '').trim().toLowerCase() === username) return true;
  return Array.isArray(project?.clientEmailCc)
    && project.clientEmailCc.some(cc => String(cc || '').trim().toLowerCase() === username);
}
