export function inhibitionSystemForVessel(value: string, vesselCode: string, previousVesselCode = '') {
  const parts = value.split(';');
  if (!vesselCode || parts.length < 3) return value;

  // The system catalog uses 51632 throughout its diagram references.
  let diagram = parts.slice(2).join(';').replaceAll('51632', vesselCode);
  if (previousVesselCode) diagram = diagram.replaceAll(previousVesselCode, vesselCode);
  return `${parts[0]};${parts[1]};${diagram}`;
}
