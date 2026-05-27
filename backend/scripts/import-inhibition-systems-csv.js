import fs from 'node:fs/promises';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (char !== '\r') {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter(item => item.some(cell => String(cell || '').trim()));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function rowsToRecords(rows) {
  const [header, ...dataRows] = rows;
  if (!header) return [];
  const columns = header.map(column => normalizeText(column));
  const required = ['code', 'description', 'diagram'];
  for (const column of required) {
    if (!columns.includes(column)) {
      throw new Error(`Coluna obrigatoria ausente no CSV: ${column}`);
    }
  }

  return dataRows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ''])));
}

async function importInhibitionSystems(records) {
  let imported = 0;
  for (const record of records) {
    const code = normalizeText(record.code);
    const description = normalizeText(record.description);
    const diagram = normalizeText(record.diagram);
    const order = Number.parseInt(normalizeText(record.order), 10);

    if (!code || !description || !diagram) {
      console.warn(`Sistema de inibicao ignorado por dados obrigatorios ausentes: ${code || 'sem-codigo'}`);
      continue;
    }

    const payload = {
      code,
      description,
      diagram,
      order: Number.isFinite(order) ? order : imported,
      isActive: true
    };

    await prisma.inhibitionSystem.upsert({
      where: { code },
      update: payload,
      create: payload
    });
    imported += 1;
  }
  return imported;
}

async function main() {
  const inputPath = process.argv[2] || process.env.INHIBITION_SYSTEMS_CSV;
  if (!inputPath) {
    throw new Error('Uso: npm run import:inhibition-systems-csv -- /caminho/inhibition-systems.csv');
  }

  const raw = await fs.readFile(inputPath, 'utf8');
  const records = rowsToRecords(parseCsv(raw));
  const imported = await importInhibitionSystems(records);

  console.log(JSON.stringify({ ok: true, imported }, null, 2));
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
