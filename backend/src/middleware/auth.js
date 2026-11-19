import asyncHandler from '../lib/async-handler.js';
import env from '../config/env.js';
import { hashToken, publicUser } from '../lib/auth.js';
import { trustedClientAccessScopeForUser } from '../lib/client-project-access.js';
import { AccountTypes, hasModuleRole, publicModuleRolesForAccountType, publicModuleRolesForModule } from '../lib/module-roles.js';
import {
  CLIENT_PRIVACY_NOTICE_VERSION,
  clientPrivacyConsentRequired,
  isClientPrivacyConsentAllowedRoute
} from '../lib/privacy-consent.js';
import prisma from '../lib/prisma.js';
import {
  bearerSessionAllowed,
  clearSessionCookie,
  CSRF_HEADER,
  requestCookie,
  SESSION_COOKIE,
  setSessionCookie
} from '../lib/accounts/session-cookie.js';
import { withProjectAccess } from '../lib/projects/access-scope.js';
import { withWorkforceVisibility, workforceVisibilityRequestTarget } from '../lib/collaborators/workforce-visibility-context.js';
import { requireOperationalRequestParticipants } from '../lib/collaborators/request-workforce-policy.js';

export const RDO_INTERNAL_ROLES = publicModuleRolesForModule('rdo', { includeClient: false });
export const RDO_ACCESS_ROLES = publicModuleRolesForModule('rdo');
export const EQUIPAMENTOS_ACCESS_ROLES = publicModuleRolesForModule('equipamentos');
export const ESTOQUE_ACCESS_ROLES = publicModuleRolesForModule('estoque');
export const ACOMPANHAMENTO_ACCESS_ROLES = publicModuleRolesForModule('acompanhamento');
export const QUALIDADE_ACCESS_ROLES = publicModuleRolesForModule('qualidade');
export const INTERNAL_ACCOUNT_ROLES = Array.from(new Set([
  ...publicModuleRolesForAccountType(AccountTypes.ADMIN),
  ...publicModuleRolesForAccountType(AccountTypes.INTERNAL)
]));
export const ROMANEIO_ACCESS_ROLES = publicModuleRolesForModule('romaneio');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findSessionWithRetry(tokenHash, options = {}) {
  const attempts = options.attempts || 3;
  const delayMs = options.delayMs || 25;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const session = await prisma.userSession.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: {
              moduleRoles: true
            }
          }
        }
      });
      if (!session?.user || Object.hasOwn(session.user, 'collaborator')) return session;
      // The nullable FK is already in User. An empty nested relation otherwise
      // sends both Collaborator and JobRole SELECTs on every authenticated page.
      const collaborator = session.user.collaboratorId ? await prisma.collaborator.findUnique({
        where: { id: session.user.collaboratorId }, include: { jobRole: true }
      }) : null;
      return { ...session, user: { ...session.user, collaborator } };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

function originOf(value) {
  try {
    return new URL(String(value)).origin;
  } catch {
    return '';
  }
}

// CSRF para escritas autenticadas por cookie: o app sempre manda o cabeçalho
// X-Filtrovali-Request (um formulário ou <img> de outro site não consegue), e a
// origem (Origin, ou Referer quando ela falta) precisa ser a do próprio sistema.
// Bearer, token da API v1 e rotas públicas por token não passam por aqui.
export function csrfRejection(req, config = env) {
  if (!UNSAFE_METHODS.has(req.method)) return null;
  if (req.get(CSRF_HEADER) !== '1') return 'CSRF_HEADER_MISSING';
  const originHeader = req.get('origin');
  // Origin presente mas opaco ("null": iframe com sandbox, arquivo local) é recusado.
  if (originHeader && !originOf(originHeader)) return 'CSRF_ORIGIN_REJECTED';
  const origin = originOf(originHeader) || originOf(req.get('referer'));
  if (!origin) return null;
  const sameHost = `${req.protocol}://${req.get('host')}`;
  const allowed = config.allowedOrigins || [];
  if (origin === sameHost || allowed.includes(origin)) return null;
  // Em dev/test sem ALLOWED_ORIGIN (proxy do Vite troca o Host), só o cabeçalho vale.
  if (!allowed.length && config.nodeEnv !== 'production') return null;
  return 'CSRF_ORIGIN_REJECTED';
}

