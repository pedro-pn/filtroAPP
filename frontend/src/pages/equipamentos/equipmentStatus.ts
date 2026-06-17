import type { CompanyEquipment } from '../../api/equipamentos';

export type CalibrationStatus = 'none' | 'ok' | 'expiring' | 'expired';

const EXPIRING_WINDOW_DAYS = 30;

export function calibrationStatus(item: Pick<CompanyEquipment, 'hasCalibration' | 'expiresAt'>): CalibrationStatus {
  if (!item.hasCalibration || !item.expiresAt) return 'none';
  const expires = new Date(item.expiresAt);
  if (Number.isNaN(expires.getTime())) return 'none';
  const now = new Date();
  const diffDays = Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
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

export function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function dateInputValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
