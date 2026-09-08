import { ReportType } from '@prisma/client';
import { z } from 'zod';

import { calculateReportOvertime } from '../overtime.js';
import { loadCorporateCalendar } from '../calendar/corporate-calendar.js';
import { reportCollaboratorCreateManyData } from '../report-collaborators.js';

export const MANUAL_REPORT_UPLOAD_KEY = '__manualUpload';

function uniqueIds(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const manualReportTimeSchema = z.preprocess(
  value => (value == null ? undefined : String(value).trim() || undefined),
  z.string()
    .regex(/^\d{1,2}:\d{2}$/, 'Informe o horário no formato HH:MM.')
    .refine(value => {
      const [hours, minutes] = value.split(':').map(Number);
      return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
    }, 'Informe um horário válido.')
    .optional()
);

function isManualReportBreakValue(value) {
  if (value == null || value === '') return true;
  const text = String(value).trim().toLowerCase();
  if (text === 'sem intervalo') return true;
  return /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.test(text)
    || /^(\d{1,2})h(\d{1,2})$/.test(text)
    || /^(\d{1,2})\s*h(?:ora|oras)?$/.test(text)
    || /^(\d{1,3})\s*min$/.test(text);
}

const manualReportBreakSchema = z.preprocess(
  value => (value == null ? undefined : String(value).trim() || undefined),
  z.string()
    .refine(isManualReportBreakValue, 'Informe um intervalo válido.')
    .optional()
);

const manualReportCollaboratorIdsSchema = z.preprocess(value => {
  if (!Array.isArray(value)) return [];
  return uniqueIds(value.map(item => String(item || '').trim()).filter(Boolean));
}, z.array(z.string())).default([]);

const manualReportStandbySchema = z.object({
  enabled: z.boolean().optional().default(false),
  total: manualReportBreakSchema,
  motivo: z.preprocess(
    value => (value == null ? undefined : String(value).trim() || undefined),
    z.string().max(1000, 'Informe um motivo menor.').optional()
  )
}).optional();

function manualReportOperationalDataHasValues(data) {
  if (!data) return false;
  const night = plainObject(data.noturno);
  const nightEnabled = night.enabled === true;
  const standbyTouched = data.standby != null;
  return Boolean(
    data.arrivalTime ||
    data.departureTime ||
    data.reportDate ||
    (Array.isArray(data.collaboratorIds) && data.collaboratorIds.length) ||
    nightEnabled ||
    standbyTouched
  );
}

export const manualReportOperationalDataSchema = z.object({
  reportDate: z.preprocess(
    value => (value == null ? undefined : String(value).trim() || undefined),
    z.string().min(1, 'Informe a data do relatório.').optional()
  ),
  arrivalTime: manualReportTimeSchema,
  departureTime: manualReportTimeSchema,
  lunchBreak: manualReportBreakSchema,
  collaboratorIds: manualReportCollaboratorIdsSchema,
  noturno: z.object({
    enabled: z.boolean().optional().default(false),
    inicio: manualReportTimeSchema,
    termino: manualReportTimeSchema,
    intervalo: manualReportBreakSchema,
    collaboratorIds: manualReportCollaboratorIdsSchema
  }).optional(),
  standby: manualReportStandbySchema
}).superRefine((data, ctx) => {
  if (data.arrivalTime && !data.departureTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['departureTime'],
      message: 'Informe entrada e saída juntas.'
    });
  }
  if (data.departureTime && !data.arrivalTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['arrivalTime'],
      message: 'Informe entrada e saída juntas.'
    });
  }

  if (data.noturno?.enabled === true && (!data.noturno.inicio || !data.noturno.termino)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['noturno'],
      message: 'Informe início e término do turno noturno.'
    });
  }
  if (data.standby?.enabled === true && !data.standby.total) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['standby', 'total'],
      message: 'Informe tempo total e motivo do stand-by.'
    });
  }
  if (data.standby?.enabled === true && !String(data.standby.motivo || '').trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['standby', 'motivo'],
      message: 'Informe tempo total e motivo do stand-by.'
    });
  }
}).transform(data => {
  if (!manualReportOperationalDataHasValues(data)) return undefined;
  const standby = data.standby
    ? data.standby.enabled === true
      ? {
          enabled: true,
          total: data.standby.total,
          motivo: String(data.standby.motivo || '').trim()
        }
      : { enabled: false }
    : undefined;
  return {
    reportDate: data.reportDate,
    arrivalTime: data.arrivalTime,
    departureTime: data.departureTime,
    lunchBreak: data.lunchBreak,
    collaboratorIds: uniqueIds(data.collaboratorIds),
    noturno: data.noturno?.enabled === true
      ? {
          enabled: true,
          inicio: data.noturno.inicio,
          termino: data.noturno.termino,
          intervalo: data.noturno.intervalo,
          collaboratorIds: uniqueIds(data.noturno.collaboratorIds)
        }
      : undefined,
    standby
  };
});

