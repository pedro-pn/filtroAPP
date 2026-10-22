import { canReviewRdoReports } from '../../../../shared/modules/rdo-permissions.js';
import { hasModuleRole, isHubAdmin, publicModuleRoleDefinitions, publicModuleRolesForModule } from '../module-roles.js';
import { canViewEfetivo } from '../efetivo/access.js';
import { efetivoProjectWhere } from '../efetivo/project-visibility.js';
import { projectListWhereForAuth } from '../projects/access.js';
import { hasReportEmissionPermission } from '../operational-reports/permissions.js';
import prisma from '../prisma.js';

const PROJECT_KINDS = ['PROJECT_CREATED', 'PROJECT_RECEIVED', 'PROJECT_READY'];
const RDO_ROLES = publicModuleRolesForModule('rdo');
const TRACKING_ROLES = publicModuleRolesForModule('acompanhamento');
const MANAGER_ROLES = publicModuleRoleDefinitions().map(role => role.public).filter(role => role.endsWith(':manager'));
const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }];
const OPERATIONAL_TYPES = ['RDO_MAINTENANCE', 'RDO_PRODUCTION'];

function hasTrackingAccess(user) {
  return user.accountType === 'ADMIN' || hasModuleRole(user, TRACKING_ROLES);
}

// Esta condição é compartilhada pela lista, contador e gravações de leitura.
// A revogação de uma permissão esconde imediatamente inclusive eventos antigos.
export async function notificationAccessWhere(auth, client = prisma) {
  const user = auth.user;
  const scopes = [];
  if (user.isActive && user.accountType !== 'CLIENT' && (isHubAdmin(user) || hasModuleRole(user, MANAGER_ROLES))) {
    scopes.push({ kind: 'EXECUTION_WITHOUT_REPORT_OPERATOR', project: { deletedAt: null, operatorId: null } });
  }
  if (hasModuleRole(user, RDO_ROLES)) {
    const project = await projectListWhereForAuth(auth, undefined, client);
    scopes.push({ kind: { in: PROJECT_KINDS }, project });
    if (user.accountType !== 'CLIENT' && ['MANAGER', 'COORDINATOR'].includes(user.role)) {
      scopes.push({
        kind: 'REPORT_PENDING',
        project: { deletedAt: null, ...(user.role === 'MANAGER' ? {} : { managerOnly: false }) },
        report: {
          deletedAt: null, status: 'PENDING', reportType: { notIn: OPERATIONAL_TYPES },
          project: { deletedAt: null, ...(user.role === 'MANAGER' ? {} : { managerOnly: false }) }
        }
      });
    }
    if (user.accountType !== 'CLIENT') {
      scopes.push({
        kind: 'REPORT_RETURNED',
        project: { deletedAt: null, ...(user.role === 'MANAGER' ? {} : { managerOnly: false }) },
        report: {
          deletedAt: null,
          status: 'RETURNED',
          reportType: { notIn: OPERATIONAL_TYPES },
          project: { deletedAt: null, ...(user.role === 'MANAGER' ? {} : { managerOnly: false }) },
          ...(canReviewRdoReports(user) ? {} : {
            createdByUserId: user.id,
            project
          })
        }
      });
    }
  }
  if (user.accountType !== 'CLIENT') {
    const reportTypes = [];
    if (hasReportEmissionPermission(user, 'MAINTENANCE')) reportTypes.push('RDO_MAINTENANCE');
    if (hasReportEmissionPermission(user, 'PRODUCTION')) reportTypes.push('RDO_PRODUCTION');
    if (reportTypes.length) {
      const report = { deletedAt: null, reportType: { in: reportTypes } };
      scopes.push({ kind: 'REPORT_PENDING', project: { deletedAt: null }, report: { ...report, status: 'PENDING' } });
      scopes.push({ kind: 'REPORT_RETURNED', project: { deletedAt: null }, report: { ...report, status: 'RETURNED', createdByUserId: user.id } });
    }
  }
  if (hasTrackingAccess(user)) {
    scopes.push({
      kind: { in: [...PROJECT_KINDS, 'PROPOSAL_RECEIVED'] },
      project: { deletedAt: null, registrationPending: false }
    });
  }
  if (canViewEfetivo(user)) {
    scopes.push({ kind: { in: PROJECT_KINDS }, project: efetivoProjectWhere() });
  }
  return scopes.length ? { OR: scopes } : { id: { in: [] } };
}

