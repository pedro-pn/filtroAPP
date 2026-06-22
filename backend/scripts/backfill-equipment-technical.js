import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import prisma from '../src/lib/prisma.js';
import { slugifySystemKey, normalizeTechnicalSchema } from '../src/lib/equipment-categories.js';
import { buildTechnicalSchemaFromTracking, countTechnicalFields } from '../src/lib/equipment-technical-seed.js';
import { curatedTechnicalSchema } from '../data/technical-schema-curated.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Versionado em backend/data (vai na imagem via Dockerfile) — dispensa --file/dc cp.
const DEFAULT_JSON = path.resolve(__dirname, '../data/schema_categorias_dados_tecnicos.json');

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
  --file=<caminho> Usa outro JSON (padrão: backend/data/schema_categorias_dados_tecnicos.json)
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

// Renomeia categorias existentes ANTES do seed (preserva id/systemKey/equipamentos).
// "Unidades de Desidratação" foi a mescla provisória de centrífuga+termovácuo; agora
// vira "Unidades de Termovácuo" e a centrífuga ganha categoria própria.
const CATEGORY_RENAMES = {
  'unidades de desidratacao': 'Unidades de Termovácuo'
};

// O JSON de seed traz nomes de categoria desatualizados (anteriores à reformatação
// feita no banco). Este mapa liga cada nome do JSON (normalizado) ao nome REAL da
// categoria já existente, para semear na categoria certa sem renomear nem duplicar.
// Várias entradas podem apontar para o mesmo destino (os campos são MESCLADOS).
// Nomes do JSON sem entrada aqui e sem categoria existente são criados como novos.
const CATEGORY_ALIASES = {
  'analisador de agua': 'Analisadores de Água em Óleo',
  'boroscopio': 'Boroscópios',
  'compressor': 'Compressores',
  'contador de particulas a laser': 'Contadores de Partículas',
  'contencao para reservatorio': 'Contenções',
  'malao de ferramentas': 'Malões de Ferramentas',
  'transformador': 'Trafos',
  'bomba pneumatica': 'Unidades de Bomba Pneumática',
  'unidade de filtragem': 'Unidades de Filtragem',
  'unidade de flushing primario': 'Unidades de Flushing',
  'unidade de limpeza quimica': 'Unidades de Limpeza Química',
  'unidade movel de transferencia': 'Unidade Móvel de Transferência',
  'unidade de teste hidrostatico': 'Unidades de Teste Hidrostático',
  // Separadas: termovácuo é a categoria renomeada; centrífuga vira nova categoria.
  'unidade de termovacuo': 'Unidades de Termovácuo',
  'unidade de centrifuga': 'Unidades de Centrífuga',
  // Sem categoria existente: criada como nova, mas com o nome correto.
  'unidade de run out': 'Unidades de Run out'
  // Sem alias (criadas como novas): "Reservatório de aço carbono", "Reservatório de inox".
};

// Campos físicos do equipamento, injetados no technicalSchema (não vêm no JSON de seed,
// pois lá são "campos base"). Peso entra em TODAS as categorias; altura/largura/comprimento
// só nas que de fato precisam. Renderizados no cabeçalho do datasheet (Tabela 1), não na
// listagem de campos (Tabela 2) — ver BASE_PHYSICAL_KEYS em equipment-technical-doc.js.
const PESO_FIELD = { label: 'Peso', key: 'peso', type: 'measurement_text', unit_hint: 'kg' };
const DIMENSION_FIELDS = [
  { label: 'Altura', key: 'altura', type: 'measurement_text', unit_hint: 'cm/m' },
  { label: 'Largura', key: 'largura', type: 'measurement_text', unit_hint: 'cm/m' },
  { label: 'Comprimento', key: 'comprimento', type: 'measurement_text', unit_hint: 'cm/m' }
];

// Categorias que precisam de altura/largura/comprimento (além do peso universal):
// Compressores, Contenções, Malões de Ferramentas, Trafos, todas as "Unidades"
// e todos os "Reservatórios".
function needsDimensions(name) {
  const n = normalizeName(name);
  if (n.startsWith('unidade')) return true;
  if (n.startsWith('reservatorio')) return true;
  return ['compressores', 'contencoes', 'maloes de ferramentas', 'trafos'].includes(n);
}

function physicalFieldsFor(name) {
  return needsDimensions(name) ? [PESO_FIELD, ...DIMENSION_FIELDS] : [PESO_FIELD];
}

// Versão já-normalizada dos campos físicos (para o caminho curado, que usa
// normalizeTechnicalSchema em vez de buildTechnicalSchemaFromTracking).
function physicalFieldsNormalized(name) {
  const peso = { label: 'Peso', type: 'measure', unit: { dimension: 'peso' } };
  const dims = [
    { label: 'Altura', type: 'measure', unit: { dimension: 'dimensao' } },
    { label: 'Largura', type: 'measure', unit: { dimension: 'dimensao' } },
    { label: 'Comprimento', type: 'measure', unit: { dimension: 'dimensao' } }
  ];
  return needsDimensions(name) ? [peso, ...dims] : [peso];
}

