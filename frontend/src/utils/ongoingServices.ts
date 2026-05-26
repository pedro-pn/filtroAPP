import type { ReportSummary } from '../types/domain';
import { normalizeServiceType } from './reportServicePayload';

type ReportServiceSummary = NonNullable<ReportSummary['services']>[number];

export interface OngoingServiceItem {
  key: string;
  report: ReportSummary;
  service: ReportServiceSummary;
  projectTitle: string;
  projectCode: string;
  serviceType: string;
  equipment: string;
  system: string;
}

function serviceFinalized(service: ReportServiceSummary) {
  if (typeof service.finalized === 'boolean') return service.finalized;
  const stored = service.extraData?.['Serviço finalizado?'];
  if (typeof stored === 'string') return ['sim', 'true', 'finalizado'].includes(stored.trim().toLowerCase());
  return false;
}

function serviceEquipmentName(service: ReportServiceSummary) {
  const extra = service.extraData || {};
  const value = extra['Equipamento(s)'] || extra.Equipamentos || extra.Equipamento || extra['Embarcação'] || extra.Embarcacao || extra['ID da embarcação'] || '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.labels)) return record.labels.filter(Boolean).join(', ');
    return String(record.name || record.nome || record.code || record.codigo || record.id || '');
  }
  return String(value || service.equipmentId || '');
}

function serviceSemanticKey(report: ReportSummary, service: ReportServiceSummary) {
  const extra = service.extraData || {};
  return `${report.projectId || ''}||${service.serviceType || ''}||${serviceEquipmentName(service).trim().toLowerCase()}||${String(service.system || extra.Sistema || '').trim().toLowerCase()}`;
}

function serviceOngoingKeys(report: ReportSummary, service: ReportServiceSummary) {
  const extra = service.extraData || {};
  return Array.from(new Set([
    String(extra.__ongoingKey || '').trim(),
    String(extra.__serviceLinkKey || '').trim(),
    String(extra.__sourceServiceId || '').trim(),
    serviceSemanticKey(report, service)
  ].filter(Boolean)));
}

function reportTime(report: ReportSummary) {
  return new Date(report.reportDate || report.createdAt || 0).getTime() || 0;
}

function endOfDayTime(value: Date | string = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function collectOngoingServices(reports: ReportSummary[], cutoffDate: Date | string = new Date()) {
  const items = new Map<string, OngoingServiceItem>();
  const cutoffTime = endOfDayTime(cutoffDate);

  [...reports]
    .filter(report => report.reportType === 'RDO' && report.project?.isActive !== false && reportTime(report) <= cutoffTime)
    .sort((a, b) => reportTime(a) - reportTime(b) || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
    .forEach(report => {
      (report.services || []).forEach(service => {
        const keys = serviceOngoingKeys(report, service);
        if (serviceFinalized(service)) {
          for (const [itemKey, item] of items.entries()) {
            if (item.key === service.id || item.key === keys[0] || keys.includes(item.key)) items.delete(itemKey);
          }
          return;
        }

        const key = keys[0] || service.id;
        for (const [itemKey, item] of items.entries()) {
          if (keys.includes(item.key) || item.key === service.id) items.delete(itemKey);
        }
        items.set(key, {
          key,
          report,
          service,
          projectTitle: [report.project?.code, report.project?.name].filter(Boolean).join(' - ') || report.project?.name || report.projectId,
          projectCode: report.project?.code || '---',
          serviceType: normalizeServiceType(service.serviceType || ''),
          equipment: serviceEquipmentName(service) || 'Equipamento não informado',
          system: service.system || String((service.extraData || {}).Sistema || '')
        });
      });
    });

  return Array.from(items.values()).sort((a, b) =>
    a.projectTitle.localeCompare(b.projectTitle, 'pt-BR', { numeric: true, sensitivity: 'base' })
    || a.serviceType.localeCompare(b.serviceType, 'pt-BR', { numeric: true, sensitivity: 'base' })
  );
}
