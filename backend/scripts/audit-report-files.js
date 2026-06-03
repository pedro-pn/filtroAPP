import fs from 'node:fs';
import path from 'node:path';

import env from '../src/config/env.js';
import prisma from '../src/lib/prisma.js';

function argValue(name, fallback = '') {
  const arg = process.argv.find(item => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1).trim() : fallback;
}

function text(value) {
  return String(value ?? '').trim();
}

function reportLabel(report) {
  if (!report) return 'sem relatorio';
  return `${report.reportType || 'REL'} ${report.sequenceNumber ?? report.id}`;
}

function projectLabel(project) {
  if (!project) return 'sem projeto';
  return `${project.code || '---'} - ${project.name || 'Sem nome'}`;
}

const projectFilter = argValue('--project').toLowerCase();
const limit = Math.max(1, Number(argValue('--limit', '20')) || 20);
const failOnMissing = process.argv.includes('--fail-on-missing');

async function main() {
  const rows = await prisma.reportAttachment.findMany({
    select: {
      id: true,
      storagePath: true,
      report: {
        select: {
          id: true,
          reportType: true,
          sequenceNumber: true,
          project: { select: { code: true, name: true } }
        }
      },
      reportService: {
        select: {
          report: {
            select: {
              id: true,
              reportType: true,
              sequenceNumber: true,
              project: { select: { code: true, name: true } }
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  let present = 0;
  let missing = 0;
  const byProject = new Map();

  for (const row of rows) {
    const report = row.report || row.reportService?.report || null;
    const project = report?.project || null;
    const projectName = projectLabel(project);
    if (projectFilter && !projectName.toLowerCase().includes(projectFilter)) continue;

    const targetPath = path.resolve(env.reportsDir, text(row.storagePath));
    const exists = fs.existsSync(targetPath);
    if (exists) {
      present += 1;
      continue;
    }

    missing += 1;
    const firstFolder = text(row.storagePath).split('/').filter(Boolean)[0] || '';
    const folderExists = firstFolder ? fs.existsSync(path.resolve(env.reportsDir, firstFolder)) : false;
    const group = byProject.get(projectName) || {
      project: projectName,
      missing: 0,
      missingFolders: new Set(),
      existingFolders: new Set(),
      samples: []
    };

    group.missing += 1;
    if (folderExists) group.existingFolders.add(firstFolder);
    else group.missingFolders.add(firstFolder || '(sem pasta)');
    if (group.samples.length < limit) {
      group.samples.push({
        report: reportLabel(report),
        storagePath: row.storagePath,
        folderExists
      });
    }
    byProject.set(projectName, group);
  }

  const projects = Array.from(byProject.values())
    .map(item => ({
      ...item,
      missingFolders: Array.from(item.missingFolders),
      existingFolders: Array.from(item.existingFolders)
    }))
    .sort((a, b) => b.missing - a.missing);

  console.log(JSON.stringify({
    reportsDir: env.reportsDir,
    projectFilter: projectFilter || null,
    totalChecked: present + missing,
    present,
    missing,
    projects
  }, null, 2));

  if (failOnMissing && missing > 0) {
    process.exitCode = 2;
  }
}

main()
  .catch(error => {
    console.error('[audit-report-files] erro', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
