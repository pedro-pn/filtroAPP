import { randomUUID } from 'node:crypto';

// Synthetic data only. The benchmark owns every ID and can remove partial setup.
export async function seedLaborPerformanceFixture(database, { reportCount = 1200, servicesPerRdo = 4 } = {}) {
  const prefix = `labor-benchmark-${randomUUID()}`;
  const projectId = `${prefix}-project`, roleId = `${prefix}-role`, importId = `${prefix}-import`;
  const people = Array.from({ length: 21 }, (_, index) => ({ id: `${prefix}-person-${index}`, code: `${prefix}-${index}`, name: `Pessoa sintética ${index}`, jobRoleId: roleId }));
  const profileIds = [`${prefix}-role-profile`, `${prefix}-model`];
  const insert = async (model, rows) => {
    for (let offset = 0; offset < rows.length; offset += 500) await database[model].createMany({ data: rows.slice(offset, offset + 500) });
  };
  const day = value => new Date(Date.UTC(2026, 8, value));
  const cleanup = async () => {
    await database.pontoImport.deleteMany({ where: { id: importId } });
    await database.report.deleteMany({ where: { projectId } });
    await database.project.deleteMany({ where: { id: projectId } });
    await database.collaborator.deleteMany({ where: { id: { in: people.map(person => person.id) } } });
    await database.costProfile.deleteMany({ where: { id: { in: profileIds } } });
    await database.jobRole.deleteMany({ where: { id: roleId } });
  };
  try {
    await database.costProfile.create({ data: {
      id: profileIds[1], key: `${prefix}-model`, label: 'Modelo sintético',
      parameterSets: { create: { version: 1, effectiveDate: new Date('2026-01-01'), params: {
        cargaHoraria: 220, diasUteis: 22, periculosidadePct: .3, produtividadePct: .15,
        transferenciaPct: .3, confinamentoPct: .4, beneficios: { seguroVida: 50 }
      } } }
    } });
    await database.jobRole.create({ data: { id: roleId, name: prefix, normalizedKey: prefix, costProfile: { create: {
      id: profileIds[0], key: prefix, label: 'Perfil sintético', parameterSets: { create: {
        version: 1, effectiveDate: new Date('2026-01-01'), params: { salarioBase: 3960, baseModel: `${prefix}-model` }
      } }
    } } } });
    await database.collaborator.createMany({ data: people });
    const preferences = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [people[index]?.id || `${prefix}-historical-${index}`, 'AWAY']));
    await database.project.create({ data: { id: projectId, code: prefix, name: 'Projeto sintético', clientName: 'Cliente sintético',
      clientCnpj: '', contractCode: prefix, location: 'Local', offshore: true, mobilizationDate: day(1), demobilizationDate: day(30),
      laborSleepModeByCollaborator: preferences } });
    const reports = Array.from({ length: reportCount }, (_, index) => ({ id: `${prefix}-rdo-${index}`, projectId,
      reportType: 'RDO', status: 'APPROVED', sequenceNumber: index + 1, reportDate: day(1 + index % 30),
      arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1, daytimeWorkedMinutes: 480 }));
    const otherReports = [
      { id: `${prefix}-annual`, projectId, reportType: 'RTP', status: 'APPROVED', sequenceNumber: 1, reportDate: new Date('2026-01-10'), daytimeWorkedMinutes: 0 },
      { id: `${prefix}-service`, projectId, reportType: 'RLQ', status: 'APPROVED', sequenceNumber: 1, reportDate: day(14), daytimeWorkedMinutes: 0 },
      { id: `${prefix}-zero-rdo`, projectId, reportType: 'RDO', status: 'APPROVED', sequenceNumber: reportCount + 1, reportDate: day(15), daytimeWorkedMinutes: 0 }
    ];
    await insert('report', [...reports, ...otherReports].map(report => ({ arrivalTime: '08:00', departureTime: '08:00', lunchBreak: '00:00', daytimeCount: 1, ...report })));
    await insert('reportCollaborator', [...reports.map((report, index) => ({ reportId: report.id, collaboratorId: people[index % 20].id })),
      ...otherReports.map(report => ({ reportId: report.id, collaboratorId: people[20].id }))]);
    const services = reports.flatMap(report => Array.from({ length: servicesPerRdo }, () => ({ reportId: report.id, serviceType: 'TESTE_PRESSAO', startTime: '08:00', endTime: '17:00' })));
    services.push({ reportId: otherReports[1].id, serviceType: 'LIMPEZA_QUIMICA', startTime: '08:00', endTime: '09:30' },
      { reportId: otherReports[2].id, serviceType: 'TESTE_PRESSAO', startTime: '08:00', endTime: '18:00' });
    await insert('reportService', services);
    await database.pontoImport.create({ data: { id: importId, fileName: `${prefix}.xlsx`, contentHash: prefix, periodStart: day(1), periodEnd: day(30), createdAt: new Date('2026-10-01') } });
    const workedDates = Array.from({ length: 30 }, (_, index) => day(index + 1).toISOString().slice(0, 10));
    await database.pontoPeriodSummary.createMany({ data: people.map(person => ({ importId, collaboratorId: person.id,
      rawName: person.name, normalizedName: person.name.toLowerCase(), periodStart: day(1), periodEnd: day(30), workedMinutes: 30 * 528,
      workedDates, monthly: { '2026-09': { normalMinutes: 30 * 528, workedDates, days: workedDates.map(date => ({ date, workedMinutes: 528, extrasMinutes: 0, tags: [] })) } } })) });
    return { prefix, projectId, importId, reportCount: reports.length + otherReports.length, serviceCount: services.length, collaborators: people.length, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
