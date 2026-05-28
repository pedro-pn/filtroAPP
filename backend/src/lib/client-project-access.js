import { normalizeCnpj } from './cnpj.js';

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.includes('@') ? email : '';
}

function clientUsername(auth) {
  return String(auth?.user?.username || '').trim().toLowerCase();
}

function verifiedClientEmail(auth) {
  if (auth?.user?.role !== 'CLIENT' || auth?.user?.accountType !== 'CLIENT') return '';
  if (!auth?.user?.emailVerifiedAt) return '';
  return normalizeEmail(auth?.user?.email);
}

function clientTrustedEmails(auth) {
  return Array.isArray(auth?.user?.trustedClientEmails)
    ? auth.user.trustedClientEmails.map(normalizeEmail).filter(Boolean)
    : [];
}

function clientTrustedCnpjs(auth) {
  return Array.isArray(auth?.user?.trustedClientCnpjs)
    ? auth.user.trustedClientCnpjs.map(normalizeCnpj).filter(value => value.length === 14)
    : [];
}

function clientAccessKeys(auth) {
  const username = clientUsername(auth);
  const cnpjs = Array.from(new Set([
    normalizeCnpj(username),
    normalizeCnpj(auth?.user?.clientCnpj),
    ...clientTrustedCnpjs(auth)
  ].filter(value => value.length === 14)));
  const emails = Array.from(new Set([
    username.includes('@') ? username : '',
    verifiedClientEmail(auth),
    ...clientTrustedEmails(auth)
  ].filter(Boolean)));
  return {
    username,
    cnpj: cnpjs[0] || '',
    cnpjs,
    emails
  };
}

export function clientAccessEmails(auth) {
  return clientAccessKeys(auth).emails;
}

function userClientCnpjs(user) {
  return Array.from(new Set([
    normalizeCnpj(user?.username),
    normalizeCnpj(user?.clientCnpj)
  ].filter(value => value.length === 14)));
}

export function projectIncludesClientEmail(project, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  if (normalizeEmail(project?.clientEmailPrimary) === normalizedEmail) return true;
  if (Array.isArray(project?.clientEmailCc)
    && project.clientEmailCc.some(cc => normalizeEmail(cc) === normalizedEmail)) {
    return true;
  }
  return projectHasClientSignerEmail(project, [normalizedEmail]);
}

export async function trustedClientAccessEmailsForUser(prisma, user) {
  const scope = await trustedClientAccessScopeForUser(prisma, user);
  return scope.emails;
}

export async function trustedClientAccessScopeForUser(prisma, user) {
  if (user?.role !== 'CLIENT' || user?.accountType !== 'CLIENT') {
    return { emails: [], cnpjs: [] };
  }

  const emails = new Set([
    normalizeEmail(user?.username),
    user?.emailVerifiedAt ? normalizeEmail(user?.email) : ''
  ].filter(Boolean));
  const cnpjs = new Set(userClientCnpjs(user));

  const accountEmail = normalizeEmail(user?.email);
  let canTrustAccountEmail = !!accountEmail && emails.has(accountEmail);
  if (!accountEmail || emails.has(accountEmail)) {
    canTrustAccountEmail = !!accountEmail;
  } else {
    const accountCnpjs = userClientCnpjs(user);
    if (accountCnpjs.length && typeof prisma?.project?.findMany === 'function') {
      // Historical links prove legacy CNPJ accounts were provisioned with this email.
      const linkedProjects = await prisma.project.findMany({
        where: {
          clientCnpj: { in: accountCnpjs }
        },
        select: {
          clientEmailPrimary: true,
          clientEmailCc: true,
          clientSigners: true
        }
      });
      canTrustAccountEmail = linkedProjects.some(project => projectIncludesClientEmail(project, accountEmail));
      if (canTrustAccountEmail) {
        emails.add(accountEmail);
      }
    }
  }

  if (canTrustAccountEmail && typeof prisma?.user?.findMany === 'function') {
    const linkedUsers = await prisma.user.findMany({
      where: {
        role: 'CLIENT',
        OR: [
          { username: { equals: accountEmail, mode: 'insensitive' } },
          { email: { equals: accountEmail, mode: 'insensitive' } }
        ]
      },
      select: {
        username: true,
        clientCnpj: true
      }
    });
    for (const linkedUser of linkedUsers) {
      for (const cnpj of userClientCnpjs(linkedUser)) {
        cnpjs.add(cnpj);
      }
    }
  }

  return {
    emails: Array.from(emails),
    cnpjs: Array.from(cnpjs)
  };
}

export function projectHasClientSignerEmail(project, emails) {
  const emailSet = new Set((emails || [])
    .map(email => String(email || '').trim().toLowerCase())
    .filter(Boolean));
  if (!emailSet.size || !Array.isArray(project?.clientSigners)) return false;

  return project.clientSigners.some(signer => (
    emailSet.has(String(signer?.email || '').trim().toLowerCase())
  ));
}

export function clientProjectAccessWhere(auth) {
  const { cnpjs, emails } = clientAccessKeys(auth);
  const OR = [
    ...(cnpjs.length ? [{ clientCnpj: { in: cnpjs } }] : []),
    ...emails.map(email => ({ clientEmailPrimary: { equals: email, mode: 'insensitive' } })),
    ...(emails.length ? [{ clientEmailCc: { hasSome: emails } }] : [])
  ];

  return {
    managerOnly: false,
    ...(OR.length ? { OR } : { id: '__NO_CLIENT_PROJECT_MATCH__' })
  };
}

export async function clientProjectAccessWhereWithSigners(prisma, auth) {
  const trustedScope = await trustedClientAccessScopeForUser(prisma, auth?.rawUser || auth?.user);
  const scopedAuth = trustedScope.emails.length || trustedScope.cnpjs.length
    ? { ...auth, user: { ...auth.user, trustedClientEmails: trustedScope.emails, trustedClientCnpjs: trustedScope.cnpjs } }
    : auth;
  const baseWhere = clientProjectAccessWhere(scopedAuth);
  const emails = clientAccessEmails(scopedAuth);
  if (!emails.length) return baseWhere;

  const signerProjects = await prisma.project.findMany({
    where: {
      managerOnly: false
    },
    select: {
      id: true,
      clientSigners: true
    }
  });
  const signerProjectIds = signerProjects
    .filter(project => projectHasClientSignerEmail(project, emails))
    .map(project => project.id);

  if (!signerProjectIds.length) return baseWhere;

  const { OR = [], id: _ignoredNoMatchId, ...rest } = baseWhere;
  return {
    ...rest,
    OR: [
      ...OR,
      { id: { in: signerProjectIds } }
    ]
  };
}

export function clientCanAccessProject(auth, project) {
  if (project?.managerOnly) return false;

  const { cnpjs, emails } = clientAccessKeys(auth);
  if (cnpjs.includes(String(project?.clientCnpj || '').replace(/\D/g, ''))) return true;
  if (!emails.length) return false;

  if (emails.includes(String(project?.clientEmailPrimary || '').trim().toLowerCase())) return true;
  if (Array.isArray(project?.clientEmailCc)
    && project.clientEmailCc.some(cc => emails.includes(String(cc || '').trim().toLowerCase()))) {
    return true;
  }
  return projectHasClientSignerEmail(project, emails);
}