function destination(event, user) {
  const projectId = encodeURIComponent(event.projectId);
  if (event.kind === 'EXECUTION_WITHOUT_REPORT_OPERATOR' && !hasTrackingAccess(user) && !canViewEfetivo(user)
    && !hasModuleRole(user, ['rdo:manager', 'rdo:coordinator'])) return '/modulos';
  if (event.reportId) {
    const id = encodeURIComponent(event.reportId);
    if (OPERATIONAL_TYPES.includes(event.report.reportType)) {
      const type = event.report.reportType === 'RDO_MAINTENANCE' ? 'manutencao' : 'producao';
      return `/manutencao-producao/relatorio/novo?tipo=${type}&editar=${id}`;
    }
    const base = user.role === 'MANAGER' ? '/rdo/gestor/relatorio'
      : user.role === 'COORDINATOR' ? '/rdo/coordenador/relatorio' : '/rdo/relatorios';
    return `${base}/${id}`;
  }
  if (hasTrackingAccess(user) && !event.project.registrationPending) {
    return `/acompanhamento?section=projetos&project=${projectId}`;
  }
  if (canViewEfetivo(user) && !event.project.managerOnly && !efetivoProjectWhere().code.notIn.includes(event.project.code)) {
    return `/efetivo?section=evolucao&projeto=${projectId}`;
  }
  if (user.role === 'MANAGER') return '/rdo/gestor?tab=projetos';
  if (user.role === 'COORDINATOR') return '/rdo/coordenador';
  if (user.role === 'CLIENT') return '/rdo/cliente';
  return '/rdo/andamento';
}

export function publicNotification(event, user) {
  const project = `${event.project.code} — ${event.project.name}`;
  const titles = {
    PROJECT_CREATED: 'Novo projeto cadastrado',
    PROJECT_RECEIVED: 'Novo projeto recebido',
    PROJECT_READY: 'Cadastro de projeto liberado',
    REPORT_PENDING: 'Relatório pendente de revisão',
    REPORT_RETURNED: 'Relatório devolvido para correção',
    PROPOSAL_RECEIVED: 'Nova proposta extra escopo',
    EXECUTION_WITHOUT_REPORT_OPERATOR: 'Execução sem operador para os relatórios'
  };
  const report = event.report;
  const reportLabel = report && ({ RDO_MAINTENANCE: 'RDO de manutenção', RDO_PRODUCTION: 'RDO de produção' }[report.reportType] || report.reportType);
  const detail = report
    ? `${reportLabel}${report.sequenceNumber != null ? ` nº ${report.sequenceNumber}` : ''} · ${project}`
    : event.kind === 'PROPOSAL_RECEIVED'
      ? `Proposta ${event.data.proposalCode}${event.data.revision != null ? ` · revisão ${event.data.revision}` : ''} · ${project}`
      : event.kind === 'EXECUTION_WITHOUT_REPORT_OPERATOR'
        ? `O projeto ${project} iniciou a execução e não possui operador responsável pela criação dos relatórios.${event.data.defaultResponsibleUserId ? ' Gestor de Contrato definido como responsável padrão.' : ''}`
        : project;
  return {
    id: event.id,
    kind: event.kind,
    title: titles[event.kind],
    description: detail,
    createdAt: event.createdAt.toISOString(),
    readAt: event.reads[0]?.readAt.toISOString() || null,
    href: destination(event, user)
  };
}

export async function listNotifications(auth, { filter = 'all', cursor, limit = 20 } = {}, client = prisma) {
  const snapshotAt = new Date();
  const access = await notificationAccessWhere(auth, client);
  const unread = { reads: { none: { userId: auth.user.id } } };
  const scope = { AND: [access, { createdAt: { lte: snapshotAt } }] };
  const where = { AND: [scope, ...(filter === 'unread' ? [unread] : [])] };
  if (cursor) {
    const createdAt = new Date(cursor.createdAt);
    where.AND.push({ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursor.id } }] });
  }
  const [events, unreadCount] = await Promise.all([
    client.notificationEvent.findMany({
      where, orderBy, take: limit + 1,
      include: {
        project: { select: { code: true, name: true, managerOnly: true, registrationPending: true } },
        report: { select: { reportType: true, sequenceNumber: true } },
        reads: { where: { userId: auth.user.id }, select: { readAt: true } }
      }
    }),
    client.notificationEvent.count({ where: { AND: [scope, unread] } })
  ]);
  const page = events.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(event => publicNotification(event, auth.user)),
    unreadCount,
    snapshotAt: snapshotAt.toISOString(),
    nextCursor: events.length > limit && last
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null
  };
}

export async function markNotificationRead(auth, id, client = prisma) {
  const access = await notificationAccessWhere(auth, client);
  const event = await client.notificationEvent.findFirst({ where: { AND: [access, { id }] }, select: { id: true } });
  if (!event) return false;
  await client.notificationRead.upsert({
    where: { userId_notificationId: { userId: auth.user.id, notificationId: id } },
    create: { userId: auth.user.id, notificationId: id }, update: {}
  });
  return true;
}

export async function markAllNotificationsRead(auth, before, client = prisma) {
  const access = await notificationAccessWhere(auth, client);
  let count = 0;
  // Lotes limitados para não carregar todo o histórico de uma conta em memória.
  for (;;) {
    const events = await client.notificationEvent.findMany({
      where: { AND: [access, { createdAt: { lte: before }, reads: { none: { userId: auth.user.id } } }] },
      select: { id: true }, take: 500
    });
    if (!events.length) return count;
    const result = await client.notificationRead.createMany({
      data: events.map(event => ({ userId: auth.user.id, notificationId: event.id })), skipDuplicates: true
    });
    count += result.count;
  }
}
