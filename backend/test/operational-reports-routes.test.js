import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  approveMaintenanceRecords,
  assertCanEditOperationalRecord,
  loadEquipmentForMaintenance,
} from "../src/routes/resources/operational-reports.js";
import operationalReportsRouter from "../src/routes/resources/operational-reports.js";
import { operationalReportEvent } from "../src/lib/operational-reports/events.js";
import { createMaintenancePhoto } from "../src/lib/operational-reports/maintenance-attachments.js";
import prisma from "../src/lib/prisma.js";

const validMaintenanceReport = {
  kind: "MAINTENANCE",
  reportDate: "2026-09-04",
  arrivalTime: "07:00",
  departureTime: "17:00",
  lunchBreak: "01:00:00",
  collaboratorIds: ["collaborator-1"],
  nightShift: { enabled: false, collaboratorIds: [] },
  overtimeReason: "",
  dailyDescription: "Atividades do dia",
  maintenanceRecords: [
    {
      equipmentId: "equipment-1",
      selectedServiceIds: ["service-1"],
      observations: "",
      thirdPartyServices: [],
      photos: [],
      removePhotoIds: [],
    },
  ],
  chemicalCleanings: [],
};

function routeHandler(path, method) {
  const layer = operationalReportsRouter.stack.find(
    (item) => item.route?.path === path && item.route.methods?.[method],
  );
  assert.ok(layer, `Rota ${method.toUpperCase()} ${path} não encontrada.`);
  return layer.route.stack.at(-1).handle;
}

function invokeForError(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      status() {
        return this;
      },
      json(value) {
        reject(new Error(`Resposta inesperada: ${JSON.stringify(value)}`));
      },
    };
    handler(req, res, resolve);
  });
}

function invokeForJson(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(value) {
        resolve({ statusCode: this.statusCode, value });
      },
    };
    handler(req, res, reject);
  });
}

test("rotas operacionais expõem criação, edição, revisão e download documental", () => {
  for (const [method, path] of [
    ["post", "/"],
    ["put", "/:id"],
    ["patch", "/:id/status"],
    ["post", "/maintenance"],
    ["get", "/maintenance/history"],
    ["get", "/maintenance/schedule"],
    ["put", "/maintenance/:id"],
    ["patch", "/maintenance/:id/status"],
    ["get", "/maintenance/:id/document"],
  ]) {
    routeHandler(path, method);
  }
});

