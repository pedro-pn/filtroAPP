import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import prisma from './prisma.js';
import { formatCnpj } from './cnpj.js';
import { buildMonthlyAllocationReportEmailTemplate } from './email-templates.js';
import { getMissingMailerConfig, sendMail } from './mailer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logoColorPath = path.resolve(__dirname, '../../assets/Logo/LOGO_COLORIDO.png');
const JOB_INTERVAL_MS = 60 * 60 * 1000;
const ALLOCATION_STATUSES = ['APPROVED', 'SIGNED'];

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeName(value) {
  return stringValue(value).replace(/\s+/g, ' ').toLowerCase();
}

function monthStart(yearMonth) {
  const match = String(yearMonth || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = new Date(Date.UTC(year, month - 1, 1));
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1) return null;
  return start;
}

function nextMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function toDateKey(value) {
  const date = new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function formatDatePt(value) {
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function monthLabel(yearMonth) {
  const start = monthStart(yearMonth);
  if (!start) return yearMonth;
  return start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function previousYearMonth(now = new Date()) {
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
}

function collaboratorSnapshot(value) {
  if (typeof value === 'string') return { id: '', name: value.trim(), role: '' };
  const record = asRecord(value);
  return {
    id: stringValue(record.id),
    name: stringValue(record.name),
    role: stringValue(record.role)
  };
}

function allocationKey({ date, collaboratorId, collaboratorName, projectId, shift }) {
  return [
    date,
    collaboratorId ? `id:${collaboratorId}` : `name:${normalizeName(collaboratorName)}`,
    projectId,
    shift
  ].join('|');
}

function reportAllocationEntries(report) {
  const entries = [];
  const date = toDateKey(report.reportDate);
  const project = report.project || {};
  const projectName = [project.code, project.name].filter(Boolean).join(' - ');
  const projectCnpj = formatCnpj(project.clientCnpj);
  const collaboratorById = new Map();

  for (const link of report.collaborators || []) {
    const collaborator = link.collaborator || {};
    const entry = {
      date,
      collaboratorId: stringValue(link.collaboratorId || collaborator.id),
      collaboratorName: stringValue(collaborator.name),
      collaboratorRole: stringValue(collaborator.role),
      shift: 'Diurno',
      projectId: report.projectId,
      projectCode: project.code || '',
      projectName,
      clientCnpj: projectCnpj,
      reportId: report.id,
      sequenceNumber: report.sequenceNumber
    };
    if (entry.collaboratorId) collaboratorById.set(entry.collaboratorId, entry);
    if (entry.collaboratorName) entries.push(entry);
  }

  const nightDetails = asRecord(asRecord(report.specialConditions).noturnoDetails);
  const nightIds = Array.isArray(nightDetails.collaboratorIds)
    ? nightDetails.collaboratorIds.filter(id => typeof id === 'string' && id.trim())
    : [];
  const nightSnapshots = Array.isArray(nightDetails.colaboradores)
    ? nightDetails.colaboradores.map(collaboratorSnapshot)
    : [];
  const usedSnapshotIndexes = new Set();

  nightIds.forEach((id, index) => {
    const snapshot = nightSnapshots[index] || {};
    const linked = collaboratorById.get(id) || {};
    usedSnapshotIndexes.add(index);
    const name = snapshot.name || linked.collaboratorName || id;
    if (!name) return;
    entries.push({
      date,
      collaboratorId: id,
      collaboratorName: name,
      collaboratorRole: snapshot.role || linked.collaboratorRole || '',
      shift: 'Noturno',
      projectId: report.projectId,
      projectCode: project.code || '',
      projectName,
      clientCnpj: projectCnpj,
      reportId: report.id,
      sequenceNumber: report.sequenceNumber
    });
  });

  nightSnapshots.forEach((snapshot, index) => {
    if (usedSnapshotIndexes.has(index) || !snapshot.name) return;
    entries.push({
      date,
      collaboratorId: snapshot.id || '',
      collaboratorName: snapshot.name,
      collaboratorRole: snapshot.role || '',
      shift: 'Noturno',
      projectId: report.projectId,
      projectCode: project.code || '',
      projectName,
      clientCnpj: projectCnpj,
      reportId: report.id,
      sequenceNumber: report.sequenceNumber
    });
  });

  return entries;
}

export function validateYearMonth(yearMonth) {
  return Boolean(monthStart(yearMonth));
}

export async function buildMonthlyAllocationSummary({ yearMonth, client = prisma }) {
  const fromDate = monthStart(yearMonth);
  if (!fromDate) {
    const error = new Error('Mês inválido. Use o formato YYYY-MM.');
    error.statusCode = 400;
    throw error;
  }
  const toDate = nextMonth(fromDate);

  const reports = await client.report.findMany({
    where: {
      deletedAt: null,
      reportType: 'RDO',
      status: { in: ALLOCATION_STATUSES },
      reportDate: { gte: fromDate, lt: toDate },
      project: { managerOnly: false, deletedAt: null }
    },
    select: {
      id: true,
      projectId: true,
      reportDate: true,
      sequenceNumber: true,
      specialConditions: true,
      project: { select: { id: true, code: true, name: true, clientCnpj: true } },
      collaborators: {
        select: {
          collaboratorId: true,
          collaborator: { select: { id: true, name: true, role: true } }
        }
      }
    },
    orderBy: [{ reportDate: 'asc' }, { sequenceNumber: 'asc' }]
  });

  const entriesByKey = new Map();
  for (const report of reports) {
    for (const entry of reportAllocationEntries(report)) {
      const key = allocationKey(entry);
      if (!entriesByKey.has(key)) entriesByKey.set(key, entry);
    }
  }

  const entries = Array.from(entriesByKey.values()).sort((a, b) => (
    a.collaboratorName.localeCompare(b.collaboratorName, 'pt-BR') ||
    a.date.localeCompare(b.date) ||
    a.projectName.localeCompare(b.projectName, 'pt-BR') ||
    a.shift.localeCompare(b.shift, 'pt-BR')
  ));

  const collaboratorMap = new Map();
  for (const entry of entries) {
    const key = entry.collaboratorId || normalizeName(entry.collaboratorName);
    if (!collaboratorMap.has(key)) {
      collaboratorMap.set(key, {
        collaboratorId: entry.collaboratorId,
        collaboratorName: entry.collaboratorName,
        collaboratorRole: entry.collaboratorRole,
        days: []
      });
    }
    collaboratorMap.get(key).days.push({
      date: entry.date,
      shift: entry.shift,
      projectId: entry.projectId,
      projectCode: entry.projectCode,
      projectName: entry.projectName,
      clientCnpj: entry.clientCnpj,
      reportId: entry.reportId,
      sequenceNumber: entry.sequenceNumber
    });
  }

  const collaborators = Array.from(collaboratorMap.values()).sort((a, b) => (
    a.collaboratorName.localeCompare(b.collaboratorName, 'pt-BR')
  ));

  const uniqueDays = new Set(entries.map(entry => entry.date));
  const uniqueProjects = new Set(entries.map(entry => entry.projectId));

  return {
    yearMonth,
    label: monthLabel(yearMonth),
    generatedAt: new Date(),
    summary: {
      reportCount: reports.length,
      collaboratorCount: collaborators.length,
      allocationCount: entries.length,
      dayCount: uniqueDays.size,
      projectCount: uniqueProjects.size
    },
    entries,
    collaborators
  };
}

function truncateText(text, maxLength) {
  const value = String(text || '');
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function drawText(page, text, x, y, options) {
  page.drawText(String(text ?? ''), { x, y, ...options });
}

function drawAllocationTableHeader(page, fonts, y) {
  page.drawRectangle({ x: 36, y: y - 8, width: 770, height: 20, color: rgb(0.93, 0.96, 0.94) });
  const opts = { size: 8, font: fonts.bold, color: rgb(0.2, 0.31, 0.23) };
  drawText(page, 'Data', 42, y, opts);
  drawText(page, 'Turno', 92, y, opts);
  drawText(page, 'Projeto', 160, y, opts);
  drawText(page, 'CNPJ', 660, y, opts);
}

async function embedLogo(pdf) {
  try {
    const bytes = await fs.readFile(logoColorPath);
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

export async function buildMonthlyAllocationPdf(data) {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };
  const logo = await embedLogo(pdf);
  const pageSize = [841.89, 595.28];
  const margin = 36;
  const bottom = 34;
  let pageNumber = 0;
  let page;
  let y;

  function addPage() {
    page = pdf.addPage(pageSize);
    pageNumber += 1;
    y = 548;
    if (logo) {
      const maxLogoWidth = 82;
      const logoHeight = (logo.height / logo.width) * maxLogoWidth;
      page.drawImage(logo, { x: margin, y: 536, width: maxLogoWidth, height: logoHeight });
    }
    drawText(page, 'Relatório mensal de alocação de colaboradores', 132, 552, {
      size: 15,
      font: fonts.bold,
      color: rgb(0.14, 0.24, 0.17)
    });
    drawText(page, `Mês: ${data.label}`, 132, 532, {
      size: 10,
      font: fonts.regular,
      color: rgb(0.31, 0.36, 0.33)
    });
    drawText(page, `Gerado em ${new Date(data.generatedAt).toLocaleString('pt-BR')}`, 660, 532, {
      size: 8,
      font: fonts.regular,
      color: rgb(0.42, 0.45, 0.43)
    });
    page.drawLine({ start: { x: margin, y: 522 }, end: { x: 806, y: 522 }, thickness: 0.8, color: rgb(0.84, 0.88, 0.85) });
    y = 500;
  }

  function ensureSpace(requiredHeight) {
    if (y < bottom + requiredHeight) addPage();
  }

  function drawCollaboratorHeader(collaborator) {
    ensureSpace(48);
    page.drawRectangle({ x: margin, y: y - 18, width: 770, height: 26, color: rgb(0.97, 0.98, 0.97), borderColor: rgb(0.84, 0.88, 0.85), borderWidth: 0.6 });
    drawText(page, truncateText(collaborator.collaboratorName, 72), 44, y - 2, {
      size: 10,
      font: fonts.bold,
      color: rgb(0.14, 0.24, 0.17)
    });
    drawText(page, collaborator.collaboratorRole || '-', 520, y - 2, {
      size: 8,
      font: fonts.regular,
      color: rgb(0.42, 0.45, 0.43)
    });
    drawText(page, `${collaborator.days.length} alocação(ões)`, 704, y - 2, {
      size: 8,
      font: fonts.regular,
      color: rgb(0.42, 0.45, 0.43)
    });
    y -= 32;
    drawAllocationTableHeader(page, fonts, y);
    y -= 22;
  }

  addPage();

  const summaryItems = [
    ['RDOs', data.summary.reportCount],
    ['Colaboradores', data.summary.collaboratorCount],
    ['Alocações', data.summary.allocationCount],
    ['Dias com alocação', data.summary.dayCount],
    ['Projetos', data.summary.projectCount]
  ];
  summaryItems.forEach(([label, value], index) => {
    const x = margin + index * 150;
    page.drawRectangle({ x, y: 470, width: 136, height: 40, color: rgb(0.97, 0.98, 0.97), borderColor: rgb(0.84, 0.88, 0.85), borderWidth: 0.8 });
    drawText(page, String(value), x + 10, 492, { size: 14, font: fonts.bold, color: rgb(0.19, 0.31, 0.23) });
    drawText(page, label, x + 10, 478, { size: 8, font: fonts.regular, color: rgb(0.42, 0.45, 0.43) });
  });
  y = 440;

  if (data.collaborators.length === 0) {
    drawText(page, 'Nenhuma alocação encontrada para o mês.', margin, y, {
      size: 10,
      font: fonts.regular,
      color: rgb(0.42, 0.45, 0.43)
    });
  }

  for (const collaborator of data.collaborators) {
    drawCollaboratorHeader(collaborator);
    for (const day of collaborator.days) {
      if (y < bottom + 18) {
        addPage();
        drawCollaboratorHeader(collaborator);
      }
      page.drawLine({ start: { x: margin, y: y - 5 }, end: { x: 806, y: y - 5 }, thickness: 0.3, color: rgb(0.88, 0.9, 0.89) });
      drawText(page, formatDatePt(day.date), 42, y, { size: 8, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
      drawText(page, day.shift, 92, y, { size: 8, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
      drawText(page, truncateText(day.projectName, 78), 160, y, { size: 8, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
      drawText(page, day.clientCnpj || '-', 660, y, { size: 8, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
      y -= 14;
    }
    y -= 10;
  }

  const pageCount = pdf.getPageCount();
  for (let i = 0; i < pageCount; i += 1) {
    const current = pdf.getPage(i);
    drawText(current, `Página ${i + 1} de ${pageCount}`, 738, 18, {
      size: 8,
      font: fonts.regular,
      color: rgb(0.42, 0.45, 0.43)
    });
  }

  return Buffer.from(await pdf.save());
}

export async function sendMonthlyAllocationReport({ yearMonth, mailer = sendMail, client = prisma } = {}) {
  const recipients = await client.allocationReportRecipient.findMany({
    where: { isActive: true },
    select: { email: true, name: true },
    orderBy: { email: 'asc' }
  });
  if (recipients.length === 0) return { skipped: true, reason: 'no_recipients', sent: 0 };

  const data = await buildMonthlyAllocationSummary({ yearMonth, client });
  const pdf = await buildMonthlyAllocationPdf(data);
  const template = buildMonthlyAllocationReportEmailTemplate({
    monthLabel: data.label,
    summary: data.summary
  });

  await Promise.all(recipients.map(recipient => mailer({
    to: recipient.email,
    ...template,
    attachments: [{
      filename: `alocacao-colaboradores-${yearMonth}.pdf`,
      content: pdf,
      contentType: 'application/pdf'
    }]
  })));

  return { skipped: false, sent: recipients.length, allocationCount: data.summary.allocationCount };
}

async function claimDelivery(yearMonth, client) {
  const existing = await client.allocationReportDelivery.findUnique({ where: { yearMonth } });
  if (!existing) {
    try {
      await client.allocationReportDelivery.create({
        data: { yearMonth, status: 'CLAIMED', recipientCount: 0 }
      });
      return true;
    } catch (error) {
      if (error?.code === 'P2002') return false;
      throw error;
    }
  }
  if (existing.status === 'ERROR') {
    const claimed = await client.allocationReportDelivery.updateMany({
      where: { yearMonth, status: 'ERROR' },
      data: { status: 'CLAIMED', error: null }
    });
    return claimed.count === 1;
  }
  return false;
}

export async function processMonthlyAllocationReport({ now = new Date(), client = prisma, mailer = sendMail, missingMailerConfig = getMissingMailerConfig() } = {}) {
  if (now.getDate() !== 1) return { skipped: true, reason: 'not_first_day' };
  if (missingMailerConfig.length) return { skipped: true, reason: 'missing_mailer_config', missingMailerConfig };

  const yearMonth = previousYearMonth(now);
  const claimed = await claimDelivery(yearMonth, client);
  if (!claimed) return { skipped: true, reason: 'already_processed', yearMonth };

  try {
    const result = await sendMonthlyAllocationReport({ yearMonth, client, mailer });
    if (result.skipped && result.reason === 'no_recipients') {
      await client.allocationReportDelivery.delete({ where: { yearMonth } }).catch(() => {});
      return { yearMonth, ...result };
    }
    await client.allocationReportDelivery.update({
      where: { yearMonth },
      data: {
        status: result.skipped ? 'SKIPPED' : 'SENT',
        recipientCount: result.sent || 0,
        error: result.skipped ? result.reason : null,
        sentAt: new Date()
      }
    });
    return { yearMonth, ...result };
  } catch (error) {
    await client.allocationReportDelivery.update({
      where: { yearMonth },
      data: {
        status: 'ERROR',
        error: String(error?.message || error).slice(0, 1000)
      }
    }).catch(() => {});
    throw error;
  }
}

export function startMonthlyAllocationReportJob() {
  const run = () => {
    processMonthlyAllocationReport().catch(error => {
      console.error('Falha no job de relatório mensal de alocação.', error);
    });
  };
  run();
  const timer = setInterval(run, JOB_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
