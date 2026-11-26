// Seed determinístico dos testes ponta a ponta reais (spec 040).
//
// Só dados fictícios. Roda depois de `prisma migrate deploy` num banco
// descartável e recusa qualquer banco cujo nome não termine em `_e2e`, para
// nunca ser apontado por engano para produção ou homologação.
//
//   DATABASE_URL=postgresql://.../filtrovali_e2e node prisma/e2e-seed.js
//
// Grava os identificadores gerados em E2E_SEED_OUTPUT (JSON) para as jornadas
// do Playwright (frontend/e2e/real) usarem.
import fs from 'node:fs/promises';
import path from 'node:path';

import { ReportType, UserRole } from '@prisma/client';

import { normalizeCnpj } from '../src/lib/cnpj.js';
import { hashPassword } from '../src/lib/password.js';
import { accountTypeForLegacyRole, defaultPublicModuleRolesForLegacyRole, moduleRoleRows } from '../src/lib/module-roles.js';

export const E2E_ACCOUNTS = Object.freeze({
  admin: { username: 'e2e.admin', name: 'Admin E2E', role: UserRole.MANAGER, email: 'admin@e2e.test', password: 'E2e-Admin-2026!', extraModuleRoles: ['efetivo:manager'] },
  collaborator: { username: 'e2e.colab', name: 'Colaborador E2E', role: UserRole.COLLABORATOR, email: 'colab@e2e.test', password: 'E2e-Colab-2026!' }
});

export function assertDisposableDatabase(url = process.env.DATABASE_URL) {
  let name = '';
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    // URL inválida cai na recusa abaixo.
  }
  if (!name.endsWith('_e2e')) {
    throw new Error(`e2e-seed recusa o banco "${name || '(inválido)'}": use um banco descartável terminado em _e2e.`);
  }
  return name;
}

async function upsertUser(prisma, account, collaboratorId = null) {
  const passwordHash = await hashPassword(account.password);
  const accountType = accountTypeForLegacyRole(account.role);
  const moduleRoles = moduleRoleRows('', [...defaultPublicModuleRolesForLegacyRole(account.role), ...(account.extraModuleRoles || [])])
    .map(({ module, role }) => ({ module, role }));
  const data = {
    name: account.name,
    role: account.role,
    accountType,
    email: account.email,
    passwordHash,
    collaboratorId,
    reportEmissionPermissions: ['SITE_RDO'],
    isActive: true
  };
  return prisma.user.upsert({
    where: { username: account.username },
    update: { ...data, moduleRoles: { deleteMany: {}, create: moduleRoles } },
    create: { username: account.username, ...data, moduleRoles: { create: moduleRoles } }
  });
}

async function upsertProject(prisma, project) {
  const saved = await prisma.project.upsert({ where: { code: project.code }, update: project, create: project });
  for (const reportType of Object.values(ReportType)) {
    await prisma.projectReportSeq.upsert({
      where: { projectId_reportType: { projectId: saved.id, reportType } },
      update: {},
      create: { projectId: saved.id, reportType, nextNumber: 0 }
    });
  }
  return saved;
}

