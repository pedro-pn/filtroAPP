let sequence = 0;
const id = prefix => `${prefix}_${++sequence}`;

export function createProjectDocumentsDatabase({ stage = 'INITIAL_ANALYSIS' } = {}) {
  const state = {
    project: {
      id: 'project_1', code: 'OBR-001', name: 'Obra teste', isActive: true, deletedAt: null,
      workflow: { projectId: 'project_1', stage, leaderUserId: 'leader_1', version: 2, mobilizationAuthorizedAt: null, mobilizationAuthorizationVersion: null }
    },
    documents: [],
    versions: [],
    signatures: [],
    events: [],
    reports: []
  };

  const hydrateVersion = version => version ? {
    ...version,
    createdBy: version.createdByUserId ? { id: version.createdByUserId, name: 'Usuário' } : null,
    acceptanceRecordedBy: version.acceptanceRecordedByUserId ? { id: version.acceptanceRecordedByUserId, name: 'Usuário' } : null,
    signatureDocument: state.signatures.find(item => item.id === version.signatureDocumentId) || null
  } : null;
  const hydrateDocument = (document, history = true) => {
    const versions = state.versions.filter(item => item.documentId === document.id).sort((a, b) => b.sequence - a.sequence);
    return {
      ...document,
      responsible: document.responsibleUserId ? { id: document.responsibleUserId, name: 'Responsável' } : null,
      createdBy: document.createdByUserId ? { id: document.createdByUserId, name: 'Usuário' } : null,
      updatedBy: document.updatedByUserId ? { id: document.updatedByUserId, name: 'Usuário' } : null,
      archivedBy: document.archivedByUserId ? { id: document.archivedByUserId, name: 'Usuário' } : null,
      currentVersion: hydrateVersion(state.versions.find(item => item.id === document.currentVersionId)),
      ...(history ? { versions: versions.map(hydrateVersion) } : {})
    };
  };
  const applyData = (target, data) => {
    for (const [key, value] of Object.entries(data || {})) {
      if (value && typeof value === 'object' && Object.hasOwn(value, 'increment')) target[key] = (target[key] || 0) + value.increment;
      else target[key] = value;
    }
    target.updatedAt = new Date();
    return target;
  };

  const database = {
    $transaction: operation => operation(database),
    project: {
      findFirst: async ({ where }) => where.id === state.project.id && state.project.isActive && !state.project.deletedAt ? structuredClone(state.project) : null
    },
    user: {
      findFirst: async ({ where }) => where.id ? { id: where.id, name: 'Responsável', isActive: true } : null
    },
    projectDocument: {
      create: async ({ data }) => {
        const now = new Date();
        const document = { id: id('doc'), currentVersionId: null, version: 1, archivedAt: null, archivedByUserId: null, createdAt: now, updatedAt: now, ...data };
        state.documents.push(document);
        return structuredClone(document);
      },
      findFirst: async ({ where }) => {
        let document = state.documents.find(item => item.id === where.id && item.projectId === where.projectId);
        if (!document && where.versions?.some) {
          const externalId = where.versions.some.externalId;
          const version = state.versions.find(item => item.externalId === externalId && item.source === where.versions.some.source);
          document = state.documents.find(item => item.id === version?.documentId && item.projectId === where.projectId && item.type === where.type);
        }
        return document ? hydrateDocument(document) : null;
      },
      findMany: async ({ where }) => state.documents
        .filter(item => item.projectId === where.projectId && (where.archivedAt === null ? !item.archivedAt : true))
        .map(item => hydrateDocument(item)),
      update: async ({ where, data }) => {
        const document = state.documents.find(item => item.id === where.id);
        if (!document) throw new Error('document missing');
        applyData(document, data);
        return structuredClone(document);
      }
    },
    projectDocumentVersion: {
      create: async ({ data }) => {
        const version = {
          id: id('ver'), versionLabel: null, originalFileName: null, mimeType: null, fileSizeBytes: null,
          storagePath: null, sha256: null, externalId: null, externalUrl: null, sourceVersion: null,
          sourceUpdatedAt: null, lastSyncedAt: null, signatureDocumentId: null, acceptanceOccurredOn: null,
          acceptanceReference: null, acceptanceNote: null, acceptanceRecordedAt: null,
          acceptanceRecordedByUserId: null, createdByUserId: null, createdAt: new Date(), ...data
        };
        state.versions.push(version);
        return structuredClone(version);
      },
      update: async ({ where, data }) => {
        const version = state.versions.find(item => item.id === where.id);
        if (!version) throw new Error('version missing');
        applyData(version, data);
        return structuredClone(version);
      },
      findFirst: async ({ where }) => {
        const version = state.versions.find(item => item.id === where.id && item.documentId === where.documentId);
        const document = state.documents.find(item => item.id === version?.documentId);
        return version && document?.projectId === where.document?.projectId ? { ...hydrateVersion(version), document: { id: document.id, projectId: document.projectId } } : null;
      }
    },
    projectWorkflow: {
      update: async ({ data }) => {
        applyData(state.project.workflow, data);
        return { version: state.project.workflow.version };
      }
    },
    projectWorkflowEvent: {
      create: async ({ data }) => {
        const event = { id: id('evt'), createdAt: new Date(), ...data };
        state.events.push(event);
        return structuredClone(event);
      }
    },
    report: {
      findMany: async () => structuredClone(state.reports)
    }
  };
  return { database, state, hydrateDocument };
}

export function testPdfDataUrl(text = 'documento') {
  return `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n${text}\n%%EOF`).toString('base64')}`;
}