function sessionIdle(session, now, config = env) {
  const idleHours = Number(config.sessionIdleHours) || 0;
  if (!idleHours || !session.lastUsedAt) return false;
  return now.getTime() - new Date(session.lastUsedAt).getTime() > idleHours * 60 * 60 * 1000;
}

function touchSession(session, now) {
  const lastUsedAt = session.lastUsedAt ? new Date(session.lastUsedAt).getTime() : 0;
  if (now.getTime() - lastUsedAt < LAST_USED_WRITE_INTERVAL_MS) return;
  // Escrita leve e no máximo a cada 5 min por sessão; falha não derruba o pedido.
  Promise.resolve()
    .then(() => prisma.userSession.updateMany({
      where: { id: session.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_WRITE_INTERVAL_MS) } }] },
      data: { lastUsedAt: now }
    }))
    .catch(() => {});
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const cookieToken = requestCookie(req, SESSION_COOKIE);
  const headerToken = cookieToken ? '' : bearerToken(req);
  const token = cookieToken || headerToken;
  if (!token) {
    return res.status(401).json({ error: 'Sessao ausente.', code: 'SESSION_MISSING' });
  }
  const via = cookieToken ? 'cookie' : 'bearer';
  const now = new Date();

  if (via === 'bearer' && !bearerSessionAllowed(now)) {
    return res.status(401).json({
      error: 'Sessão antiga: entre de novo para continuar.',
      code: 'SESSION_BEARER_RETIRED'
    });
  }

  if (via === 'cookie') {
    const rejection = csrfRejection(req);
    if (rejection) {
      return res.status(403).json({ error: 'Pedido recusado por segurança. Recarregue a página e tente de novo.', code: rejection });
    }
  }

  const session = await findSessionWithRetry(hashToken(token));

  if (!session || session.expiresAt <= now || !session.user.isActive) {
    if (via === 'cookie') clearSessionCookie(res);
    return res.status(401).json({ error: 'Sessão inválida ou expirada.', code: 'SESSION_INVALID' });
  }

  if (sessionIdle(session, now)) {
    await prisma.userSession.deleteMany({ where: { id: session.id } }).catch(() => {});
    if (via === 'cookie') clearSessionCookie(res);
    return res.status(401).json({ error: 'Sua sessão expirou por inatividade. Entre de novo.', code: 'SESSION_IDLE' });
  }

  touchSession(session, now);
  // Upgrade silencioso (transição): quem ainda manda o token antigo por Bearer
  // recebe o cookie e segue sem precisar entrar de novo.
  if (via === 'bearer') setSessionCookie(res, token, session.expiresAt);

  const user = publicUser(session.user);
  const trustedClientScope = await trustedClientAccessScopeForUser(prisma, session.user);

  req.auth = {
    token,
    via,
    sessionId: session.id,
    user: trustedClientScope.emails.length || trustedClientScope.cnpjs.length
      ? { ...user, trustedClientEmails: trustedClientScope.emails, trustedClientCnpjs: trustedClientScope.cnpjs }
      : user,
    rawUser: session.user
  };

  if (clientPrivacyConsentRequired(session.user) && !isClientPrivacyConsentAllowedRoute(req)) {
    return res.status(428).json({
      error: 'Aceite a política de privacidade para continuar.',
      code: 'CLIENT_PRIVACY_CONSENT_REQUIRED',
      privacyPolicyVersion: CLIENT_PRIVACY_NOTICE_VERSION
    });
  }

  await withWorkforceVisibility(workforceVisibilityRequestTarget(req), async () => {
    await requireOperationalRequestParticipants(prisma, req);
    withProjectAccess(user, next);
  });
});

