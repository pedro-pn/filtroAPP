import { getActiveMissionGroup } from './mission-groups.js';

async function getDb(db) {
  return db || (await import('../prisma.js')).default;
}

async function listInvoices(db, projects) {
  const projectById = new Map(projects.map(project => [project.id, project]));
  const [links, latestRun, lastSuccess] = await Promise.all([
    db.omieProject.findMany({
      where: { projectId: { in: [...projectById.keys()] }, project: { deletedAt: null, managerOnly: false } },
      select: { codigo: true, projectId: true }
    }),
    db.integrationSyncRun.findFirst({ where: { integration: 'OMIE', scope: 'invoices' }, orderBy: { startedAt: 'desc' }, select: { status: true } }),
    db.integrationSyncRun.findFirst({ where: { integration: 'OMIE', scope: 'invoices', status: 'SUCCESS' }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } })
  ]);
  const projectByOmie = new Map(links.map(link => [link.codigo, projectById.get(link.projectId)]));
  const rows = links.length ? await db.omieInvoice.findMany({
    where: { codigoProjeto: { in: [...projectByOmie.keys()] } },
    orderBy: [{ dataEmissao: 'desc' }, { id: 'asc' }]
  }) : [];
  const invoices = rows.map(row => {
    const project = projectByOmie.get(row.codigoProjeto);
    const cnpj = value => String(value ?? '').replace(/\D/g, '');
    return {
      id: row.id, type: row.source, number: row.numero, series: row.serie,
      issuedAt: row.dataEmissao, amount: Number(row.valor),
      customerName: row.clienteNome, customerCnpj: row.clienteCnpj,
      customerDiffers: Boolean(cnpj(row.clienteCnpj) && cnpj(project.clientCnpj) && cnpj(row.clienteCnpj) !== cnpj(project.clientCnpj)),
      receiptStatus: row.receiptStatus, installmentCount: row.installmentCount,
      project: { id: project.id, code: project.code, name: project.name }
    };
  });
  return {
    invoices,
    total: invoices.reduce((sum, invoice) => sum + Math.round(invoice.amount * 100), 0) / 100,
    count: invoices.length,
    linkedProjectCount: new Set(links.map(link => link.projectId)).size,
    projectCount: projects.length,
    lastSyncedAt: lastSuccess?.finishedAt ?? null,
    syncStatus: latestRun?.status === 'RUNNING' ? 'UPDATING'
      : latestRun?.status === 'ERROR' ? (lastSuccess ? 'STALE' : 'ERROR')
        : lastSuccess ? 'READY' : 'WAITING'
  };
}

export async function getProjectInvoices(projectId, { db = null } = {}) {
  db = await getDb(db);
  const project = await db.project.findFirst({
    where: { id: projectId, deletedAt: null, managerOnly: false },
    select: { id: true, code: true, name: true, clientCnpj: true }
  });
  if (!project) return null;
  return listInvoices(db, [project]);
}

export async function getMissionGroupInvoices(groupId, { db = null } = {}) {
  db = await getDb(db);
  const group = await getActiveMissionGroup({ groupId, db });
  const projects = [...new Map(group.members.filter(member => member.project && !member.project.deletedAt)
    .map(member => [member.projectId, { ...member.project, id: member.projectId }])).values()];
  return listInvoices(db, projects);
}
