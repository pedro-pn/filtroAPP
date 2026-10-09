export function databookFixture() {
  const project = { id: 'project_1', code: '5815-test', name: 'Projeto de teste', clientName: 'Cliente', clientCnpj: '00000000000000', contractCode: 'REF', location: 'Local', isActive: true, deletedAt: null, managerOnly: false };
  const report = (id, date, type = 'RDO') => ({ id, projectId: project.id, reportDate: new Date(`${date}T00:00:00Z`), reportType: type,
    sequenceNumber: Number(id.slice(-1)) || 1, status: 'APPROVED', deletedAt: null, updatedAt: new Date('2026-10-01T12:00:00Z'),
    specialConditions: {}, services: [], attachments: [], versions: [], reportSignatures: [], clientReviews: [] });
  const reports = [report('r1', '2026-09-16'), report('r2', '2026-09-17', 'RLQ'), report('r3', '2026-10-07')];
  const state = { project, reports, movements: [], documents: [], records: [], locks: 0 };
  const matches = (item, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => matches(item, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('lt' in value) return item[key] !== null && item[key] < value.lt;
      if ('in' in value) return value.in.includes(item[key]);
      return true;
    }
    return item[key] === value;
  });
  const database = {
    project: { async findFirst({ where }) { return matches(project, where) ? project : null; } },
    report: { async findMany({ where }) {
      return state.reports.filter(report => report.projectId === where.projectId && !report.deletedAt &&
        (!where.reportDate || (report.reportDate >= where.reportDate.gte && report.reportDate < where.reportDate.lt)));
    } },
    stockMovement: { async findMany() { return state.movements; } },
    projectDocument: { async findMany() { return state.documents; } },
    projectDatabook: {
      async findFirst({ where, orderBy } = {}) {
        const result = state.records.filter(record => matches(record, where));
        if (orderBy?.revision) result.sort((a, b) => b.revision - a.revision);
        return result[0] || null;
      },
      async create({ data }) {
        const record = { id: `book_${state.records.length + 1}`, status: 'PENDING', progress: 0, attempts: 0, lockedAt: null, leaseToken: null,
          error: null, createdAt: new Date('2026-10-08T12:00:00Z'), ...data };
        state.records.push(record); return record;
      },
      async updateMany({ where, data }) {
        const found = state.records.filter(record => matches(record, where));
        for (const record of found) for (const [key, value] of Object.entries(data)) record[key] = value?.increment ? record[key] + value.increment : value;
        return { count: found.length };
      }
    },
    async $queryRaw() { state.locks += 1; }
  };
  let tail = Promise.resolve();
  database.$transaction = fn => {
    const pending = tail.then(() => fn(database)); tail = pending.catch(() => {}); return pending;
  };
  return { database, state };
}

export const databookManager = { id: 'manager_1', name: 'Gestor', accountType: 'INTERNAL', moduleRoles: ['acompanhamento:manager'] };
export const databookInput = { title: 'Etapa 1', startDate: '2026-09-16', endDate: '2026-09-17', summary: '',
  productsReviewed: true, reportIds: ['r1', 'r2'], photos: [], products: [], documentVersionIds: [] };
