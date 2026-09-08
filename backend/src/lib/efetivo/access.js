import { hasModuleRole } from '../module-roles.js';
import { requireManager } from '../../middleware/auth.js';

export const EFETIVO_ACCESS_ROLES = ['efetivo:manager', 'efetivo:viewer'];

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
