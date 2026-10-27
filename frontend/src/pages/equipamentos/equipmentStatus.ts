import type { CompanyEquipment } from '../../api/equipamentos';
import { dateInputValue as civilDateInputValue, formatDateOnly, todayDateOnly } from '../../utils/dateOnly';

export type CalibrationStatus = 'none' | 'ok' | 'expiring' | 'expired';

const EXPIRING_WINDOW_DAYS = 30;

export function calibrationStatus(item: Pick<CompanyEquipment, 'hasCalibration' | 'expiresAt'>): CalibrationStatus {
  if (!item.hasCalibration || !item.expiresAt) return 'none';
  const expires = new Date(civilDateInputValue(item.expiresAt));
  if (Number.isNaN(expires.getTime())) return 'none';
  const today = new Date(todayDateOnly());
  const diffDays = Math.round((expires.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired';
  if (diffDays <= EXPIRING_WINDOW_DAYS) return 'expiring';
  return 'ok';
}

export const statusLabel: Record<CalibrationStatus, string> = {
  none: '—',
  ok: 'Calibrado',
  expiring: 'A vencer',
  expired: 'Calibração expirada'
};

export const statusTone: Record<CalibrationStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  none: 'neutral',
  ok: 'success',
  expiring: 'warning',
  expired: 'danger'
};

export function formatDate(value?: string | null) {
  return formatDateOnly(value, '—');
}

export function dateInputValue(value?: string | null) {
  return civilDateInputValue(value);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