function nightCollaboratorInput(value) {
  if (typeof value === 'string') return { name: value.trim(), role: '' };
  const record = plainObject(value);
  return {
    id: textValue(record.id),
    name: textValue(record.name),
    role: textValue(record.role)
  };
}

export async function enrichNightCollaboratorsInSpecialConditions(tx, specialConditions) {
  const next = cloneJson(plainObject(specialConditions));
  const noturnoDetails = plainObject(next.noturnoDetails);
  const collaboratorIds = Array.isArray(noturnoDetails.collaboratorIds)
    ? uniqueIds(noturnoDetails.collaboratorIds.filter(id => typeof id === 'string'))
    : [];
  if (!collaboratorIds.length) return next;

  const collaborators = await tx.collaborator.findMany({
    where: { id: { in: collaboratorIds } },
    select: { id: true, name: true, jobRole: { select: { name: true } } }
  });
  const byId = new Map(collaborators.map(collaborator => [collaborator.id, collaborator]));
  const existing = Array.isArray(noturnoDetails.colaboradores)
    ? noturnoDetails.colaboradores.map(nightCollaboratorInput)
    : [];

  next.noturnoDetails = {
    ...noturnoDetails,
    collaboratorIds,
    colaboradores: collaboratorIds.map((id, index) => {
      const current = existing[index] || {};
      const collaborator = byId.get(id);
      return {
        id,
        name: current.name || collaborator?.name || id,
        role: current.role || collaborator?.jobRole?.name || ''
      };
    })
  };
  return next;
}

const manualReportOperationalDefaults = {
  arrivalTime: '00:00',
  departureTime: '00:00',
  lunchBreak: '00:00:00',
  daytimeCount: 0,
  daytimeWorkedMinutes: 0,
  nighttimeWorkedMinutes: 0,
  daytimeOvertimeMinutes: 0,
  nighttimeOvertimeMinutes: 0,
  totalOvertimeMinutes: 0
};

async function assertManualReportCollaboratorsExist(tx, collaboratorIds) {
  const ids = uniqueIds(collaboratorIds);
  if (!ids.length) return;

  const existing = await tx.collaborator.findMany({
    where: { id: { in: ids } },
    select: { id: true }
  });
  if (existing.length === ids.length) return;

  const existingIds = new Set(existing.map(item => item.id));
  const missing = ids.filter(id => !existingIds.has(id));
  const error = new Error(`Colaborador não encontrado: ${missing.join(', ')}.`);
  error.statusCode = 400;
  throw error;
}