export async function seedE2e(prisma) {
  const jobRole = await prisma.jobRole.upsert({
    where: { normalizedKey: 'tecnico-e2e' },
    update: {},
    create: { name: 'Técnico E2E', normalizedKey: 'tecnico-e2e', isOperational: true, workforceClassification: 'OPERATIONAL' }
  });
  const collaborator = (code, name) => prisma.collaborator.upsert({
    where: { code },
    update: { name, jobRoleId: jobRole.id, isActive: true },
    create: { code, name, jobRoleId: jobRole.id, isActive: true }
  });
  const ana = await collaborator('E2E-001', 'Ana Teste E2E');
  const bruno = await collaborator('E2E-002', 'Bruno Teste E2E');

  const admin = await upsertUser(prisma, E2E_ACCOUNTS.admin);
  const colabUser = await upsertUser(prisma, E2E_ACCOUNTS.collaborator, ana.id);

  const base = {
    contractCode: 'CT-E2E',
    location: 'Oficina E2E',
    workdayHours: '09:00',
    weekendWorkdayHours: '08:00',
    includesSaturday: false,
    includesSunday: false
  };
  // Projeto A: a Ana (colaboradora do usuário e2e.colab) é a operadora.
  const projectA = await upsertProject(prisma, {
    ...base,
    code: 'E2E-A',
    name: 'Projeto E2E A',
    clientName: 'Cliente Fictício A',
    clientCnpj: normalizeCnpj('11.222.333/0001-81'),
    operatorId: ana.id
  });
  // Projeto B: sem a Ana — o colaborador não tem acesso aos relatórios dele.
  const projectB = await upsertProject(prisma, {
    ...base,
    code: 'E2E-B',
    name: 'Projeto E2E B',
    clientName: 'Cliente Fictício B',
    clientCnpj: normalizeCnpj('44.555.666/0001-72'),
    operatorId: bruno.id
  });

  const existingB = await prisma.report.findFirst({ where: { projectId: projectB.id, reportType: ReportType.RDO, sequenceNumber: 1 } });
  const reportB = existingB || await prisma.report.create({
    data: {
      projectId: projectB.id,
      reportType: ReportType.RDO,
      sequenceNumber: 1,
      reportDate: new Date('2026-11-03T12:00:00.000Z'),
      arrivalTime: '08:00',
      departureTime: '17:00',
      lunchBreak: '01:00:00',
      daytimeCount: 1,
      createdByUserId: admin.id
    }
  });
  await prisma.projectReportSeq.update({
    where: { projectId_reportType: { projectId: projectB.id, reportType: ReportType.RDO } },
    data: { nextNumber: 1 }
  });

  // Efetivo (jornada da missão): os dois projetos em Preparação, com o admin
  // como líder e o período planejado já definido (pula o passo das datas).
  // Rodar de novo apaga as missões que uma execução anterior criou.
  await prisma.efetivoMissionPlan.deleteMany({ where: { projectId: { in: [projectA.id, projectB.id] } } });
  const day = offset => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + offset);
    return date;
  };
  const efetivoPeriod = { mobilizationDate: day(7), executionStartDate: day(8), executionEndDate: day(20) };
  for (const project of [projectA, projectB]) {
    const workflow = {
      stage: 'PREPARATION',
      leaderUserId: admin.id,
      acceptedAt: new Date(),
      plannedMobilizationDate: efetivoPeriod.mobilizationDate,
      plannedExecutionStartDate: efetivoPeriod.executionStartDate,
      plannedExecutionEndDate: efetivoPeriod.executionEndDate
    };
    await prisma.projectWorkflow.upsert({ where: { projectId: project.id }, update: workflow, create: { projectId: project.id, ...workflow } });
  }

  return {
    accounts: E2E_ACCOUNTS,
    users: { adminId: admin.id, collaboratorUserId: colabUser.id },
    collaborators: { ana: { id: ana.id, name: ana.name }, bruno: { id: bruno.id, name: bruno.name } },
    projects: {
      a: { id: projectA.id, code: projectA.code, name: projectA.name },
      b: { id: projectB.id, code: projectB.code, name: projectB.name }
    },
    reports: { projectBReportId: reportB.id },
    efetivo: Object.fromEntries(Object.entries(efetivoPeriod).map(([key, value]) => [key, value.toISOString().slice(0, 10)]))
  };
}

async function main() {
  assertDisposableDatabase();
  const { default: prisma } = await import('../src/lib/prisma.js');
  try {
    const result = await seedE2e(prisma);
    const output = process.env.E2E_SEED_OUTPUT;
    if (output) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(`[e2e-seed] ok: projetos ${result.projects.a.code} e ${result.projects.b.code}, contas ${Object.values(E2E_ACCOUNTS).map(a => a.username).join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
