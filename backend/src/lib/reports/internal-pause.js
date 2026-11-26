// Pausas por nossa conta (falha de equipamento, acidente...) ficam em
// specialConditions.internalStandby / internalStandbyDetails. São só para controle
// interno: não aparecem no RDO e não devem ser entregues a usuários do cliente.

const INTERNAL_PAUSE_KEYS = ['internalStandby', 'internalStandbyDetails'];

export function withoutInternalPause(report) {
  const special = report?.specialConditions;
  if (!special || typeof special !== 'object' || Array.isArray(special)) return report;
  if (!INTERNAL_PAUSE_KEYS.some(key => Object.prototype.hasOwnProperty.call(special, key))) return report;
  const next = { ...special };
  for (const key of INTERNAL_PAUSE_KEYS) delete next[key];
  return { ...report, specialConditions: next };
}

export function withoutInternalPauseForRole(role, value) {
  if (role !== 'CLIENT') return value;
  return Array.isArray(value) ? value.map(withoutInternalPause) : withoutInternalPause(value);
}
