// Preview by default. --apply creates the snapshot and archives the original atomically.
// --restore ends the presentation and restores only the original archive state.
// Creation requires --input /private/path/presentation.json; keep meeting data outside Git.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import prisma from '../src/lib/prisma.js';
import { listProjectCards } from '../src/lib/acompanhamento/project-cards.js';
import { getProjectDetail } from '../src/lib/acompanhamento/project-detail.js';
import { getPlannedScope } from '../src/lib/acompanhamento/planned-scope.js';
import { getTrackingDivisions } from '../src/lib/acompanhamento/tracking-divisions.js';
import { getProjectInvoices } from '../src/lib/acompanhamento/project-invoices.js';
import { getProjectRomaneios } from '../src/lib/acompanhamento/project-romaneios.js';
import { getProjectStandbyHistory } from '../src/lib/acompanhamento/standby-history.js';
import { listProjectManagementNotes } from '../src/lib/acompanhamento/project-notes.js';
import { listProjectRevisions } from '../src/lib/acompanhamento/access-import.js';
import { computeProjectProgress } from '../src/lib/acompanhamento/avanco.js';
import { listRealizedCorrections } from '../src/lib/acompanhamento/realized-corrections-store.js';
import { getOfficialMissionContext } from '../src/lib/efetivo/planning/official-mission-context.js';
import { listWeeklyProgressTargets, weeklyTargetReferenceDayHours } from '../src/lib/acompanhamento/weekly-progress-targets.js';
import { loadWeeklyServiceHistory } from '../src/lib/acompanhamento/weekly-service-history.js';
import { loadWeeklyAttendanceHistory } from '../src/lib/acompanhamento/weekly-attendance-history.js';
import { listProjectDeviations } from '../src/lib/qualidade/service.js';
import { createPresentationCopy, endPresentationCopy, getPresentationCopy } from '../src/lib/acompanhamento/presentation-copies.js';
import { clearProjectDerivedCaches } from '../src/lib/resource-list-cache.js';

const id = 'presentation-5775-2026-10-09';
const json = value => JSON.parse(JSON.stringify(value));
const money = z.number().nonnegative().max(999999999999.99)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, 'Use no máximo duas casas decimais.');
const inputSchema = z.object({
  taxAmount: money,
  incident: z.object({
    personName: z.string().trim().min(1).max(200),
    eventDate: z.iso.date(),
    natureName: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000),
    definedAction: z.string().trim().min(1).max(2000),
    cost: money
  }).strict()
}).strict();

