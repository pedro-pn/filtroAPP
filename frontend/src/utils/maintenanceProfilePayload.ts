import type { MaintenanceProfilePayload } from '../api/equipamentos';
import type { MaintenanceProfileFormValues } from '../schemas/operationalReport';

export function buildMaintenanceProfilePayload(
  values: MaintenanceProfileFormValues
): MaintenanceProfilePayload {
  return {
    name: values.name.trim(),
    isActive: values.isActive,
    items: values.items.map((item, index) => ({
      ...(item.id?.trim() ? { id: item.id.trim() } : {}),
      label: item.label.trim(),
      order: index + 1,
      isActive: item.isActive
    }))
  };
}
