// Dry-run por padrão. Na VPS, executar --apply somente após conferir o resumo.
// O lote é atômico e só aceita a fotografia do RDO que foi conferida em 24/09/2026.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import prisma from '../src/lib/prisma.js';
import { listRealizedCorrections } from '../src/lib/acompanhamento/realized-corrections-store.js';

const fixture = JSON.parse(await readFile(fileURLToPath(new URL('./data/mission-5800-site-reframax-2026-09-24.json', import.meta.url)), 'utf8'));
const apply = process.argv.includes('--apply');
const key = row => `${row.date}:${row.serviceType}`;
const cents = value => Math.round(Number(value) * 100);

try {
  const project = await prisma.project.findFirst({ where: { code: fixture.projectCode, deletedAt: null }, select: { id: true, code: true } });
  if (!project) throw new Error(`Missão ${fixture.projectCode} não encontrada.`);
  const { rows } = await listRealizedCorrections(project.id);
  const sourceByKey = new Map(rows.map(row => [key(row), row]));
  const fixtureKeys = new Set(fixture.corrections.map(key));
  const unexpected = rows.find(row => row.correctedMeters !== null && !fixtureKeys.has(key(row)));
  if (unexpected) throw new Error(`Há uma correção fora do lote conferido em ${key(unexpected)}. Revise antes de aplicar.`);
  const sourceTotals = Object.fromEntries(Object.keys(fixture.sourceTotalsM).map(service => [service,
    cents(rows.filter(row => row.serviceType === service).reduce((sum, row) => sum + row.sourceMeters, 0))]));
  for (const [service, expected] of Object.entries(fixture.sourceTotalsM)) {
    if (sourceTotals[service] !== cents(expected)) throw new Error(`O total de ${service} mudou desde a conferência. Esperado ${expected} m, encontrado ${sourceTotals[service] / 100} m.`);
  }
  const pending = [];
  for (const item of fixture.corrections) {
    const existing = sourceByKey.get(key(item));
    if (cents(existing?.sourceMeters ?? 0) !== cents(item.originalMeters)) throw new Error(`O RDO de ${key(item)} mudou desde a conferência.`);
    if (existing?.revision) {
      if (existing.correctedMeters === null || cents(existing.correctedMeters) !== cents(item.quantityM)) throw new Error(`Há uma correção diferente para ${key(item)}. Revise manualmente.`);
      continue;
    }
    pending.push(item);
  }
  const finalTotals = Object.fromEntries(Object.keys(fixture.validatedTotalsM).map(service => [service,
    sourceTotals[service] + fixture.corrections.filter(row => row.serviceType === service)
      .reduce((sum, row) => sum + cents(row.quantityM) - cents(row.originalMeters), 0)]));
  for (const [service, expected] of Object.entries(fixture.validatedTotalsM)) {
    if (finalTotals[service] !== cents(expected)) throw new Error(`A conferência de ${service} não fecha com ${expected} m.`);
  }
  console.log(JSON.stringify({ project: project.code, mode: apply ? 'APPLY' : 'DRY_RUN',
    correctionsInFile: fixture.corrections.length, newCorrections: pending.length,
    sourceTotalsM: fixture.sourceTotalsM, validatedTotalsM: fixture.validatedTotalsM,
    changes: pending.map(item => ({ date: item.date, serviceType: item.serviceType,
      rdoM: item.originalMeters, validatedM: item.quantityM })) }, null, 2));
  if (apply && pending.length) {
    await prisma.$transaction(async tx => {
      const existing = await tx.projectRealizedCorrection.findMany({ where: { projectId: project.id } });
      if (existing.some(row => pending.some(item => row.measureDate.toISOString().slice(0, 10) === item.date && row.serviceType === item.serviceType))) {
        throw new Error('Uma correção foi criada durante a conferência. Execute a prévia novamente.');
      }
      for (const item of pending) await tx.projectRealizedCorrection.create({ data: {
        projectId: project.id,
        measureDate: new Date(`${item.date}T00:00:00.000Z`),
        serviceType: item.serviceType,
        revision: 1,
        sourceQuantityM: item.originalMeters,
        quantityM: item.quantityM,
        reason: item.date === '2026-09-23'
          ? 'RDO pendente após a última data validada do painel Reframax (22/09/2026); manter 0 m até nova conferência.'
          : 'Metragem diária validada pelos responsáveis da obra com base no histórico do painel Reframax em 24/09/2026.',
        reference: fixture.reference,
        createdByUserId: null
      } });
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    console.log(`Aplicadas ${pending.length} correções.`);
  }
  if (apply) {
    const after = (await listRealizedCorrections(project.id)).rows;
    for (const [service, expected] of Object.entries(fixture.validatedTotalsM)) {
      const actual = after.filter(row => row.serviceType === service).reduce((sum, row) => sum + cents(row.effectiveMeters), 0);
      if (actual !== cents(expected)) throw new Error(`Após aplicar, ${service} soma ${actual / 100} m; esperado ${expected} m.`);
    }
    console.log('Conferência após a aplicação: os três totais correspondem ao painel Reframax.');
  }
} finally {
  await prisma.$disconnect();
}
