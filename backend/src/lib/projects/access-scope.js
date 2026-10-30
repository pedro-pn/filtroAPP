import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { projectChannelWhere } from './distribution.js';

const scope = new AsyncLocalStorage();
const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, {
  ...model, fields: model.fields.map(field => ({ ...field }))
}]));
// Prisma 7's runtime DMMF omits list/nullable flags. Load cardinality once from
// the canonical schema shipped alongside the migrations.
const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
for (const [, name, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  for (const [, fieldName, , cardinality] of body.matchAll(/^\s*(\w+)\s+(\w+)(\[\]|\?)?/gm)) {
    const field = models.get(name)?.fields.find(field => field.name === fieldName);
    if (field) { field.isList = cardinality === '[]'; field.isRequired = cardinality !== '?'; }
  }
}
// Project-owned children without a direct Project relation.
const parents = {
  ReportService: ['report'], ReportCollaborator: ['report'], ReportAttachment: ['report', 'reportService'],
  ReportVersion: ['report'], ReportSignature: ['report', 'version'], ReportAuditLog: ['report', 'version'],
  MaintenanceRecord: ['report'], ChemicalCleaning: ['report'],
  QualityEvidence: ['record'], ProjectDocumentVersion: ['document'],
  QualityRecordAuditLog: ['record'], ReportClientAccess: ['report'], ClientReportReview: ['report'],
  ReportPdfAttachment: ['report'], ReportMeasurementLink: ['report'], ReportApprovalPostProcessingJob: ['report'],
  MaintenanceThirdPartyService: ['maintenance'], MaintenanceAttachment: ['maintenance'],
  OperationalReviewAudit: ['report', 'maintenance'],
  EfetivoMissionAllocation: ['mission'], EfetivoMissionDemand: ['mission'],
  EfetivoMissionCycle: ['mission'], EfetivoAllocationCycle: ['allocation'],
  ProjectWorkflowCommercialFact: ['workflow'], ProjectWorkflowPostJob: ['workflow'],
  SignatureDocument: ['projectDocumentVersion'],
  NotificationEvent: ['report'],
  NotificationRead: ['notification'],
  CrmOpportunityEvent: ['opportunity'], CrmPlanningReceipt: ['opportunity'], CrmOpportunityLinkEvent: ['opportunity'],
  ProjectWorkflowDocumentationRequirement: ['category'], ProjectExecutionWeeklyReview: ['workflow'],
  ProjectDatabookRevision: ['databook'], ProjectPlannedServiceSystem: ['service', 'projectSystem'],
  SignatureDocumentSigner: ['document'], SignatureDocumentField: ['document'],
  SignatureDocumentAuditLog: ['document'], SignatureDocumentCompletionNotification: ['document'],
  RomaneioItem: ['romaneio'], RomaneioChecklist: ['romaneio'], RomaneioAttachment: ['romaneio']
};
for (const model of models.values()) {
  if (model.name.startsWith('ProjectWorkflow') && model.name !== 'ProjectWorkflow') {
    const workflow = model.fields.filter(field => field.type === 'ProjectWorkflow' && !field.isList).map(field => field.name);
    if (workflow.length) parents[model.name] = workflow;
  }
}
const operations = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

export function withProjectAccess(user, callback) {
  return scope.run({ ...scope.getStore(), restricted: user.accountType !== 'ADMIN' }, callback);
}

export function withProjectChannel(channel, callback) {
  return scope.run({ ...scope.getStore(), channel }, callback);
}

export function projectAccessCacheKey() {
  return `${scope.getStore()?.restricted ? 'non-admin' : 'admin'}:${scope.getStore()?.channel || 'app'}`;
}

export function projectAccessWhere(modelName) {
  if (modelName === 'Project') {
    const channel = scope.getStore()?.channel;
    return { ...(channel ? projectChannelWhere(channel) : {}),
      ...(!channel || scope.getStore()?.restricted ? { managerOnly: false } : {}) };
  }
  const model = models.get(modelName);
  if (!model) return null;
  const relations = model.fields.filter(field => field.kind === 'object' && !field.isList
    && (field.type === 'Project' || parents[modelName]?.includes(field.name)));
  const conditions = relations.flatMap(field => {
    const where = projectAccessWhere(field.type);
    if (!where) return [];
    const visible = { [field.name]: { is: where } };
    return [field.isRequired ? visible : { OR: [{ [field.name]: { is: null } }, visible] }];
  });
  return conditions.length ? { AND: conditions } : null;
}

function protectNested(modelName, selection) {
  if (!selection || typeof selection !== 'object') return selection;
  return Object.fromEntries(Object.entries(selection).map(([name, value]) => {
    if (name === '_count' && value) {
      const fields = models.get(modelName)?.fields.filter(field => field.kind === 'object' && field.isList) || [];
      const selected = value === true ? Object.fromEntries(fields.map(field => [field.name, true])) : value.select;
      return [name, { select: Object.fromEntries(Object.entries(selected || {}).map(([key, count]) => {
        const field = fields.find(field => field.name === key);
        const where = field && projectAccessWhere(field.type);
        return [key, where && count ? { where: { AND: [count.where || {}, where] } } : count];
      })) }];
    }
    const field = models.get(modelName)?.fields.find(field => field.name === name && field.kind === 'object');
    if (!field || !value) return [name, value];
    const where = field.isList ? projectAccessWhere(field.type) : null;
    const args = value === true ? {} : value;
    const next = protectProjectQuery(field.type, args, where);
    return [name, value === true && !Object.keys(next).length ? true : next];
  }));
}

export function protectProjectQuery(modelName, args, where = projectAccessWhere(modelName)) {
  return {
    ...args,
    ...(where ? { where: { ...args.where, AND: [
      ...(Array.isArray(args.where?.AND) ? args.where.AND : args.where?.AND ? [args.where.AND] : []), where
    ] } } : {}),
    ...(args.include ? { include: protectNested(modelName, args.include) } : {}),
    ...(args.select ? { select: protectNested(modelName, args.select) } : {})
  };
}

export const projectAccessExtension = {
  name: 'project-admin-visibility',
  query: { $allModels: { $allOperations({ model, operation, args, query }) {
    const context = scope.getStore();
    return query((context?.restricted || context?.channel) && operations.has(operation) ? protectProjectQuery(model, args) : args);
  } } }
};
