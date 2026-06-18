import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import prisma from '../src/lib/prisma.js';
import { slugifySystemKey } from '../src/lib/equipment-categories.js';
import { buildTechnicalSchemaFromTracking, countTechnicalFields } from '../src/lib/equipment-technical-seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JSON = path.resolve(__dirname, '../../schema_categorias_dados_tecnicos.json');

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const help = process.argv.includes('--help') || process.argv.includes('-h');
const fileArg = process.argv.find(a => a.startsWith('--file='));
const jsonPath = fileArg ? path.resolve(fileArg.slice('--file='.length)) : DEFAULT_JSON;

if (help) {
  console.log(`Uso: npm run backfill:equipment-technical -- [opcoes]

Semeia o technicalSchema (Dados Técnicos) das categorias a partir do
schema_categorias_dados_tecnicos.json. Liga technicalDocEnabled e cria as
categorias que ainda não existem (casando por nome, sem duplicar).
Idempotente: categorias que já têm technicalSchema configurado são puladas
(use --force para sobrescrever).

Opcoes:
  --dry-run        Mostra o que seria feito sem alterar o banco
  --force          Sobrescreve o technicalSchema mesmo se já houver um
  --file=<caminho> Usa outro JSON (padrão: raiz do projeto)
  --help, -h       Mostra esta ajuda
`);
  process.exit(0);
}

const stats = { categoriesCreated: 0, categoriesUpdated: 0, categoriesSkipped: 0, fieldsSeeded: 0 };

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function uniqueSystemKey(base) {
  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.equipmentCategory.findUnique({ where: { systemKey: candidate } })) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  return candidate;
}

async function main() {
  console.log(`[backfill-equipment-technical] inicio${dryRun ? ' (dry-run)' : ''} — ${jsonPath}`);
  const payload = JSON.parse(await readFile(jsonPath, 'utf8'));
  const categorias = Array.isArray(payload?.categorias) ? payload.categorias : [];

  const existing = await prisma.equipmentCategory.findMany();
  const byName = new Map(existing.map(c => [normalizeName(c.name), c]));
  let nextOrder = existing.reduce((max, c) => Math.max(max, c.order || 0), 0) + 1;

  for (const cat of categorias) {
    const name = String(cat?.nome_categoria || '').trim();
    if (!name) continue;
    const technicalSchema = buildTechnicalSchemaFromTracking(cat?.campos_tecnicos);
    const fieldCount = countTechnicalFields(technicalSchema);
    const found = byName.get(normalizeName(name));

    if (found) {
      const hasSchema = Array.isArray(found.technicalSchema) && found.technicalSchema.length > 0;
      if (hasSchema && !force) {
        stats.categoriesSkipped += 1;
        console.log(`  = ${name}: já tem technicalSchema (${found.technicalSchema.length} campos), pulado`);
        continue;
      }
      stats.categoriesUpdated += 1;
      stats.fieldsSeeded += fieldCount;
      console.log(`  ~ ${name}: ${fieldCount} campos${dryRun ? ' (dry)' : ''}`);
      if (!dryRun) {
        await prisma.equipmentCategory.update({
          where: { id: found.id },
          data: { technicalSchema, technicalDocEnabled: true }
        });
      }
    } else {
      stats.categoriesCreated += 1;
      stats.fieldsSeeded += fieldCount;
      console.log(`  + ${name}: nova categoria, ${fieldCount} campos${dryRun ? ' (dry)' : ''}`);
      if (!dryRun) {
        const systemKey = await uniqueSystemKey(slugifySystemKey(name));
        const created = await prisma.equipmentCategory.create({
          data: {
            systemKey,
            name,
            order: nextOrder++,
            technicalSchema,
            technicalDocEnabled: true,
            supportsTechnicalDoc: true,
            supportsCalibration: false,
            syncToRomaneio: false
          }
        });
        byName.set(normalizeName(name), created);
      }
    }
  }

  console.log(JSON.stringify({ dryRun, force, ...stats }, null, 2));
}

main()
  .catch(error => {
    console.error('[backfill-equipment-technical] erro', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
