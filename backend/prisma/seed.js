import prismaPkg from '@prisma/client';

import { hashPassword } from '../src/lib/password.js';
import { normalizeCnpj } from '../src/lib/cnpj.js';
import { accountTypeForLegacyRole, defaultPublicModuleRolesForLegacyRole, moduleRoleRows } from '../src/lib/module-roles.js';

const { PrismaClient, ReportType, UnitCategory, UserRole } = prismaPkg;

const prisma = new PrismaClient();

async function main() {
  const collaborators = [
    { code: 'COL-001', name: 'Colaborador 1', role: 'Tecnico senior', email: 'colaborador1@example.com', signatureImage: 'assinatura-col1.png', isActive: true },
    { code: 'COL-002', name: 'Colaborador 2', role: 'Tecnico', email: 'colaborador2@example.com', signatureImage: 'assinatura-col2.png', isActive: true },
    { code: 'COL-003', name: 'Colaborador 3', role: 'Tecnica', email: 'colaborador3@example.com', signatureImage: 'assinatura-col3.png', isActive: true },
    { code: 'COL-004', name: 'Colaborador 4', role: 'Auxiliar', email: null, signatureImage: 'assinatura-col4.png', isActive: false }
  ];

  for (const collaborator of collaborators) {
    await prisma.collaborator.upsert({
      where: { code: collaborator.code },
      update: collaborator,
      create: collaborator
    });
  }

  const byCode = async code => prisma.collaborator.findUniqueOrThrow({ where: { code } });
  const col1 = await byCode('COL-001');
  const col2 = await byCode('COL-002');

  const equipments = [
    { code: 'EQ-001', name: 'Trocador T-101', serviceTags: ['limpeza', 'mecanica'] },
    { code: 'EQ-002', name: 'Vaso V-202', serviceTags: ['pressao'] },
    { code: 'EQ-003', name: 'Reservatorio R-01', serviceTags: ['filtragem'] },
    { code: 'EQ-004', name: 'Bomba B-05', serviceTags: ['flushing'] }
  ];

  for (const equipment of equipments) {
    await prisma.equipment.upsert({
      where: { code: equipment.code },
      update: equipment,
      create: equipment
    });
  }

  const units = [
    { code: 'UFG-01', category: UnitCategory.FILTRAGEM },
    { code: 'UFG-02', category: UnitCategory.FILTRAGEM },
    { code: 'UF-01', category: UnitCategory.FLUSHING },
    { code: 'UF-02', category: UnitCategory.FLUSHING },
    { code: 'ULQ-01', category: UnitCategory.LIMPEZA_QUIMICA },
    { code: 'ULQ-02', category: UnitCategory.LIMPEZA_QUIMICA },
    { code: 'CF-01', category: UnitCategory.DESIDRATACAO },
    { code: 'TV-01', category: UnitCategory.DESIDRATACAO },
    { code: 'UTH-01', category: UnitCategory.UTH },
    { code: 'UTH-02', category: UnitCategory.UTH }
  ];

  for (const unit of units) {
    await prisma.unit.upsert({
      where: { code: unit.code },
      update: unit,
      create: unit
    });
  }

  const manometers = [
    { code: 'MAN-01', scale: '0-60 bar', calibrationCertCode: 'CAL-2026-001', calibratedAt: new Date('2026-02-01T00:00:00.000Z'), expiresAt: new Date('2027-02-01T00:00:00.000Z') },
    { code: 'MAN-02', scale: '0-100 bar', calibrationCertCode: 'CAL-2026-002', calibratedAt: new Date('2026-02-01T00:00:00.000Z'), expiresAt: new Date('2027-02-01T00:00:00.000Z') }
  ];

  for (const manometer of manometers) {
    await prisma.manometer.upsert({
      where: { code: manometer.code },
      update: manometer,
      create: manometer
    });
  }

  const counters = [
    { code: 'PC-01', serialNumber: 'SN-88451', calibratedAt: new Date('2026-01-10T00:00:00.000Z'), expiresAt: new Date('2027-01-10T00:00:00.000Z') },
    { code: 'PC-02', serialNumber: 'SN-77214', calibratedAt: new Date('2025-11-02T00:00:00.000Z'), expiresAt: new Date('2026-11-02T00:00:00.000Z') }
  ];

  for (const counter of counters) {
    await prisma.particleCounter.upsert({
      where: { code: counter.code },
      update: counter,
      create: counter
    });
  }

  const projects = [
    {
      code: 'projeto-demo-a',
      name: 'Projeto Demo - Refinaria',
      clientName: 'Empresa Demo A',
      clientCnpj: normalizeCnpj('12.345.678/0001-90'),
      clientEmailPrimary: 'clientea@example.com',
      clientEmailCc: ['obrasa@example.com'],
      contractCode: 'CT-2026-014',
      location: 'Localidade A',
      workdayHours: '09:00',
      weekendWorkdayHours: '08:00',
      includesSaturday: true,
      includesSunday: false,
      operatorId: col1.id,
      reportSequences: { RDO: 14, RTP: 3, RLQ: 8, RCPU: 2, RLM: 5, RLF: 7, RLI: 11 }
    },
    {
      code: 'projeto-demo-b',
      name: 'Projeto Demo - Plataforma',
      clientName: 'Empresa Demo B',
      clientCnpj: normalizeCnpj('22.456.789/0001-44'),
      clientEmailPrimary: 'clienteb@example.com',
      clientEmailCc: ['fiscalb@example.com'],
      contractCode: 'CT-2026-088',
      location: 'Localidade B',
      workdayHours: '09:00',
      weekendWorkdayHours: '08:00',
      includesSaturday: true,
      includesSunday: true,
      operatorId: col2.id,
      reportSequences: { RDO: 7, RTP: 12, RLQ: 2, RCPU: 1, RLM: 2, RLF: 4, RLI: 6 }
    }
  ];

  for (const project of projects) {
    const { reportSequences, ...projectData } = project;

    const saved = await prisma.project.upsert({
      where: { code: project.code },
      update: projectData,
      create: projectData
    });

    for (const reportType of Object.values(ReportType)) {
      await prisma.projectReportSeq.upsert({
        where: {
          projectId_reportType: {
            projectId: saved.id,
            reportType
          }
        },
        update: { nextNumber: reportSequences[reportType] || 0 },
        create: {
          projectId: saved.id,
          reportType,
          nextNumber: reportSequences[reportType] || 0
        }
      });
    }
  }

  const users = [
    {
      username: 'gestor',
      name: 'Gestor Demo',
      role: UserRole.MANAGER,
      collaboratorId: null,
      email: 'gestor@example.com',
      password: 'gestor123'
    },
    {
      username: 'colaborador1',
      name: 'Colaborador 1',
      role: UserRole.COLLABORATOR,
      collaboratorId: col1.id,
      email: 'colaborador1@example.com',
      password: 'colab123'
    },
    {
      username: 'colaborador2',
      name: 'Colaborador 2',
      role: UserRole.COLLABORATOR,
      collaboratorId: col2.id,
      email: 'colaborador2@example.com',
      password: 'colab123'
    },
    {
      username: normalizeCnpj('12.345.678/0001-90'),
      name: 'Empresa Demo A',
      role: 'CLIENT',
      collaboratorId: null,
      email: 'clientea@example.com',
      password: '123456'
    },
    {
      username: normalizeCnpj('22.456.789/0001-44'),
      name: 'Empresa Demo B',
      role: 'CLIENT',
      collaboratorId: null,
      email: 'clienteb@example.com',
      password: '123456'
    }
  ];

  for (const user of users) {
    const passwordHash = await hashPassword(user.password);
    const accountType = accountTypeForLegacyRole(user.role);
    const moduleRoles = defaultPublicModuleRolesForLegacyRole(user.role);
    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        name: user.name,
        role: user.role,
        accountType,
        collaboratorId: user.collaboratorId,
        email: user.email,
        passwordHash,
        isActive: true,
        moduleRoles: {
          deleteMany: {},
          create: moduleRoleRows('', moduleRoles).map(({ module, role }) => ({ module, role }))
        }
      },
      create: {
        username: user.username,
        name: user.name,
        role: user.role,
        accountType,
        collaboratorId: user.collaboratorId,
        email: user.email,
        passwordHash,
        isActive: true,
        moduleRoles: {
          create: moduleRoleRows('', moduleRoles).map(({ module, role }) => ({ module, role }))
        }
      }
    });
  }

  const segments = [
    { slug: 'siderurgica',     label: 'Siderúrgica',        order: 1 },
    { slug: 'celulose_papel',  label: 'Celulose e Papel',   order: 2 },
    { slug: 'geracao_energia', label: 'Geração de Energia', order: 3 },
    { slug: 'farmaceutico',    label: 'Farmacêutico',       order: 4 },
    { slug: 'metalurgico',     label: 'Metalúrgico',        order: 5 },
    { slug: 'petroquimica',    label: 'Petroquímica',       order: 6 },
    { slug: 'naval',           label: 'Naval',              order: 7 },
    { slug: 'cimento',         label: 'Cimento',            order: 8 },
    { slug: 'refinaria',       label: 'Refinaria',          order: 9 },
    { slug: 'automotivo',      label: 'Automotivo',         order: 10 },
    { slug: 'mineracao',       label: 'Mineração',          order: 11 },
    { slug: 'alimenticio',     label: 'Alimentício',        order: 12 }
  ];

  for (const seg of segments) {
    await prisma.clientSegment.upsert({
      where: { slug: seg.slug },
      update: { label: seg.label, order: seg.order },
      create: { ...seg, isActive: true }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async error => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
