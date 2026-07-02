import fs from 'node:fs/promises';

import prisma from '../src/lib/prisma.js';


function collaboratorCodeFromId(id) {
  return `COL-${String(id).trim().padStart(3, '0')}`;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function parseIsoDate(value) {
  const raw = normalizeText(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Data invalida no formato esperado yyyy-mm-dd: ${raw}`);
  }
  const [, yyyy, mm, dd] = match;
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0));
}

async function importCollaborators(collaborators) {
  let imported = 0;
  for (const item of collaborators || []) {
    const id = item.id;
    const code = collaboratorCodeFromId(id);
    const payload = {
      code,
      name: normalizeText(item.name),
      role: normalizeText(item.role) || 'Colaborador',
      email: normalizeEmail(item.email),
      signatureImage: null,
      isActive: true
    };
    if (!id || !payload.name) {
      console.warn(`Colaborador ignorado por nome vazio: ${JSON.stringify(item)}`);
      continue;
    }
    await prisma.collaborator.upsert({
      where: { code },
      update: payload,
      create: payload
    });
    imported += 1;
  }
  return imported;
}

async function importManometers(manometers) {
  let imported = 0;
  for (const item of manometers || []) {
    if (!item || typeof item !== 'object') {
      console.warn('Manometro ignorado por formato invalido.');
      continue;
    }
    const payload = {
      code: normalizeText(item.code),
      scale: normalizeText(item.scale),
      calibrationCertCode: normalizeText(item.calibrationCertCode),
      calibratedAt: parseIsoDate(item.calibratedAt),
      expiresAt: parseIsoDate(item.expiresAt),
      isActive: true
    };
    if (!payload.code || !payload.scale || !payload.calibrationCertCode) {
      console.warn(`Manometro ignorado por dados obrigatorios ausentes: ${payload.code || 'sem-codigo'}`);
      continue;
    }
    await prisma.manometer.upsert({
      where: { code: payload.code },
      update: payload,
      create: payload
    });
    imported += 1;
  }
  return imported;
}

async function importUnits(units) {
  let imported = 0;
  for (const item of units || []) {
    const code = normalizeText(item.code);
    const category = normalizeText(item.category);
    if (!code || !category) {
      console.warn(`Unidade ignorada por dados obrigatorios ausentes: ${code || 'sem-codigo'}`);
      continue;
    }
    await prisma.unit.upsert({
      where: { code },
      update: { category },
      create: { code, category }
    });
    imported += 1;
  }
  return imported;
}

async function importParticleCounters(counters) {
  let imported = 0;
  for (const item of counters || []) {
    const code = normalizeText(item.code);
    const serialNumber = normalizeText(item.serialNumber);
    const calibratedAt = item.calibratedAt;
    const expiresAt = item.expiresAt;
    if (!code || !serialNumber || !calibratedAt || !expiresAt) {
      console.warn(`Contador ignorado por dados obrigatorios ausentes: ${code || 'sem-codigo'}`);
      continue;
    }
    const payload = {
      code,
      serialNumber,
      category: normalizeText(item.category) || 'CONTADOR DE PARTICULAS',
      calibratedAt: parseIsoDate(calibratedAt),
      expiresAt: parseIsoDate(expiresAt),
      isActive: true
    };
    await prisma.particleCounter.upsert({
      where: { code },
      update: payload,
      create: payload
    });
    imported += 1;
  }
  return imported;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Uso: node scripts/import-master-data.js /caminho/arquivo.json');
  }

  const raw = await fs.readFile(inputPath, 'utf8');
  const parsed = JSON.parse(raw);

  const collaboratorsCount = await importCollaborators(parsed.collaborators);
  const manometersCount = await importManometers(parsed.manometers);
  const unitsCount = await importUnits(parsed.units);
  const countersCount = await importParticleCounters(parsed.particleCounters);

  console.log(JSON.stringify({
    ok: true,
    collaboratorsImported: collaboratorsCount,
    manometersImported: manometersCount,
    unitsImported: unitsCount,
    countersImported: countersCount
  }, null, 2));
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