export function requireManager(req, res, next) {
  if (!req.auth || req.auth.user.accountType !== 'ADMIN' || !hasModuleRole(req.auth.user, 'rdo:manager')) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor.' });
  }

  next();
}

export function requireHubAdmin(req, res, next) {
  if (!req.auth || req.auth.user.accountType !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }

  next();
}

export function requireInternalUser(req, res, next) {
  if (!req.auth || !hasModuleRole(req.auth.user, RDO_INTERNAL_ROLES)) {
    return res.status(403).json({ error: 'Acesso restrito a usuários internos.' });
  }

  next();
}

export function requireAnyInternalAccount(req, res, next) {
  if (!req.auth || req.auth.user.accountType === 'CLIENT') {
    return res.status(403).json({ error: 'Acesso restrito a contas internas.' });
  }

  next();
}

export function requireModuleRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !hasModuleRole(req.auth.user, roles)) {
      return res.status(403).json({ error: 'Acesso restrito ao módulo.' });
    }

    next();
  };
}

export function requireEquipamentosAccess(req, res, next) {
  if (!req.auth || !hasModuleRole(req.auth.user, EQUIPAMENTOS_ACCESS_ROLES)) {
    return res.status(403).json({ error: 'Acesso restrito ao módulo Equipamentos.' });
  }

  next();
}

export function requireEquipamentosManager(req, res, next) {
  if (!req.auth || !hasModuleRole(req.auth.user, 'equipamentos:manager')) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor de Equipamentos.' });
  }

  next();
}

export function requireEstoqueAccess(req, res, next) {
  if (!req.auth || !hasModuleRole(req.auth.user, ESTOQUE_ACCESS_ROLES)) {
    return res.status(403).json({ error: 'Acesso restrito ao módulo Estoque.' });
  }

  next();
}

export function requireEstoqueManager(req, res, next) {
  if (!req.auth || !hasModuleRole(req.auth.user, 'estoque:manager')) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor de Estoque.' });
  }

  next();
}

export function requireQualidadeAccess(req, res, next) {
  if (!req.auth || !hasModuleRole(req.auth.user, QUALIDADE_ACCESS_ROLES)) {
    return res.status(403).json({ error: 'Acesso restrito ao módulo Qualidade.' });
  }

  next();
}

export function requireQualidadeManager(req, res, next) {
  if (!req.auth || !hasModuleRole(req.auth.user, 'qualidade:manager')) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor de Qualidade.' });
  }

  next();
}

// Acompanhamento: admin do hub OU papel do módulo (mantém admins com acesso).
export function requireAcompanhamentoAccess(req, res, next) {
  if (!req.auth || (req.auth.user.accountType !== 'ADMIN' && !hasModuleRole(req.auth.user, ACOMPANHAMENTO_ACCESS_ROLES))) {
    return res.status(403).json({ error: 'Acesso restrito ao módulo Acompanhamento.' });
  }

  next();
}

export function requireAcompanhamentoManager(req, res, next) {
  if (!req.auth || (req.auth.user.accountType !== 'ADMIN' && !hasModuleRole(req.auth.user, 'acompanhamento:manager'))) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor de Acompanhamento.' });
  }

  next();
}

// Gestor do módulo Acompanhamento? (ADMIN ou papel acompanhamento:manager) — para gate de dados
// sensíveis (custo/salário) em endpoints acessíveis a visualizadores.
export function isAcompanhamentoManager(user) {
  return Boolean(user) && (user.accountType === 'ADMIN' || hasModuleRole(user, 'acompanhamento:manager'));
}

// Usuário que pode ver os custos de mão de obra calculados no Acompanhamento.
// Configuração de parâmetros continua restrita ao gestor; esta permissão é só leitura operacional.
export function canViewAcompanhamentoLaborCosts(user) {
  return Boolean(user) && (user.accountType === 'ADMIN' || hasModuleRole(user, ACOMPANHAMENTO_ACCESS_ROLES));
}
