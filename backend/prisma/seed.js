import prismaPkg from '@prisma/client';

import { hashPassword } from '../src/lib/password.js';

const { PrismaClient, ReportType, UnitCategory, UserRole } = prismaPkg;

const prisma = new PrismaClient();

async function main() {
  const collaborators = [
    { code: 'COL-001', name: 'Carlos Mendes', role: 'Tecnico senior', email: 'carlos@filtrovali.com', signatureImage: 'assinatura-carlos.png', isActive: true },
    { code: 'COL-002', name: 'Joao Pereira', role: 'Tecnico', email: 'joao@filtrovali.com', signatureImage: 'assinatura-joao.png', isActive: true },
    { code: 'COL-003', name: 'Ana Souza', role: 'Tecnica', email: 'ana@filtrovali.com', signatureImage: 'assinatura-ana.png', isActive: true },
    { code: 'COL-004', name: 'Pedro Lima', role: 'Auxiliar', email: null, signatureImage: 'assinatura-pedro.png', isActive: false }
  ];

  for (const collaborator of collaborators) {
    await prisma.collaborator.upsert({
      where: { code: collaborator.code },
      update: collaborator,
      create: collaborator
    });
  }

  const byCode = async code => prisma.collaborator.findUniqueOrThrow({ where: { code } });
  const carlos = await byCode('COL-001');
  const joao = await byCode('COL-002');

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
      code: 'refinaria',
      name: 'Refinaria XPTO - Fase 2',
      clientName: 'XPTO Energia',
      clientCnpj: '12.345.678/0001-90',
      contractCode: 'CT-2026-014',
      location: 'Macae/RJ',
      workdayHours: '09:00',
      weekendWorkdayHours: '08:00',
      includesSaturday: true,
      includesSunday: false,
      operatorId: carlos.id,
      reportSequences: { RDO: 14, RTP: 3, RLQ: 8, RCPU: 2, RLM: 5, RLF: 7, RLI: 11 }
    },
    {
      code: 'plataforma',
      name: 'Plataforma P-52',
      clientName: 'Offshore Brasil',
      clientCnpj: '22.456.789/0001-44',
      contractCode: 'P52-UTIL-88',
      location: 'Bacia de Campos',
      workdayHours: '09:00',
      weekendWorkdayHours: '08:00',
      includesSaturday: true,
      includesSunday: true,
      operatorId: joao.id,
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
      name: 'Admin Gestor',
      role: UserRole.MANAGER,
      collaboratorId: null,
      password: 'gestor123'
    },
    {
      username: 'carlos',
      name: 'Carlos Mendes',
      role: UserRole.COLLABORATOR,
      collaboratorId: carlos.id,
      password: 'colab123'
    },
    {
      username: 'joao',
      name: 'Joao Pereira',
      role: UserRole.COLLABORATOR,
      collaboratorId: joao.id,
      password: 'colab123'
    }
  ];

  for (const user of users) {
    const passwordHash = await hashPassword(user.password);
    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        name: user.name,
        role: user.role,
        collaboratorId: user.collaboratorId,
        passwordHash,
        isActive: true
      },
      create: {
        username: user.username,
        name: user.name,
        role: user.role,
        collaboratorId: user.collaboratorId,
        passwordHash,
        isActive: true
      }
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