export async function buildManualReportOperationalFields(tx, project, reportDate, operationalData, reportType = ReportType.RDO) {
  if (!operationalData) {
    return {
      data: { ...manualReportOperationalDefaults },
      collaboratorIds: [],
      specialConditions: {}
    };
  }

  const collaboratorIds = uniqueIds(operationalData.collaboratorIds);
  const night = operationalData.noturno?.enabled === true ? operationalData.noturno : null;
  const nightCollaboratorIds = night ? uniqueIds(night.collaboratorIds) : [];
  const standby = operationalData.standby || null;
  if (standby?.enabled === true && reportType !== ReportType.RDO) {
    const error = new Error('Stand-by está disponível apenas para RDO manual.');
    error.statusCode = 400;
    throw error;
  }
  await assertManualReportCollaboratorsExist(tx, [...collaboratorIds, ...nightCollaboratorIds]);

  const specialConditionsSeed = {
    ...(night
      ? {
          noturno: true,
          noturnoDetails: {
            enabled: true,
            inicio: night.inicio,
            termino: night.termino,
            intervalo: night.intervalo || '01:00:00',
            collaboratorIds: nightCollaboratorIds
          }
        }
      : {}),
    ...(standby
      ? standby.enabled === true
        ? {
            standby: true,
            standbyDetails: {
              total: standby.total,
              motivo: standby.motivo
            }
          }
        : { standby: false }
      : {})
  };
  const specialConditions = await enrichNightCollaboratorsInSpecialConditions(tx, specialConditionsSeed);
  const payload = {
    reportDate,
    arrivalTime: operationalData.arrivalTime || manualReportOperationalDefaults.arrivalTime,
    departureTime: operationalData.departureTime || manualReportOperationalDefaults.departureTime,
    lunchBreak: operationalData.lunchBreak || (operationalData.arrivalTime && operationalData.departureTime ? '01:00:00' : manualReportOperationalDefaults.lunchBreak),
    specialConditions
  };
  const corporateCalendar = await loadCorporateCalendar(tx, reportDate, reportDate);
  const overtime = calculateReportOvertime(project, payload, corporateCalendar);

  return {
    data: {
      arrivalTime: payload.arrivalTime,
      departureTime: payload.departureTime,
      lunchBreak: payload.lunchBreak,
      daytimeCount: collaboratorIds.length,
      daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
      nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
      daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
      nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
      totalOvertimeMinutes: overtime.totalOvertimeMinutes
    },
    collaboratorIds,
    specialConditions: {
      ...specialConditions,
      overtimeSummary: overtime
    }
  };
}

export function manualReportOperationalSpecialConditions(existingSpecialConditions, operationalSpecialConditions, userId, now = new Date()) {
  const next = cloneJson(plainObject(existingSpecialConditions)) || {};
  const incoming = cloneJson(plainObject(operationalSpecialConditions));
  const hasStandbyUpdate = Object.prototype.hasOwnProperty.call(incoming, 'standby')
    || Object.prototype.hasOwnProperty.call(incoming, 'standbyDetails');
  delete next.noturno;
  delete next.noturnoDetails;
  delete next.overtimeSummary;
  if (hasStandbyUpdate) {
    delete next.standby;
    delete next.standbyDetails;
  }
  if (incoming.standby === false) {
    delete incoming.standby;
    delete incoming.standbyDetails;
  }
  Object.assign(next, incoming);
  next[MANUAL_REPORT_UPLOAD_KEY] = {
    ...plainObject(existingSpecialConditions?.[MANUAL_REPORT_UPLOAD_KEY]),
    operationalDataUpdatedAt: now.toISOString(),
    operationalDataUpdatedByUserId: userId || null
  };
  return next;
}

export async function updateManualReportOperationalData({
  prisma,
  reportId,
  body,
  userId,
  include,
  isReportUnavailable,
  isManualUploaded,
  assertUniqueReportDate
}) {
  const data = manualReportOperationalDataSchema.parse(body || {});
  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: reportId },
    include
  });
  if (isReportUnavailable(existing)) {
    return { status: 404, body: { error: 'Relatório não encontrado.' } };
  }
  if (!isManualUploaded(existing)) {
    return {
      status: 400,
      body: { error: 'Apenas relatórios enviados manualmente podem ter os dados operacionais editados por este fluxo.' }
    };
  }

  const item = await prisma.$transaction(async tx => {
    const nextReportDate = data?.reportDate ? new Date(data.reportDate) : existing.reportDate;
    if (Number.isNaN(nextReportDate.getTime())) {
      const error = new Error('Data do relatório inválida.');
      error.statusCode = 400;
      throw error;
    }
    if (data?.reportDate) {
      await assertUniqueReportDate(tx, {
        projectId: existing.projectId,
        reportType: existing.reportType,
        reportDate: nextReportDate,
        excludeReportId: existing.id
      });
    }
    const operationalFields = await buildManualReportOperationalFields(tx, existing.project, nextReportDate, data, existing.reportType);
    const reportCollaborators = await reportCollaboratorCreateManyData(tx, operationalFields.collaboratorIds);
    await tx.reportCollaborator.deleteMany({ where: { reportId: existing.id } });
    return tx.report.update({
      where: { id: existing.id },
      data: {
        reportDate: nextReportDate,
        ...operationalFields.data,
        specialConditions: manualReportOperationalSpecialConditions(
          existing.specialConditions,
          operationalFields.specialConditions,
          userId
        ),
        ...(operationalFields.collaboratorIds.length
          ? {
              collaborators: {
                create: reportCollaborators
              }
            }
          : {})
      },
      include
    });
  });

  return { item };
}
