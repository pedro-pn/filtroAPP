/**
 * Pausa por nossa conta (falha em equipamento nosso, acidente...): registro interno,
 * separado do standby do cliente. Fica em specialConditions.internalStandby/internalStandbyDetails
 * e não é renderizada no RDO (DOCX/PDF/Data Book leem apenas standbyDetails).
 */
export interface InternalStandbyForm {
  internalStandby: boolean;
  internalStandbyDuration: string;
  internalStandbyMotivo: string;
}

export const INTERNAL_STANDBY_INCOMPLETE = 'Informe tempo e motivo da pausa por nossa conta.';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function internalStandbyFromSpecialConditions(specialConditions: unknown): InternalStandbyForm {
  const special = record(specialConditions);
  const details = record(special.internalStandbyDetails);
  return {
    internalStandby: special.internalStandby === true,
    internalStandbyDuration: text(details.total),
    internalStandbyMotivo: text(details.motivo)
  };
}

export function internalStandbySpecialConditions(form: InternalStandbyForm) {
  return {
    internalStandby: form.internalStandby,
    internalStandbyDetails: form.internalStandby
      ? { total: form.internalStandbyDuration, motivo: form.internalStandbyMotivo }
      : null
  };
}

export function pickInternalStandby(form: InternalStandbyForm): InternalStandbyForm {
  return {
    internalStandby: form.internalStandby,
    internalStandbyDuration: form.internalStandbyDuration,
    internalStandbyMotivo: form.internalStandbyMotivo
  };
}

export function internalStandbyIncomplete(form: InternalStandbyForm) {
  return form.internalStandby && (!form.internalStandbyDuration || !form.internalStandbyMotivo.trim());
}
