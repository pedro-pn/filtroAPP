const ROMAN_LEVEL_SUFFIX = /\s+([IVXLCDM]+)$/iu;

export function jobRoleFamilyName(value: string | null | undefined) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) return '';
  return name.replace(ROMAN_LEVEL_SUFFIX, '').trim() || name;
}

export function jobRoleFamilyKey(value: string | null | undefined) {
  return jobRoleFamilyName(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ');
}

export function groupJobRoles<T extends { id: string; name: string; isOperational: boolean }>(roles: T[]) {
  const groups = new Map<string, T & { name: string; familyKey: string; familyRoleIds: string[] }>();
  for (const role of roles) {
    const familyKey = jobRoleFamilyKey(role.name);
    const current = groups.get(familyKey);
    if (current) {
      current.familyRoleIds.push(role.id);
      current.isOperational ||= role.isOperational;
    } else {
      groups.set(familyKey, { ...role, name: jobRoleFamilyName(role.name), familyKey, familyRoleIds: [role.id] });
    }
  }
  return [...groups.values()];
}
