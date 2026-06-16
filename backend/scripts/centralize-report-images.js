/**
 * Centraliza e repara as referências de imagens dos relatórios.
 *
 * O que faz:
 *  1. Indexa todos os arquivos de imagem em reportsDir.
 *  2. Para cada referência no JSON (relatórios, serviços e rascunhos):
 *     - normaliza para a forma canônica única (caminho relativo, decodificado);
 *     - se o arquivo existe nesse caminho → mantém;
 *     - se não existe → tenta recuperar pelo basename (quando único no disco);
 *     - arquivos na RAIZ (sem pasta de projeto) são relocados para a pasta do
 *       projeto do relatório (única movimentação, só na migração) para que a
 *       autorização por escopo de projeto funcione;
 *     - o que não for encontrado é listado como IRRECUPERÁVEL.
 *  3. Reconstrói o índice ReportAttachment 1:1 a partir do JSON.
 *  4. Lista arquivos órfãos (no disco, sem nenhuma referência).
 *
 * Uso (rode no servidor / dentro do container backend):
 *   node backend/scripts/centralize-report-images.js            # dry-run (não grava)
 *   node backend/scripts/centralize-report-images.js --apply    # aplica as mudanças
 *   node backend/scripts/centralize-report-images.js --project=5775   # filtra por código
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import env from '../src/config/env.js';
import prisma from '../src/lib/prisma.js';
import {
  looksLikeUploadReference,
  normalizeReportUploadReference,
  syncReportUploadAttachments
} from '../src/lib/report-upload-attachments.js';

const APPLY = process.argv.includes('--apply');
const projectFilterArg = process.argv.find(a => a.startsWith('--project='));
const projectFilter = projectFilterArg ? projectFilterArg.slice('--project='.length).trim() : '';
const csvArg = process.argv.find(a => a === '--csv' || a.startsWith('--csv='));
const csvPath = csvArg
  ? (csvArg.includes('=') ? csvArg.slice('--csv='.length).trim() : 'scripts/faltantes-fotos.csv')
  : '';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|dng|pdf)$/i;
const SKIP_DIRS = new Set(['.cache', 'generated-pdf', 'generated-pdf-test']);

function safePath(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function projectFolderName(project) {
  if (!project?.code || !project?.name) return '';
  return safePath(`Missão ${project.code} - ${project.name}`);
}

function isUnderProjectFolder(relPath) {
  const first = relPath.split('/').filter(Boolean)[0] || '';
  return first.startsWith('Missão ');
}

// ── Indexa os arquivos físicos ──
function buildFileIndex(root) {
  const set = new Set();
  const byBasename = new Map();
  const normalized = new Map();
  function walk(dir, rel) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile() && IMAGE_EXT.test(entry.name)) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        set.add(relPath);
        const list = byBasename.get(entry.name) || [];
        list.push(relPath);
        byBasename.set(entry.name, list);
        const key = normKey(relPath);
        // Mapa case/acento-insensível: null marca ambiguidade (não recupera).
        normalized.set(key, normalized.has(key) ? null : relPath);
      }
    }
  }
  walk(root, '');
  return { set, byBasename, normalized };
}

// Chave normalizada: ignora diferenças de maiúscula/minúscula e de codificação de
// acentos (NFC) no caminho — recuperação segura, sem trocar de arquivo.
function normKey(relPath) {
  return relPath.normalize('NFC').toLowerCase();
}

// ── Resolve onde uma referência canônica deve apontar ──
function resolveRef(canonical, ctx) {
  const { projectFolder, index, stats, relocations, reportLabel } = ctx;
  // 1. arquivo existe exatamente no caminho canônico
  let actual = index.set.has(canonical) ? canonical : null;

  // 2. recuperação SEGURA por caminho case/acento-insensível (mesmo arquivo)
  if (!actual) {
    const hit = index.normalized.get(normKey(canonical));
    if (hit) actual = hit;
  }

  // 3. recuperação por basename único
  if (!actual) {
    const base = canonical.split('/').pop();
    const matches = index.byBasename.get(base) || [];
    if (matches.length === 1) {
      actual = matches[0];
    } else {
      stats.unrecoverable.push({ path: canonical, report: reportLabel || '(sem relatório)' });
      return canonical;
    }
  }

  // 4. relocação de arquivos na raiz para a pasta do projeto
  if (!isUnderProjectFolder(actual) && projectFolder) {
    const dest = `${projectFolder}/${actual.split('/').pop()}`;
    relocations.set(actual, dest);
    // índice passa a conhecer o novo caminho
    index.set.add(dest);
    stats.relocated += 1;
    return dest;
  }

  if (actual === canonical) stats.ok += 1;
  else stats.recovered += 1;
  return actual;
}

// ── Reescrita recursiva das referências no JSON ──
function rewriteRefs(value, ctx) {
  if (typeof value === 'string') {
    if (!looksLikeUploadReference(value)) return value;
    const canonical = normalizeReportUploadReference(value);
    if (!canonical) return value;
    if (value !== canonical && canonical) ctx.stats.canonicalized += 1;
    const resolved = resolveRef(canonical, ctx);
    ctx.referenced.add(resolved);
    return resolved;
  }
  if (Array.isArray(value)) return value.map(item => rewriteRefs(item, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteRefs(v, ctx)]));
  }
  return value;
}

function jsonEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function main() {
  const root = env.reportsDir;
  console.log(`[centralize] reportsDir=${root} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}${projectFilter ? ` project=${projectFilter}` : ''}`);

  const index = buildFileIndex(root);
  console.log(`[centralize] arquivos de imagem indexados: ${index.set.size}`);

  const stats = { ok: 0, canonicalized: 0, recovered: 0, relocated: 0, unrecoverable: [] };
  const referenced = new Set();
  const relocations = new Map(); // origem relativa -> destino relativo

  const reports = await prisma.report.findMany({
    select: {
      id: true,
      reportType: true,
      sequenceNumber: true,
      specialConditions: true,
      project: { select: { code: true, name: true } },
      services: { select: { id: true, extraData: true } }
    }
  });

  let reportsChanged = 0;
  let servicesChanged = 0;

  for (const report of reports) {
    const projectFolder = projectFolderName(report.project);
    if (projectFilter && !(report.project?.code || '').includes(projectFilter)) continue;
    const reportLabel = `${report.reportType} ${report.sequenceNumber ?? report.id.slice(0, 6)} (${report.project?.code || '?'})`;
    const ctx = { projectFolder, index, stats, referenced, relocations, reportLabel };

    const newSC = rewriteRefs(report.specialConditions, ctx);
    if (!jsonEqual(newSC, report.specialConditions)) {
      if (APPLY) await prisma.report.update({ where: { id: report.id }, data: { specialConditions: newSC } });
      reportsChanged += 1;
    }
    for (const service of report.services || []) {
      const newExtra = rewriteRefs(service.extraData, ctx);
      if (!jsonEqual(newExtra, service.extraData)) {
        if (APPLY) await prisma.reportService.update({ where: { id: service.id }, data: { extraData: newExtra } });
        servicesChanged += 1;
      }
    }
  }

  // Rascunhos
  const drafts = await prisma.reportDraft.findMany({
    select: { id: true, payload: true, project: { select: { code: true, name: true } } }
  });
  let draftsChanged = 0;
  for (const draft of drafts) {
    const projectFolder = projectFolderName(draft.project);
    if (projectFilter && !(draft.project?.code || '').includes(projectFilter)) continue;
    const ctx = { projectFolder, index, stats, referenced, relocations, reportLabel: `rascunho ${draft.id.slice(0, 6)} (${draft.project?.code || '?'})` };
    const newPayload = rewriteRefs(draft.payload, ctx);
    if (!jsonEqual(newPayload, draft.payload)) {
      if (APPLY) await prisma.reportDraft.update({ where: { id: draft.id }, data: { payload: newPayload } });
      draftsChanged += 1;
    }
  }

  // Movimentação física dos arquivos relocados (única, só na migração)
  let filesMoved = 0;
  for (const [from, to] of relocations) {
    if (from === to) continue;
    if (APPLY) {
      const fromAbs = path.join(root, ...from.split('/'));
      const toAbs = path.join(root, ...to.split('/'));
      try {
        await fsp.mkdir(path.dirname(toAbs), { recursive: true });
        await fsp.rename(fromAbs, toAbs);
        filesMoved += 1;
      } catch (err) {
        console.warn(`[centralize] falha ao mover ${from} -> ${to}: ${err.message}`);
      }
    } else {
      filesMoved += 1;
    }
  }

  // Reconstrói o índice ReportAttachment a partir do JSON já corrigido
  let indexSyncedReports = 0;
  if (APPLY) {
    for (const report of reports) {
      if (projectFilter && !(report.project?.code || '').includes(projectFilter)) continue;
      await syncReportUploadAttachments(prisma, report.id);
      indexSyncedReports += 1;
    }
  }

  // Órfãos: arquivos de IMAGEM no disco que ninguém referencia. Exclui documentos
  // gerados (.pdf/.docx) que são legítimos e não são fotos.
  const DOC_EXT = /\.(pdf|docx)$/i;
  const orphans = [];
  const orphansByProject = new Map(); // projeto -> { organized: [], loose: [] }
  let organizedPhotoOrphans = 0;
  let looseOrphans = 0;
  for (const relPath of index.set) {
    if (relocations.has(relPath)) continue; // foi movido
    if (referenced.has(relPath)) continue;
    if (!isUnderProjectFolder(relPath)) continue;
    if (DOC_EXT.test(relPath)) continue; // ignora PDFs/DOCX gerados
    orphans.push(relPath);
    const proj = relPath.split('/')[0];
    const group = orphansByProject.get(proj) || { organized: [], loose: [] };
    if (relPath.includes('/Registros Fotográficos/')) {
      organizedPhotoOrphans += 1;
      group.organized.push(relPath);
    } else {
      looseOrphans += 1;
      group.loose.push(relPath);
    }
    orphansByProject.set(proj, group);
  }

  // Diagnóstico de recuperação: cruza refs irrecuperáveis x órfãos por projeto.
  // Se um projeto tem refs faltando E órfãos organizados, há chance de recuperar.
  const unrecoverableByProject = new Map();
  for (const ref of stats.unrecoverable) {
    const proj = ref.path.split('/')[0];
    unrecoverableByProject.set(proj, (unrecoverableByProject.get(proj) || 0) + 1);
  }
  const recoveryDiag = [];
  for (const [proj, missing] of unrecoverableByProject) {
    const og = orphansByProject.get(proj) || { organized: [], loose: [] };
    recoveryDiag.push({
      project: proj,
      missingRefs: missing,
      organizedOrphans: og.organized.length,
      looseOrphans: og.loose.length
    });
  }
  recoveryDiag.sort((a, b) => b.missingRefs - a.missingRefs);

  console.log('\n========== RESUMO ==========');
  console.log(JSON.stringify({
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    refs: {
      ok: stats.ok,
      canonicalized: stats.canonicalized,
      recovered: stats.recovered,
      relocated: stats.relocated,
      unrecoverable: stats.unrecoverable.length
    },
    json: { reportsChanged, servicesChanged, draftsChanged },
    filesMoved,
    indexSyncedReports: APPLY ? indexSyncedReports : '(apenas com --apply)',
    orphanPhotos: { total: orphans.length, organized: organizedPhotoOrphans, loose: looseOrphans }
  }, null, 2));

  console.log('\n--- DIAGNÓSTICO DE RECUPERAÇÃO (por projeto) ---');
  console.log('projeto | refsFaltando | órfãosOrganizados | órfãosSoltos');
  for (const d of recoveryDiag) {
    console.log(`  ${d.project} | ${d.missingRefs} | ${d.organizedOrphans} | ${d.looseOrphans}`);
  }

  // Lista os órfãos ORGANIZADOS dos projetos que têm refs faltando: são os
  // candidatos a religação MANUAL (foto provavelmente certa, sob nome renomeado).
  const projectsWithMissing = new Set([...unrecoverableByProject.keys()]);
  const relinkCandidates = [...orphansByProject.entries()]
    .filter(([proj, g]) => projectsWithMissing.has(proj) && g.organized.length)
    .sort((a, b) => b[1].organized.length - a[1].organized.length);
  if (relinkCandidates.length) {
    console.log('\n--- CANDIDATOS A RELIGAÇÃO MANUAL (órfãos organizados, possível foto renomeada) ---');
    for (const [proj, g] of relinkCandidates) {
      console.log(`  ${proj}: ${g.organized.length} órfão(s) organizado(s)`);
      for (const relPath of g.organized) console.log(`      ${relPath}`);
    }
  }

  if (stats.unrecoverable.length) {
    // Agrupa por relatório (deduplicando o mesmo arquivo citado em vários lugares),
    // gerando uma lista acionável do que precisa ser reenviado manualmente.
    const byReport = new Map();
    for (const { path: refPath, report } of stats.unrecoverable) {
      const set = byReport.get(report) || new Set();
      set.add(refPath);
      byReport.set(report, set);
    }
    const distinct = new Set(stats.unrecoverable.map(u => `${u.report}\n${u.path}`)).size;
    console.log(`\n--- FALTANTES POR RELATÓRIO (arquivo não está no disco) — ${distinct} arquivo(s) distinto(s) em ${byReport.size} relatório(s) ---`);
    for (const [report, set] of [...byReport.entries()].sort((a, b) => b[1].size - a[1].size)) {
      console.log(`  ${report}: ${set.size} foto(s)`);
      for (const refPath of set) console.log(`      ${refPath}`);
    }

    if (csvPath) {
      const esc = v => `"${String(v).replace(/"/g, '""')}"`;
      const lines = ['Relatorio,Projeto,Arquivo,CandidatosReligacaoNoProjeto'];
      for (const [report, set] of [...byReport.entries()].sort((a, b) => b[1].size - a[1].size)) {
        const projeto = report.includes('(') ? report.slice(report.lastIndexOf('(') + 1, -1) : '';
        for (const refPath of set) {
          const projFolder = refPath.split('/')[0];
          const candidatos = (orphansByProject.get(projFolder) || { organized: [] }).organized.length;
          lines.push([esc(report), esc(projeto), esc(refPath), candidatos].join(','));
        }
      }
      // BOM para o Excel abrir acentos corretamente.
      await fsp.writeFile(csvPath, '﻿' + lines.join('\r\n') + '\r\n');
      console.log(`\n[centralize] CSV de faltantes gravado em: ${csvPath} (${distinct} linha(s))`);
    }
  } else if (csvPath) {
    await fsp.writeFile(csvPath, '﻿Relatorio,Projeto,Arquivo,CandidatosReligacaoNoProjeto\r\n');
    console.log(`\n[centralize] Nenhum faltante — CSV vazio gravado em: ${csvPath}`);
  }
  if (!APPLY) {
    console.log('\n[centralize] DRY-RUN: nada foi gravado. Rode com --apply (após backup do banco) para aplicar.');
  }
}

main()
  .catch(err => {
    console.error('[centralize] erro:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
