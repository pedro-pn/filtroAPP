export function database() {
  let state = { batch: { id: 'batch-1', ownerUserId: 'owner', signers: [] }, documents: [1, 2].map(index => ({
    id: `doc-${index}`, batchId: 'batch-1', batchPosition: index - 1, ownerUserId: 'owner', title: `Contrato ${index}`,
    status: 'RASCUNHO', archivedAt: null, deletedAt: null, pageCount: 2,
    pageDimensions: [1, 2].map(page => ({ page, widthPt: 612, heightPt: 792, rotation: 0 })), signers: [], fields: []
  })), audits: [], groups: [] };
  let inTransaction = false;
  const client = {
    signatureInviteGroup: {
      async create({ data }) { const group = { id: `group-${state.groups.length + 1}`, emailAttempts: 0, emailClaimedAt: null, updatedAt: new Date(), ...data }; state.groups.push(group); return structuredClone(group); },
      async findUnique({ where, include }) {
        const group = state.groups.find(item => where.id ? item.id === where.id : item.tokenHash === where.tokenHash);
        if (!group) return null;
        return structuredClone({ ...group, ...(include?.members ? { members: state.documents.filter(document => !document.deletedAt && ['AGUARDANDO_ASSINATURAS', 'FINALIZANDO', 'CONCLUIDO'].includes(document.status)).flatMap(document => document.signers.filter(signer => signer.groupInviteId === group.id && signer.status !== 'REVOGADO').map(signer => ({ ...signer, document: { ...document, signers: document.signers.map(({ id, status, isRequired = true }) => ({ id, status, isRequired })) } }))) } : {}) });
      },
      async update({ where, data }) { const group = state.groups.find(item => item.id === where.id); apply(group, data); return structuredClone(group); },
      async updateMany({ where, data }) {
        const matched = state.groups.filter(group => (!where.id || group.id === where.id) && (!where.tokenHash || group.tokenHash === where.tokenHash)
          && (!where.emailStatus || (typeof where.emailStatus === 'string' ? group.emailStatus === where.emailStatus : where.emailStatus.in.includes(group.emailStatus)))
          && (!where.emailAttempts?.lt || group.emailAttempts < where.emailAttempts.lt)
          && (where.emailClaimedAt !== null || group.emailClaimedAt === null)
          && (!(where.emailClaimedAt instanceof Date) || group.emailClaimedAt?.getTime() === where.emailClaimedAt.getTime())
          && (!where.emailClaimedAt?.lte || (group.emailClaimedAt && group.emailClaimedAt <= where.emailClaimedAt.lte)));
        for (const group of matched) apply(group, data);
        return { count: matched.length };
      },
      async findMany() { return structuredClone(state.groups); }
    },
    signatureDocumentBatch: {
      async findFirst({ where }) { return where.id === state.batch.id && where.ownerUserId === state.batch.ownerUserId ? structuredClone({ ...state.batch, documents: state.documents.filter(document => !document.deletedAt) }) : null; },
      async updateMany({ where }) { return { count: where.id === state.batch.id && where.ownerUserId === state.batch.ownerUserId ? 1 : 0 }; },
      async update({ data }) { Object.assign(state.batch, data); return structuredClone(state.batch); }
    },
    signatureDocument: {
      async findUnique({ where }) { return structuredClone(state.documents.find(item => item.id === where.id)); },
      async updateMany({ where, data }) { const document = state.documents.find(item => item.id === where.id && (!where.status || item.status === where.status) && !item.deletedAt); if (!document) return { count: 0 }; apply(document, data); return { count: 1 }; },
      async update({ where, data }) { const document = state.documents.find(item => item.id === where.id); Object.assign(document, data); return structuredClone(document); },
      async count({ where }) { return state.documents.filter(item => item.batchId === where.batchId && (!where.status || item.status !== where.status.not)).length; },
      async create({ data }) { const document = { id: 'uploaded', ...data }; state.documents.push(document); return document; }
    },
    signatureDocumentSigner: {
      async findUnique({ where, include }) {
        const document = state.documents.find(document => document.signers.some(signer => where.id ? signer.id === where.id : signer.tokenHash && signer.tokenHash === where.tokenHash));
        const signer = document?.signers.find(signer => where.id ? signer.id === where.id : signer.tokenHash && signer.tokenHash === where.tokenHash);
        return signer ? structuredClone({ ...signer, ...(include?.document ? { document } : {}) }) : null;
      },
      async count({ where }) { return state.documents.find(document => document.id === where.documentId).signers.filter(signer => typeof where.status === 'string' ? signer.status === where.status : !where.status.notIn.includes(signer.status)).length; },
      async updateMany({ where, data }) {
        const document = state.documents.find(document => (!where.documentId || document.id === where.documentId) && document.signers.some(signer => signer.id === where.id));
        const signer = document?.signers.find(item => item.id === where.id);
        if (!signer || (where.status?.in && !where.status.in.includes(signer.status)) || (where.groupInviteId && signer.groupInviteId !== where.groupInviteId)) return { count: 0 };
        if (where.document && (document.deletedAt || document.status !== where.document.status)) return { count: 0 };
        apply(signer, data); return { count: 1 };
      },
      async deleteMany({ where }) { state.documents.find(item => item.id === where.documentId).signers = []; },
      async create({ data }) { state.documents.find(item => item.id === data.documentId).signers.push({ status: 'PENDENTE', fields: [], ...data }); return data; },
      async update({ where, data }) { const signer = state.documents.flatMap(item => item.signers).find(item => item.id === where.id); apply(signer, data); return structuredClone(signer); }
    },
    signatureDocumentField: {
      async deleteMany({ where }) { state.documents.find(item => item.id === where.documentId).fields = []; },
      async createMany({ data }) { for (const row of data) { const document = state.documents.find(item => item.id === row.documentId); document.fields.push(row); document.signers.find(item => item.id === row.signerId).fields.push(row); } }
    },
    signatureDocumentAuditLog: { async create({ data }) { state.audits.push(data); return data; } },
    async $transaction(operation) {
      const before = structuredClone(state);
      inTransaction = true;
      try { return await operation(client); } catch (error) { state = before; throw error; } finally { inTransaction = false; }
    }
  };
  return { client, get state() { return state; }, get inTransaction() { return inTransaction; } };
}

function apply(target, data) {
  for (const [key, value] of Object.entries(data)) target[key] = value && typeof value === 'object' && 'increment' in value ? (target[key] || 0) + value.increment : value;
}