test("programação de manutenção exige permissão e usa somente a última manutenção aprovada", async () => {
  const handler = routeHandler("/maintenance/schedule", "get");
  const denied = await invokeForError(handler, {
    query: {},
    auth: {
      user: {
        id: "production-user",
        accountType: "INTERNAL",
        reportEmissionPermissions: ["PRODUCTION"],
      },
    },
  });
  assert.equal(denied.statusCode, 403);

  const originalEquipmentFindMany = prisma.companyEquipment.findMany;
  const originalCategoryFindMany = prisma.equipmentCategory.findMany;
  let equipmentArgs = null;
  let categoryArgs = null;
  prisma.companyEquipment.findMany = async (args) => {
    equipmentArgs = args;
    return [
      {
        id: "equipment-1",
        code: "UFI 001",
        name: "Unidade",
        category: {
          id: "category-1",
          name: "UFI",
          maintenanceIntervalDays: 30,
        },
        maintenanceRecords: [
          {
            id: "maintenance-1",
            maintenanceDate: new Date("2026-09-01T00:00:00.000Z"),
          },
        ],
      },
    ];
  };
  prisma.equipmentCategory.findMany = async (args) => {
    categoryArgs = args;
    return [
      { id: "category-1", name: "UFI", maintenanceIntervalDays: 30 },
    ];
  };
  try {
    const response = await invokeForJson(handler, {
      query: { q: "ufi", categoryId: "category-1", pageSize: "10" },
      auth: {
        user: {
          id: "maintenance-user",
          accountType: "INTERNAL",
          reportEmissionPermissions: ["MAINTENANCE"],
        },
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.value.items.length, 1);
    assert.equal(response.value.items[0].lastMaintenanceId, "maintenance-1");
    assert.equal(response.value.categories[0].maintenanceIntervalDays, 30);
    assert.equal(equipmentArgs.where.isActive, true);
    assert.equal(equipmentArgs.where.categoryId, "category-1");
    assert.deepEqual(equipmentArgs.where.category, {
      is: { isActive: true, showInMaintenance: true },
    });
    assert.deepEqual(categoryArgs.where, {
      isActive: true,
      showInMaintenance: true,
    });
    assert.deepEqual(equipmentArgs.select.maintenanceRecords.where, {
      status: "APPROVED",
    });
    assert.equal(equipmentArgs.select.maintenanceRecords.take, 1);
  } finally {
    prisma.companyEquipment.findMany = originalEquipmentFindMany;
    prisma.equipmentCategory.findMany = originalCategoryFindMany;
  }
});

test("equipamento de categoria oculta não aceita uma nova manutenção", async () => {
  const database = {
    companyEquipment: {
      findFirst: async () => ({
        id: "equipment-hidden",
        isActive: true,
        category: {
          showInMaintenance: false,
          maintenanceProfile: {
            id: "profile-1",
            name: "Perfil",
            isActive: true,
            items: [],
          },
        },
        maintenanceProfileOverride: false,
        maintenanceProfile: null,
      }),
    },
  };

  await assert.rejects(
    loadEquipmentForMaintenance(database, "equipment-hidden"),
    /não está disponível no módulo de manutenção/,
  );
});

test("histórico consolidado exige permissão de manutenção e consulta todas as origens aprovadas", async () => {
  const handler = routeHandler("/maintenance/history", "get");
  const denied = await invokeForError(handler, {
    query: {},
    auth: {
      user: {
        id: "production-user",
        accountType: "INTERNAL",
        reportEmissionPermissions: ["PRODUCTION"],
      },
    },
  });
  assert.equal(denied.statusCode, 403);

  const originalFindMany = prisma.maintenanceRecord.findMany;
  const originalCount = prisma.maintenanceRecord.count;
  const originalTransaction = prisma.$transaction;
  const calls = [];
  prisma.maintenanceRecord.findMany = async (args) => {
    calls.push(args);
    return [
      {
        id: "maintenance-linked",
        reportId: "report-5002",
        maintenanceDate: new Date("2026-09-04T00:00:00.000Z"),
        status: "APPROVED",
        responsibleNameSnapshot: "Responsável",
        profileNameSnapshot: "UFI",
        selectedServices: [{ label: "Pintura", order: 1 }],
        equipment: { id: "eq-1", code: "UFI 001", name: "Unidade", category: { id: "cat-1", name: "UFI" } },
        thirdPartyServices: [],
        attachments: [{ id: "doc-1", kind: "DOCUMENT", fileName: "manutencao.pdf", mimeType: "application/pdf", createdAt: new Date() }],
        reviewAudits: [],
      },
    ];
  };
  prisma.maintenanceRecord.count = async (args) => {
    calls.push(args);
    return 1;
  };
  prisma.$transaction = async (operations) => Promise.all(operations);
  try {
    const response = await invokeForJson(handler, {
      query: {
        q: "ufi",
        page: "2",
        pageSize: "10",
        sortBy: "tag",
        sortDirection: "asc",
      },
      auth: {
        user: {
          id: "maintenance-user",
          accountType: "INTERNAL",
          reportEmissionPermissions: ["MAINTENANCE"],
        },
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.value.items.length, 1);
    assert.equal(response.value.items[0].document.fileName, "manutencao.pdf");
    assert.deepEqual(response.value.pagination, {
      page: 2,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    assert.equal(calls[0].where.status, "APPROVED");
    assert.equal("reportId" in calls[0].where, false);
    assert.equal(calls[0].skip, 10);
    assert.deepEqual(calls[0].orderBy[0], {
      equipment: { code: "asc" },
    });
    assert.match(JSON.stringify(calls[0].where), /UFI|ufi/);
  } finally {
    prisma.maintenanceRecord.findMany = originalFindMany;
    prisma.maintenanceRecord.count = originalCount;
    prisma.$transaction = originalTransaction;
  }
});

test("criação rejeita conta interna sem a permissão específica antes de acessar dados", async () => {
  const error = await invokeForError(routeHandler("/", "post"), {
    body: validMaintenanceReport,
    auth: {
      user: {
        id: "user-1",
        role: "COLLABORATOR",
        accountType: "INTERNAL",
        moduleRoles: ["rdo:collaborator"],
        reportEmissionPermissions: ["SITE_RDO"],
      },
    },
  });
  assert.equal(error.statusCode, 403);
  assert.match(error.message, /permissão para emitir/);
});

test("edição exige simultaneamente permissão de emissão e autoria, exceto autoria para ADMIN", () => {
  const creator = {
    id: "creator",
    accountType: "INTERNAL",
    reportEmissionPermissions: ["MAINTENANCE"],
  };
  assert.doesNotThrow(() =>
    assertCanEditOperationalRecord(creator, "MAINTENANCE", "creator"),
  );
  assert.throws(
    () => assertCanEditOperationalRecord(creator, "MAINTENANCE", "other"),
    /responsável/,
  );
  assert.throws(
    () =>
      assertCanEditOperationalRecord(
        { ...creator, id: "reviewer", reportEmissionPermissions: [] },
        "MAINTENANCE",
        "creator",
      ),
    /permissão para emitir/,
  );
  assert.doesNotThrow(() =>
    assertCanEditOperationalRecord(
      {
        id: "admin",
        accountType: "ADMIN",
        reportEmissionPermissions: ["PRODUCTION"],
      },
      "PRODUCTION",
      "creator",
    ),
  );
});

test("rota de alteração não concede escrita ao aprovador sem permissão de emissão", async () => {
  const originalFindUnique = prisma.report.findUnique;
  const originalFindConfiguration = prisma.maintenanceConfiguration.findUnique;
  prisma.report.findUnique = async () => ({
    id: "report-1",
    reportType: "RDO_MAINTENANCE",
    createdByUserId: "creator",
    status: "PENDING",
    maintenanceRecords: [],
  });
  prisma.maintenanceConfiguration.findUnique = async () => null;
  try {
    const error = await invokeForError(routeHandler("/:id", "put"), {
      params: { id: "report-1" },
      body: validMaintenanceReport,
      auth: {
        user: {
          id: "supervisor",
          accountType: "INTERNAL",
          moduleRoles: ["rdo:manager"],
          reportEmissionPermissions: [],
        },
      },
    });
    assert.equal(error.statusCode, 403);
    assert.match(error.message, /permissão para emitir/);

    const reviewError = await invokeForError(
      routeHandler("/:id/status", "patch"),
      {
        params: { id: "report-1" },
        body: { status: "APPROVED" },
        auth: {
          user: {
            id: "supervisor",
            accountType: "INTERNAL",
            moduleRoles: ["rdo:manager"],
            reportEmissionPermissions: [],
          },
        },
      },
    );
    assert.equal(reviewError.statusCode, 403);
    assert.match(reviewError.message, /permissão para emitir/);
  } finally {
    prisma.report.findUnique = originalFindUnique;
    prisma.maintenanceConfiguration.findUnique = originalFindConfiguration;
  }
});

test("contexto do módulo rejeita acesso sem permissão de área", async () => {
  const error = await invokeForError(routeHandler("/context", "get"), {
    auth: {
      user: {
        id: "site-user",
        accountType: "INTERNAL",
        reportEmissionPermissions: ["SITE_RDO"],
      },
    },
  });
  assert.equal(error.statusCode, 403);
  assert.match(error.message, /Sem permissão/);
});

test("contexto do módulo consulta somente categorias habilitadas para manutenção", async () => {
  const originalFindConfiguration = prisma.maintenanceConfiguration.findUnique;
  const originalProjectFindMany = prisma.project.findMany;
  const originalCollaboratorFindMany = prisma.collaborator.findMany;
  const originalEquipmentFindMany = prisma.companyEquipment.findMany;
  let equipmentArgs = null;
  prisma.maintenanceConfiguration.findUnique = async () => null;
  prisma.project.findMany = async () => [];
  prisma.collaborator.findMany = async () => [];
  prisma.companyEquipment.findMany = async (args) => {
    equipmentArgs = args;
    return [];
  };
  try {
    const response = await invokeForJson(routeHandler("/context", "get"), {
      auth: {
        user: {
          id: "maintenance-user",
          accountType: "INTERNAL",
          reportEmissionPermissions: ["MAINTENANCE"],
        },
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(equipmentArgs.where, {
      isActive: true,
      category: {
        is: { isActive: true, showInMaintenance: true },
      },
    });
  } finally {
    prisma.maintenanceConfiguration.findUnique = originalFindConfiguration;
    prisma.project.findMany = originalProjectFindMany;
    prisma.collaborator.findMany = originalCollaboratorFindMany;
    prisma.companyEquipment.findMany = originalEquipmentFindMany;
  }
});

test("upload de manutenção rejeita conteúdo que não seja uma imagem válida", async () => {
  await assert.rejects(
    createMaintenancePhoto(
      { maintenanceAttachment: { create: async () => null } },
      {
        maintenanceId: "maintenance-1",
        equipmentCode: "EQ-1",
        upload: {
          fileName: "arquivo.pdf",
          mimeType: "application/pdf",
          dataUrl: "data:application/pdf;base64,cGRm",
        },
      },
    ),
    /imagem válida/,
  );
});

test("rota aprova produção de forma atômica sem criar artefato documental", async () => {
  const originalFindReport = prisma.report.findUnique;
  const originalFindConfiguration = prisma.maintenanceConfiguration.findUnique;
  const originalTransaction = prisma.$transaction;
  const audits = [];
  const documents = [];
  const report = {
    id: "production-1",
    reportType: "RDO_PRODUCTION",
    createdByUserId: "creator",
    status: "PENDING",
    reportDate: new Date("2026-09-04T00:00:00.000Z"),
    project: { id: "project-5004", code: "5004", name: "Produção" },
    createdBy: { id: "creator", name: "Responsável" },
    collaborators: [],
    maintenanceRecords: [],
    chemicalCleanings: [
      {
        id: "cleaning-1",
        description: "Decapagem",
        material: "CARBON_STEEL",
        quantityKg: 12,
        order: 1,
      },
    ],
    operationalReviewAudits: [],
  };
  prisma.report.findUnique = async () => report;
  prisma.maintenanceConfiguration.findUnique = async () => null;
  prisma.$transaction = async (callback) =>
    callback({
      report: {
        async updateMany({ data }) {
          if (!["PENDING", "RETURNED"].includes(report.status))
            return { count: 0 };
          Object.assign(report, data);
          return { count: 1 };
        },
      },
      operationalReviewAudit: {
        async create({ data }) {
          audits.push(data);
        },
      },
      maintenanceAttachment: {
        async create(data) {
          documents.push(data);
        },
      },
    });
  try {
    const response = await invokeForJson(routeHandler("/:id/status", "patch"), {
      params: { id: report.id },
      body: { status: "APPROVED" },
      method: "PATCH",
      path: `/${report.id}/status`,
      auth: {
        user: {
          id: "rdo-manager",
          name: "Gestor",
          accountType: "INTERNAL",
          moduleRoles: ["rdo:manager"],
          reportEmissionPermissions: ["PRODUCTION"],
        },
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.value.status, "APPROVED");
    assert.equal(audits.length, 1);
    assert.equal(documents.length, 0);
  } finally {
    prisma.report.findUnique = originalFindReport;
    prisma.maintenanceConfiguration.findUnique = originalFindConfiguration;
    prisma.$transaction = originalTransaction;
  }
});

function approvalFixture() {
  const reportState = { status: "PENDING" };
  const maintenanceState = new Map([
    ["maintenance-1", "PENDING"],
    ["maintenance-2", "PENDING"],
  ]);
  const recordUpdates = [];
  const documents = [];
  const audits = [];
  const cleaned = [];
  const tx = {
    report: {
      async updateMany() {
        if (!["PENDING", "RETURNED"].includes(reportState.status))
          return { count: 0 };
        reportState.status = "APPROVED";
        return { count: 1 };
      },
    },
    maintenanceRecord: {
      async updateMany({ where, data }) {
        const current = maintenanceState.get(where.id);
        if (!["PENDING", "RETURNED"].includes(current)) return { count: 0 };
        maintenanceState.set(where.id, "APPROVED");
        recordUpdates.push({ id: where.id, data });
        return { count: 1 };
      },
    },
    operationalReviewAudit: {
      async create({ data }) {
        audits.push(data);
      },
    },
  };
  return {
    reportState,
    maintenanceState,
    recordUpdates,
    documents,
    audits,
    cleaned,
    dependencies: {
      database: { async $transaction(callback) { return callback(tx); } },
      async prepareDocuments(records) {
        return records.map((record) => ({
          record,
          bytes: Buffer.from("pdf"),
          fileName: `${record.id}.pdf`,
        }));
      },
      async createDocument(_tx, input) {
        documents.push(input);
        return { storagePath: `documents/${input.maintenanceId}.pdf` };
      },
      async cleanupPaths(paths) {
        cleaned.push(...paths);
      },
    },
  };
}

test("aprovação conjunta é atômica, gera um documento por manutenção e congela o supervisor", async () => {
  const fixture = approvalFixture();
  const records = ["maintenance-1", "maintenance-2"].map((id) => ({
    id,
    status: "PENDING",
    attachments: [],
    equipment: { code: id },
  }));
  const supervisor = {
    name: "Supervisor vigente",
    signatureImage: "data:image/png;base64,c2ln",
  };

  await approveMaintenanceRecords(
    {
      records,
      reportId: "report-1",
      supervisor,
      actor: { id: "admin", name: "Administrador" },
      reviewNotes: "Aprovado",
    },
    fixture.dependencies,
  );

  assert.equal(fixture.reportState.status, "APPROVED");
  assert.equal(fixture.documents.length, 2);
  assert.equal(fixture.audits.length, 1);
  assert.deepEqual(
    fixture.recordUpdates.map((item) => item.data.supervisorNameSnapshot),
    ["Supervisor vigente", "Supervisor vigente"],
  );
  assert.deepEqual(
    fixture.recordUpdates.map(
      (item) => item.data.supervisorSignatureSnapshot,
    ),
    [supervisor.signatureImage, supervisor.signatureImage],
  );

  await assert.rejects(
    approveMaintenanceRecords(
      {
        records,
        reportId: "report-1",
        supervisor,
        actor: { id: "other-admin", name: "Outro administrador" },
      },
      fixture.dependencies,
    ),
    /outra pessoa/,
  );
  assert.equal(fixture.documents.length, 2);
  assert.deepEqual(fixture.cleaned, []);
});

test("histórico consulta apenas manutenções aprovadas e produção não aciona documentos", async () => {
  const [equipmentRoute, operationalRoute] = await Promise.all([
    readFile(
      new URL("../src/routes/resources/equipamentos.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/routes/resources/operational-reports.js", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    equipmentRoute,
    /\/:id\/maintenance-history[\s\S]*?status:\s*['"]APPROVED['"]/,
  );
  assert.match(
    operationalRoute,
    /else \{[\s\S]*?canReviewProduction[\s\S]*?operationalReviewAudit\.create/,
  );
  assert.doesNotMatch(
    operationalRoute,
    /else \{[\s\S]*?canReviewProduction[\s\S]*?createMaintenanceDocument/,
  );
  assert.match(
    operationalRoute,
    /status:\s*\{ in: \["PENDING", "RETURNED"\] \}[\s\S]*?já foi revisado por outra pessoa/,
  );
});

test("eventos diagnósticos descartam conteúdo e nomes de arquivo", () => {
  const event = operationalReportEvent("photos_processed", {
    actorUserId: "user-1",
    maintenanceId: "maintenance-1",
    photoCount: 2,
    reviewNotes: "conteúdo sensível",
    fileName: "segredo.pdf",
    dataUrl: "data:image/png;base64,segredo",
  });
  assert.equal(event.actorUserId, "user-1");
  assert.equal(event.photoCount, 2);
  assert.equal("reviewNotes" in event, false);
  assert.equal("fileName" in event, false);
  assert.equal("dataUrl" in event, false);
});
