export function groupServicesByScope<T extends { scopeName?: string | null }>(services: T[]) {
  const groups = new Map<string | null, T[]>();
  for (const service of services) {
    const name = service.scopeName?.trim() || null;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(service);
  }
  return [...groups].map(([scopeName, services]) => ({ scopeName, services }));
}
