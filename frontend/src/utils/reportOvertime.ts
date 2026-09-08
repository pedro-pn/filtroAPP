export interface ReportWorkdayPolicy {
  workdayHours?: string | null;
  weekendWorkdayHours?: string | null;
  includesSaturday?: boolean | null;
  includesSunday?: boolean | null;
}

export interface ReportOvertimeSummary {
  expectedMinutes: number;
  daytimeWorkedMinutes: number;
  nighttimeWorkedMinutes: number;
  daytimeOvertimeMinutes: number;
  nighttimeOvertimeMinutes: number;
  totalOvertimeMinutes: number;
  isHoliday: boolean;
}

export function parseDurationToMinutes(value: string) {
  const parts = String(value || '')
    .split(':')
    .map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export function calculateWorkedMinutes(
  start: string,
  end: string,
  breakValue: string
) {
  const startMinutes = parseDurationToMinutes(start);
  const endMinutes = parseDurationToMinutes(end);
  if (!start || !end) return 0;
  const total =
    endMinutes >= startMinutes
      ? endMinutes - startMinutes
      : endMinutes + 24 * 60 - startMinutes;
  return Math.max(0, total - parseDurationToMinutes(breakValue));
}

export function formatReportMinutes(total: number) {
  const safe = Math.max(0, Number(total) || 0);
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function getExpectedReportMinutes(
  policy: ReportWorkdayPolicy | null | undefined,
  reportDate: string,
  isHoliday: boolean
) {
  if (!policy) return 0;
  const date = new Date(`${reportDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()))
    return parseDurationToMinutes(policy.workdayHours || '09:00');
  if (isHoliday) return 0;
  const day = date.getUTCDay();
  const weekdayBase = parseDurationToMinutes(policy.workdayHours || '09:00');
  const weekendBase = parseDurationToMinutes(
    policy.weekendWorkdayHours || '08:00'
  );
  if (day === 5) return weekendBase;
  if (day === 6) return policy.includesSaturday ? weekendBase : 0;
  if (day === 0) return policy.includesSunday ? weekendBase : 0;
  return weekdayBase;
}

export function calculateReportOvertimeSummary({
  policy,
  reportDate,
  arrivalTime,
  departureTime,
  lunchBreak,
  nightEnabled,
  nightArrivalTime,
  nightDepartureTime,
  nightBreak,
  isHoliday
}: {
  policy: ReportWorkdayPolicy | null | undefined;
  reportDate: string;
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  nightEnabled: boolean;
  nightArrivalTime: string;
  nightDepartureTime: string;
  nightBreak: string;
  isHoliday: boolean;
}): ReportOvertimeSummary {
  const expectedMinutes = getExpectedReportMinutes(
    policy,
    reportDate,
    isHoliday
  );
  const daytimeWorkedMinutes = calculateWorkedMinutes(
    arrivalTime,
    departureTime,
    lunchBreak
  );
  const nighttimeWorkedMinutes = nightEnabled
    ? calculateWorkedMinutes(nightArrivalTime, nightDepartureTime, nightBreak)
    : 0;
  const overtime = (worked: number) =>
    expectedMinutes === 0
      ? worked
      : Math.max(
          0,
          worked - expectedMinutes > 30 ? worked - expectedMinutes : 0
        );
  const daytimeOvertimeMinutes = overtime(daytimeWorkedMinutes);
  const nighttimeOvertimeMinutes = overtime(nighttimeWorkedMinutes);

  return {
    expectedMinutes,
    daytimeWorkedMinutes,
    nighttimeWorkedMinutes,
    daytimeOvertimeMinutes,
    nighttimeOvertimeMinutes,
    totalOvertimeMinutes: daytimeOvertimeMinutes + nighttimeOvertimeMinutes,
    isHoliday
  };
}