// Remove campos do JSON que duplicam os campos-base físicos (ex.: "Peso" no Compressor):
// eles agora são injetados separadamente e renderizados no cabeçalho do datasheet.
const PHYSICAL_LABELS = new Set(['peso', 'altura', 'largura', 'comprimento']);
function stripPhysicalCampos(campos) {
  return (Array.isArray(campos) ? campos : []).filter(c => !PHYSICAL_LABELS.has(normalizeName(c?.label)));
}

// Monta o technicalSchema do destino: usa o schema curado quando existe (com campos
// físicos normalizados injetados), senão deriva do JSON (tracking) sem os campos físicos.
function buildSchemaForDestination(displayName, campos) {
  const curated = curatedTechnicalSchema(normalizeName(displayName));
  if (curated) {
    return normalizeTechnicalSchema([...physicalFieldsNormalized(displayName), ...curated]);
  }
  return buildTechnicalSchemaFromTracking([...physicalFieldsFor(displayName), ...stripPhysicalCampos(campos)]);
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

  // 0) Renomeia categorias existentes (preserva id/systemKey/equipamentos) e atualiza o byName.
  for (const [fromKey, toName] of Object.entries(CATEGORY_RENAMES)) {
    const current = byName.get(fromKey);
    if (!current || normalizeName(current.name) === normalizeName(toName)) continue;
    console.log(`  » renomeia "${current.name}" → "${toName}"${dryRun ? ' (dry)' : ''}`);
    if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.equipmentCategory.update({ where: { id: current.id }, data: { name: toName } });
    }
    current.name = toName;
    byName.delete(fromKey);
    byName.set(normalizeName(toName), current);
  }

  // 1) Resolve cada categoria do JSON ao seu destino (categoria existente via alias/
  //    nome igual, ou criação nova) e AGRUPA por destino. (Centrífuga e termovácuo agora
  //    são destinos distintos — sem mescla.)
  const groups = new Map(); // chave normalizada do destino → { displayName, existing, sources, campos }
  for (const cat of categorias) {
    const name = String(cat?.nome_categoria || '').trim();
    if (!name) continue;
    const aliasTarget = CATEGORY_ALIASES[normalizeName(name)];
    const lookupName = aliasTarget || name;
    const key = normalizeName(lookupName);
    const existing = byName.get(key) || null;
    if (!groups.has(key)) {
      groups.set(key, { displayName: existing ? existing.name : lookupName, existing, sources: [], campos: [] });
    }
    const group = groups.get(key);
    group.sources.push(name);
    group.campos.push(...(Array.isArray(cat?.campos_tecnicos) ? cat.campos_tecnicos : []));
  }

  // 2) Semeia cada destino (mantendo o nome real da categoria existente).
  for (const group of groups.values()) {
    // Schema curado (se houver) ou derivado do JSON; ambos com os campos físicos
    // (peso + dimensões conforme a categoria) injetados.
    const technicalSchema = buildSchemaForDestination(group.displayName, group.campos);
    const fieldCount = countTechnicalFields(technicalSchema);
    const mergeNote = group.sources.length > 1 ? ` [mescla: ${group.sources.join(' + ')}]` : '';

    if (group.existing) {
      const hasSchema = Array.isArray(group.existing.technicalSchema) && group.existing.technicalSchema.length > 0;
      if (hasSchema && !force) {
        stats.categoriesSkipped += 1;
        console.log(`  = ${group.displayName}: já tem technicalSchema (${group.existing.technicalSchema.length} campos), pulado${mergeNote}`);
        continue;
      }
      stats.categoriesUpdated += 1;
      stats.fieldsSeeded += fieldCount;
      console.log(`  ~ ${group.displayName} ⇐ ${group.sources.join(' + ')}: ${fieldCount} campos${dryRun ? ' (dry)' : ''}`);
      if (!dryRun) {
        await prisma.equipmentCategory.update({
          where: { id: group.existing.id },
          data: { technicalSchema, technicalDocEnabled: true }
        });
      }
    } else {
      stats.categoriesCreated += 1;
      stats.fieldsSeeded += fieldCount;
      console.log(`  + ${group.displayName}: NOVA categoria, ${fieldCount} campos${dryRun ? ' (dry)' : ''}${mergeNote}`);
      if (!dryRun) {
        const systemKey = await uniqueSystemKey(slugifySystemKey(group.displayName));
        const created = await prisma.equipmentCategory.create({
          data: {
            systemKey,
            name: group.displayName,
            order: nextOrder++,
            technicalSchema,
            technicalDocEnabled: true,
            supportsTechnicalDoc: true,
            supportsCalibration: false,
            syncToRomaneio: false
          }
        });
        byName.set(normalizeName(group.displayName), created);
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
