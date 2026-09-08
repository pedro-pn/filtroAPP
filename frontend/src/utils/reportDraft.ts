import type { ReportDraft } from '../types/domain';

export const SITE_RDO_DRAFT_FORM_PATH = '/relatorio/novo?tipo=obra';

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asDdsThemes(
  value: unknown
): { id: string; name: string; custom?: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object'
    )
    .map((item) => ({
      id: asString(item.id),
      name: asString(item.name),
      ...(item.custom === true ? { custom: true } : {})
    }))
    .filter((item) => item.id && item.name);
}

function asServices(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object'
    )
    .map((item, index) => ({
      id: asString(item.id, `svc-draft-${index + 1}`),
      type: asString(item.type, 'LIMPEZA'),
      data:
        item.data && typeof item.data === 'object' && !Array.isArray(item.data)
          ? (item.data as Record<string, unknown>)
          : {}
    }));
}

export function reportDraftToRdoState(draft: ReportDraft) {
  const payload = draft.payload || {};
  return {
    draftId: draft.id,
    serviceOnly: asBoolean(payload.serviceOnly),
    projectId: asString(payload.projectId, draft.projectId || '') || null,
    reportDate: asString(payload.reportDate, draft.reportDate || ''),
    arrivalTime: asString(payload.arrivalTime),
    departureTime: asString(payload.departureTime),
    lunchBreak: asString(payload.lunchBreak, '01:00:00'),
    collaboratorIds: asStringArray(payload.collaboratorIds),
    nightCollaboratorIds: asStringArray(payload.nightCollaboratorIds),
    standby: asBoolean(payload.standby),
    standbyDuration: asString(payload.standbyDuration),
    standbyMotivo: asString(payload.standbyMotivo),
    noturno: asBoolean(payload.noturno),
    noturnoStart: asString(payload.noturnoStart),
    noturnoEnd: asString(payload.noturnoEnd),
    noturnoInterval: asString(payload.noturnoInterval, '01:00:00'),
    ddsDay: asBoolean(payload.ddsDay),
    ddsDayStart: asString(payload.ddsDayStart),
    ddsDayEnd: asString(payload.ddsDayEnd),
    ddsDayThemes: asDdsThemes(payload.ddsDayThemes),
    ddsNight: asBoolean(payload.ddsNight),
    ddsNightStart: asString(payload.ddsNightStart),
    ddsNightEnd: asString(payload.ddsNightEnd),
    ddsNightThemes: asDdsThemes(payload.ddsNightThemes),
    overtimeReason: asString(payload.overtimeReason),
    dailyDescription: asString(payload.dailyDescription),
    generalUploads: Array.isArray(payload.generalUploads)
      ? payload.generalUploads
      : [],
    services: asServices(payload.services)
  };
}

export function reportDraftDateLabel(
  draft: ReportDraft,
  fallback = 'Sem data'
) {
  return draft.reportDate || asString(draft.payload?.reportDate) || fallback;
}

export function reportDraftServiceCount(draft: ReportDraft) {
  return Array.isArray(draft.payload?.services)
    ? draft.payload.services.length
    : 0;
}
