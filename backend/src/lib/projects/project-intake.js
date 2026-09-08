import { z } from 'zod';

import {
  contractToProposalCode,
  setProjectBudgetRevisionWithClient
} from '../acompanhamento/access-import.js';
import prisma from '../prisma.js';
import { statisticsProjectsCache } from '../resource-list-cache.js';

const MISSING_REVISION_SENTINEL = -1;
const INITIAL_COMMERCIAL_REVISION = 0;

const requiredText = (label, max) => z.string()
  .trim()
  .min(1, `${label} é obrigatório.`)
  .max(max, `${label} deve ter no máximo ${max} caracteres.`);

const cnpjSchema = z.string()
  .trim()
  .min(1, 'CNPJ é obrigatório.')
  .max(64, 'CNPJ deve ter no máximo 64 caracteres.')
  .transform(value => value.replace(/\D/g, ''))
  .refine(value => value.length === 14, 'CNPJ deve conter exatamente 14 dígitos.');

const rawProjectIntakeSchema = z.object({
  code: requiredText('Número do projeto', 80),
  name: requiredText('Nome do projeto', 240),
  clientName: requiredText('Cliente', 240),
  clientCnpj: cnpjSchema,
  proposalCode: requiredText('Proposta', 160),
  revision: z.number({ invalid_type_error: 'Revisão deve ser um número inteiro.' })
    .int('Revisão deve ser um número inteiro.')
    .min(MISSING_REVISION_SENTINEL, 'Revisão deve ser -1 ou maior.')
    .max(2_147_483_647, 'Revisão excede o limite permitido.'),
  location: requiredText('Local', 240)
}).strict('O payload contém campos não reconhecidos.');

export const projectIntakeSchema = rawProjectIntakeSchema
  .superRefine((data, ctx) => {
    const proposalCode = contractToProposalCode(data.proposalCode);
    if (!Number.isSafeInteger(proposalCode) || proposalCode <= 0 || proposalCode > 2_147_483_647) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposalCode'],
        message: 'Proposta deve conter um número válido.'
      });
    }
  })
  .transform(data => {
    const proposalCode = contractToProposalCode(data.proposalCode);
    const normalized = { ...data };
    delete normalized.proposalCode;
    return {
      ...normalized,
      revision: data.revision === MISSING_REVISION_SENTINEL
        ? INITIAL_COMMERCIAL_REVISION
        : data.revision,
      contractCode: data.revision === MISSING_REVISION_SENTINEL
        ? String(proposalCode)
        : `${proposalCode} Rev. ${data.revision}`
    };
  });

export const projectIntakePublicSelect = {
  id: true,
  code: true,
  name: true,
  clientName: true,
  clientCnpj: true,
  contractCode: true,
  location: true,
  registrationPending: true
};

const PROJECT_INTAKE_COMPARISON_FIELDS = [
  'code',
  'name',
  'clientName',
  'clientCnpj',
  'contractCode',
  'location'
];

export class ProjectIntakeConflictError extends Error {
  constructor() {
    super('O número do projeto já está em uso com dados diferentes.');
    this.name = 'ProjectIntakeConflictError';
    this.code = 'PROJECT_CODE_CONFLICT';
    this.statusCode = 409;
  }
}

export function projectIntakeCreateData(data) {
  const projectData = { ...data };
  delete projectData.revision;
  return {
    ...projectData,
    isActive: true,
    visibleToCollaborators: false,
    managerOnly: false,
    registrationPending: true,
    inhibitionServiceEnabled: false,
    requireServiceReportSignatures: false,
    clientEmailPrimary: '',
    clientSignerFirstName: '',
    clientSignerLastName: '',
    clientEmailCc: [],
    clientSigners: []
  };
}

function normalizedComparableProject(project) {
  return {
    code: String(project?.code || '').trim(),
    name: String(project?.name || '').trim(),
    clientName: String(project?.clientName || '').trim(),
    clientCnpj: String(project?.clientCnpj || '').replace(/\D/g, ''),
    contractCode: String(project?.contractCode || '').trim(),
    location: String(project?.location || '').trim()
  };
}

export function projectMatchesIntake(project, intake) {
  const comparableProject = normalizedComparableProject(project);
  return PROJECT_INTAKE_COMPARISON_FIELDS.every(field => comparableProject[field] === intake[field]);
}

async function resolveExistingProject(project, intake, client) {
  if (!projectMatchesIntake(project, intake)) {
    throw new ProjectIntakeConflictError();
  }
  statisticsProjectsCache.clear();
  const commercialRevision = await selectProjectIntakeCommercialRevision(project, intake, client);
  return projectIntakeResult('already_exists', project, commercialRevision);
}

function projectIntakeResult(status, project, commercialRevision) {
  const publicProject = { ...project, proposalCode: project.contractCode };
  delete publicProject.contractCode;
  return { status, project: publicProject, commercialRevision };
}

function isUniqueConstraintError(error) {
  return error?.code === 'P2002';
}

export async function receiveProjectIntake(rawInput, client = prisma) {
  const intake = projectIntakeSchema.parse(rawInput || {});
  const existing = await client.project.findUnique({
    where: { code: intake.code },
    select: projectIntakePublicSelect
  });

  if (existing) return resolveExistingProject(existing, intake, client);

  try {
    const project = await client.project.create({
      data: projectIntakeCreateData(intake),
      select: projectIntakePublicSelect
    });
    statisticsProjectsCache.clear();
    const commercialRevision = await selectProjectIntakeCommercialRevision(project, intake, client);
    return projectIntakeResult('created', project, commercialRevision);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrentProject = await client.project.findUnique({
      where: { code: intake.code },
      select: projectIntakePublicSelect
    });
    if (!concurrentProject) throw error;
    return resolveExistingProject(concurrentProject, intake, client);
  }
}

export async function selectProjectIntakeCommercialRevision(project, intake, client = prisma) {
  const proposalCode = contractToProposalCode(intake.contractCode);
  const [currentBudget, matchingProposal] = await Promise.all([
    client.projectBudget.findUnique({
      where: { projectId_version: { projectId: project.id, version: 1 } },
      select: { sourceProposalCodBd: true }
    }),
    client.commercialProposal.findFirst({
      where: { codProp: proposalCode, nRev: intake.revision, parentCodProp: null },
      orderBy: [
        { modifiedInAccessAt: { sort: 'desc', nulls: 'last' } },
        { codBd: 'desc' }
      ],
      select: { codBd: true }
    })
  ]);
  const selectedCodBd = currentBudget?.sourceProposalCodBd ?? null;
  const resultBase = {
    proposalCode: String(proposalCode),
    revision: intake.revision
  };

  if (selectedCodBd !== null) {
    return {
      status: selectedCodBd === matchingProposal?.codBd
        ? 'already_selected'
        : 'existing_selection_preserved',
      ...resultBase,
      selectedCodBd
    };
  }
  if (!matchingProposal) {
    return { status: 'not_found', ...resultBase, selectedCodBd: null };
  }

  await setProjectBudgetRevisionWithClient(client, project.id, matchingProposal.codBd);
  return {
    status: 'selected',
    ...resultBase,
    selectedCodBd: matchingProposal.codBd
  };
}
