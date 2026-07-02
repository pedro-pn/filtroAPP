import fs from 'node:fs/promises';
import path from 'node:path';

import prisma from '../src/lib/prisma.js';


function usage() {
  return [
    'Uso: npm run import:collaborators-csv -- --file caminho/colaboradores.csv [--apply] [--create-missing]',
    '',
    'CSV esperado com separador ; e cabecalho contendo nome, matricula, data de admissao e CPF.',
    'Por padrao roda em dry-run. Use --apply para gravar.'
  ].join('\n');
}

function parseArgs(argv) {
  const args = { apply: false, createMissing: false, file: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--create-missing') {
      args.createMissing = true;
    } else if (arg === '--file') {
      args.file = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--file=')) {
      args.file = arg.slice('--file='.length);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }
  return args;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeComparable(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function headerKey(value) {
  return normalizeComparable(value).replace(/[^a-z0-9]/g, '');
}

function splitCsvLine(line, delimiter = ';') {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map(cell => cell.trim());
}

function parseCsv(content) {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(line => line.trim());
  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]).map(headerKey);
  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    const row = { __line: index + 2 };
    headers.forEach((header, cellIndex) => {
      row[header] = cells[cellIndex] || '';
    });
    return row;
  });
}

function pick(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (normalizeText(value)) return normalizeText(value);
  }
  return '';
}

function cpfDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCpf(value) {
  const digits = cpfDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;

  const numbers = digits.split('').map(Number);
  const calc = length => {
    const sum = numbers.slice(0, length).reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  return calc(9) === numbers[9] && calc(10) === numbers[10];
}

function formatCpf(value) {
  const digits = cpfDigits(value);
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

function normalizeCpf(value) {
  const digits = cpfDigits(value);
  if (!digits) return null;
  if (!isValidCpf(digits)) throw new Error(`CPF invalido: ${value}`);
  return formatCpf(digits);
}

function parseDate(value) {
  const raw = normalizeText(value);
  if (!raw) return null;

  let day;
  let month;
  let year;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (br) {
    [, day, month, year] = br;
  } else if (iso) {
    [, year, month, day] = iso;
  } else {
    throw new Error(`Data invalida. Use DD/MM/YYYY ou YYYY-MM-DD: ${raw}`);
  }

  const date = new Date(`${year}-${month}-${day}T12:00:00.000-03:00`);
  const maxDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (
    Number.isNaN(date.getTime())
    || Number(month) < 1
    || Number(month) > 12
    || Number(day) < 1
    || Number(day) > maxDay
  ) {
    throw new Error(`Data invalida: ${raw}`);
  }
  return date;
}

async function nextCollaboratorCode() {
  const latest = await prisma.collaborator.findMany({
    where: { code: { startsWith: 'COL-' } },
    select: { code: true },
    orderBy: { code: 'desc' },
    take: 100
  });
  const max = latest.reduce((current, item) => {
    const match = item.code.match(/^COL-(\d+)$/);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `COL-${String(max + 1).padStart(3, '0')}`;
}

async function findCollaborator({ name, cpf, registrationNumber }) {
  if (cpf) {
    const byCpf = await prisma.collaborator.findFirst({ where: { cpf } });
    if (byCpf) return { collaborator: byCpf, matchedBy: 'cpf' };
  }
  if (registrationNumber) {
    const byRegistration = await prisma.collaborator.findMany({ where: { registrationNumber } });
    if (byRegistration.length === 1) return { collaborator: byRegistration[0], matchedBy: 'matricula' };
    if (byRegistration.length > 1) return { error: `matricula duplicada no banco: ${registrationNumber}` };
  }

  const byName = await prisma.collaborator.findMany({ where: { name: { equals: name, mode: 'insensitive' } } });
  if (byName.length === 1) return { collaborator: byName[0], matchedBy: 'nome' };
  if (byName.length > 1) return { error: `nome duplicado no banco: ${name}` };

  const comparableName = normalizeComparable(name);
  const byComparableName = (await prisma.collaborator.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      role: true,
      email: true,
      cpf: true,
      registrationNumber: true,
      admissionDate: true,
      signatureImage: true,
      signatureNoticeAcceptedAt: true,
      signatureNoticeVersion: true,
      isActive: true,
      createdAt: true,
      updatedAt: true
    }
  })).filter(item => normalizeComparable(item.name) === comparableName);
  if (byComparableName.length === 1) return { collaborator: byComparableName[0], matchedBy: 'nome normalizado' };
  if (byComparableName.length > 1) return { error: `nome duplicado no banco: ${name}` };
  return { collaborator: null, matchedBy: null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    console.log(usage());
    return;
  }

  const csvPath = path.resolve(process.cwd(), args.file);
  const rows = parseCsv(await fs.readFile(csvPath, 'utf8'));
  const summary = { rows: rows.length, updated: 0, created: 0, skipped: 0, errors: 0, dryRun: !args.apply };

  for (const row of rows) {
    try {
      const name = pick(row, ['nome', 'nomedocolaborador', 'name', 'colaborador', 'funcionario']);
      const registrationNumber = pick(row, ['matricula', 'matrcula', 'registrationnumber', 'registro']) || null;
      const cpf = normalizeCpf(pick(row, ['cpf']));
      const admissionDate = parseDate(pick(row, ['datadeadmissao', 'dataadmissao', 'admissao', 'admissiondate']));

      if (!name) {
        console.warn(`Linha ${row.__line}: ignorada por nome vazio.`);
        summary.skipped += 1;
        continue;
      }

      const found = await findCollaborator({ name, cpf, registrationNumber });
      if (found.error) {
        console.warn(`Linha ${row.__line}: ${found.error}.`);
        summary.errors += 1;
        continue;
      }

      const data = { cpf, registrationNumber, admissionDate, isActive: true };
      if (found.collaborator) {
        if (args.apply) {
          await prisma.collaborator.update({ where: { id: found.collaborator.id }, data });
        }
        console.log(`${args.apply ? 'Atualizado' : 'Atualizaria'} (${found.matchedBy}): ${found.collaborator.code} - ${found.collaborator.name}`);
        summary.updated += 1;
        continue;
      }

      if (!args.createMissing) {
        console.warn(`Linha ${row.__line}: colaborador nao encontrado para "${name}". Use --create-missing para criar.`);
        summary.skipped += 1;
        continue;
      }

      const code = await nextCollaboratorCode();
      if (args.apply) {
        await prisma.collaborator.create({
          data: {
            code,
            name,
            role: 'Colaborador',
            email: null,
            signatureImage: null,
            isActive: true,
            ...data
          }
        });
      }
      console.log(`${args.apply ? 'Criado' : 'Criaria'}: ${code} - ${name}`);
      summary.created += 1;
    } catch (error) {
      console.warn(`Linha ${row.__line}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
      summary.errors += 1;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors) process.exitCode = 1;
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
