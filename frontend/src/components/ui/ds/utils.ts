export function joinClassNames(
  ...classNames: Array<string | false | null | undefined>
) {
  return classNames.filter(Boolean).join(' ');
}

export function joinIds(...ids: Array<string | undefined>) {
  const result = ids.filter(Boolean).join(' ');
  return result || undefined;
}

export function normalizeStatus(status: string) {
  return status
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function humanizeStatus(status: string) {
  const normalized = status.trim().replace(/[_-]+/g, ' ');
  if (!normalized) return status;
  return normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1);
}
