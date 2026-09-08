export type RequiredServiceTimeField = 'startTime' | 'endTime';

interface ServiceWithTimeData {
  data?: Record<string, unknown>;
}

export interface MissingRequiredServiceTime {
  serviceIndex: number;
  field: RequiredServiceTimeField;
}

export function firstMissingRequiredServiceTime(
  services: ServiceWithTimeData[]
): MissingRequiredServiceTime | null {
  for (const [serviceIndex, service] of services.entries()) {
    for (const field of ['startTime', 'endTime'] as const) {
      const value = service.data?.[field];
      if (typeof value !== 'string' || !value.trim()) {
        return { serviceIndex, field };
      }
    }
  }

  return null;
}
