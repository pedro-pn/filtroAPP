function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function textValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
    return textValue(value.value);
  }
  return String(value).trim();
}

export function equipmentAttributes(item) {
  return recordValue(item?.attributes);
}

export function equipmentTechnicalData(item) {
  return recordValue(item?.technicalData);
}

export function equipmentSerialNumber(item) {
  const attributes = equipmentAttributes(item);
  const technicalData = equipmentTechnicalData(item);
  const candidates = [
    attributes.serialNumber,
    attributes.serialnumber,
    attributes.serial,
    attributes.Serial,
    technicalData.serialNumber,
    technicalData.serialnumber,
    technicalData.serial,
    technicalData.Serial
  ];
  for (const candidate of candidates) {
    const value = textValue(candidate);
    if (value) return value;
  }
  return '';
}