try {
  if (process.argv.includes('--restore')) {
    const copy = await endPresentationCopy(id);
    console.log(JSON.stringify({ id, restored: copy.sourceProjectId, endedAt: copy.endedAt }));
  } else {
    const inputIndex = process.argv.indexOf('--input');
    const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : null;
    if (!inputPath || inputPath.startsWith('--')) throw new Error('Informe --input com o arquivo privado dos valores e do incidente da apresentação.');
    const input = inputSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')));
    if (await getPresentationCopy(id)) throw new Error('A apresentação já existe. Nenhuma alteração foi feita.');
    const project = await prisma.project.findUniqueOrThrow({ where: { code: '5775' } });
    if (project.deletedAt || project.acompanhamentoArchivedAt) throw new Error('A missão deve estar disponível no Acompanhamento antes da cópia.');
    const projectId = project.id;
    const variants = {};
    for (const [key, admin] of [['admin', true], ['standard', false]]) {
      const detail = await getProjectDetail(projectId, { includeCollaboratorCosts: true, includeAdminOnlyCategories: admin });
      const card = (await listProjectCards({ includeAdminOnlyCategories: admin })).find(item => item.projectId === projectId);
      if (!card) throw new Error('Card da missão não encontrado.');
      variants[key] = { detalhe: detail, card };
    }
    const detail = variants.admin.detalhe;
    const auxiliary = {};
    // Keep the underlying reports and attachments in their original locations;
    // all presentation panel queries use frozen responses and permit only reading.
    for (const [key, load] of Object.entries({
      'escopo-previsto': () => getPlannedScope(projectId),
      divisoes: () => getTrackingDivisions(projectId),
      faturamentos: () => getProjectInvoices(projectId),
      romaneios: () => getProjectRomaneios(projectId),
      'standby-historico': () => getProjectStandbyHistory(projectId),
      'notas-gestao': () => listProjectManagementNotes(projectId),
      revisoes: () => listProjectRevisions(projectId),
      avanco: () => computeProjectProgress(projectId),
      'correcoes-realizado': () => listRealizedCorrections(projectId),
      'planning-context': () => getOfficialMissionContext({ projectId, date: detail.header.lastRdoDate ? new Date(detail.header.lastRdoDate).toISOString().slice(0, 10) : '2026-10-09' })
    })) auxiliary[key] = await load();
    if (auxiliary.divisoes.divisions.length) throw new Error('A missão tem divisões: capture cada divisão antes de criar a cópia.');
    const targets = await listWeeklyProgressTargets({ projectId });
    auxiliary['metas-semanais'] = {
      targets, defaultReferenceDayHours: await weeklyTargetReferenceDayHours({ projectId }),
      progressHistory: detail.progressHistory,
      serviceHistory: await loadWeeklyServiceHistory({ projectId }),
      attendanceHistory: targets.some(target => target.definition?.metric === 'COLLABORATORS') ? await loadWeeklyAttendanceHistory({ projectId }) : []
    };
    const deviations = await listProjectDeviations(prisma, projectId);
    const incident = {
      id: `${id}-incident`, number: `Incidente · ${input.incident.personName}`, type: 'INCIDENTE',
      registeredAt: new Date().toISOString(), eventDate: input.incident.eventDate,
      origin: 'Missão 5775', nature: { name: input.incident.natureName },
      description: input.incident.description,
      definedAction: input.incident.definedAction,
      cost: input.incident.cost, impact: null, status: null, disposition: null,
      occurrences12m: 1, recurrent: false, linkedRnc: null, actionOwner: null, actionDeadline: null
    };
    const existing = deviations.find(item => (item.description ?? '').toLocaleLowerCase('pt-BR').includes(input.incident.personName.toLocaleLowerCase('pt-BR'))
      && item.eventDate === input.incident.eventDate);
    if (existing) existing.cost = input.incident.cost;
    else deviations.push(incident);
    const snapshot = json({ originalProject: project, variants, auxiliary, deviations, taxAmount: input.taxAmount });
    const actual = detail.consumo.gasto + (detail.maoDeObra.custo ?? 0);
    console.log(JSON.stringify({ id, source: project.code, name: project.name, actual, taxes: snapshot.taxAmount,
      incidentDate: incident.eventDate, incidentCost: incident.cost, originalDeviations: deviations.length - (existing ? 0 : 1),
      mode: process.argv.includes('--apply') ? 'APPLY' : 'PREVIEW', snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)) }, null, 2));
    if (process.argv.includes('--apply')) {
      const backupDir = process.env.PRESENTATION_BACKUP_DIR;
      if (!backupDir) throw new Error('Defina PRESENTATION_BACKUP_DIR para salvar a conferência antes da aplicação.');
      await mkdir(backupDir, { recursive: true, mode: 0o700 });
      await writeFile(path.join(backupDir, `${id}.json`), JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
      const copy = await createPresentationCopy({ id, snapshot });
      clearProjectDerivedCaches();
      const after = json(await prisma.project.findUniqueOrThrow({ where: { id: projectId } }));
      const changed = Object.keys(snapshot.originalProject).filter(key => JSON.stringify(after[key]) !== JSON.stringify(snapshot.originalProject[key]));
      if (changed.some(key => !['acompanhamentoArchivedAt', 'acompanhamentoReviewedAt', 'updatedAt'].includes(key))) throw new Error('A original sofreu uma alteração inesperada.');
      console.log(JSON.stringify({ created: copy.id, archivedOriginal: projectId, changedOriginalFields: changed }));
    }
  }
} finally {
  await prisma.$disconnect();
}
