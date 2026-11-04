import { hasModuleRole } from '../module-roles.js';
import { requireManager } from '../../middleware/auth.js';

export const EFETIVO_ACCESS_ROLES = [
  'efetivo:manager',
  'efetivo:viewer',
  'efetivo:commercial',
  'efetivo:operations',
  'efetivo:assets',
  'efetivo:supplies',
  'efetivo:administrative',
  'efetivo:qsms'
];

export function isEfetivoManager(user) {
  return Boolean(user) && (
    user.accountType === 'ADMIN'
    || hasModuleRole(user, 'efetivo:manager')
  );
}

export function canViewEfetivo(user) {
  return Boolean(user) && (
    user.accountType === 'ADMIN'
    || hasModuleRole(user, EFETIVO_ACCESS_ROLES)
  );
}

export function canEditEfetivoCommercial(user) {
  return Boolean(user) && (
    user.accountType === 'ADMIN'
    || hasModuleRole(user, ['efetivo:manager', 'efetivo:commercial'])
  );
}

export function canEditEfetivoChecklistArea(user, areaRoles = []) {
  return Boolean(user) && areaRoles.length > 0 && hasModuleRole(user, areaRoles);
}

// Conferência semanal de alocação (feature 037). O papel é dedicado e NÃO entra em
// EFETIVO_ACCESS_ROLES: quem só confere alocação não deve ler o restante do Efetivo.
export const ALLOCATION_REVIEW_ROLE = 'efetivo:allocation-review';

export function isAppAdmin(user) {
  return Boolean(user) && user.accountType === 'ADMIN';
}

export function canReviewAllocation(user) {
  return isAppAdmin(user) || (Boolean(user) && hasModuleRole(user, ALLOCATION_REVIEW_ROLE));
}

export function requireAllocationReviewer(req, res, next) {
  if (!canReviewAllocation(req.auth?.user)) {
    return res.status(403).json({
      error: 'Acesso restrito à conferência de alocação.',
      code: 'ALLOCATION_REVIEW_FORBIDDEN'
    });
  }
  next();
}

export function requireEfetivoManager(req, res, next) {
  if (!isEfetivoManager(req.auth?.user)) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor de Efetivo Operacional.' });
  }
  next();
}

export function requireEfetivoViewer(req, res, next) {
  if (!canViewEfetivo(req.auth?.user)) {
    return res.status(403).json({ error: 'Acesso restrito ao módulo Efetivo Operacional.' });
  }
  next();
}

export function requireJobRolePatchAccess(req, res, next) {
  const changes = req.body && typeof req.body === 'object' ? req.body : {};
  const changesOperational = Object.prototype.hasOwnProperty.call(changes, 'isOperational');
  const changesStandardFields = ['name', 'order', 'isActive'].some(key => (
    Object.prototype.hasOwnProperty.call(changes, key)
  ));
  const afterEfetivoCheck = () => (
    changesStandardFields ? requireManager(req, res, next) : next()
  );
  if (changesOperational) return requireEfetivoManager(req, res, afterEfetivoCheck);
  return afterEfetivoCheck();
}
