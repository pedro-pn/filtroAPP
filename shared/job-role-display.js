const ROMAN_LEVEL_SUFFIX = /\s+([IVXLCDM]+)$/iu;

export function jobRoleFamilyName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) return '';
  const base = name.replace(ROMAN_LEVEL_SUFFIX, '').trim();
  return base || name;
}

export function jobRoleFamilyKey(value) {
  return jobRoleFamilyName(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ');
}

export function groupJobRoles(jobRoles = []) {
  const groups = new Map();
  for (const role of jobRoles) {
    const familyKey = jobRoleFamilyKey(role.name);
    if (!familyKey) continue;
    const current = groups.get(familyKey);
    if (current) {
      current.roleIds.push(role.id);
      current.isOperational ||= role.isOperational;
      continue;
    }
    groups.set(familyKey, {
      ...role,
      name: jobRoleFamilyName(role.name),
      familyKey,
      roleIds: [role.id]
    });
  }
  return [...groups.values()];
}
