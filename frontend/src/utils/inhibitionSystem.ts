export function inhibitionSystemForVessel(value: string, vesselCode: string) {
  const parts = value.split(';');
  if (!vesselCode || parts.length !== 3) return value;

  parts[2] = parts[2].replace(/^\d+(?=-)/, prefix => vesselCode.padStart(prefix.length, '0'));
  return parts.join(';');
}
