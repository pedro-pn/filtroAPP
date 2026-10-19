export function groupServicesByScope<T extends { scopeName?: string | null; contributionKey?: string | null }>(services: T[]) {
  const groups = new Map<string, T[]>();
  for (const service of services) {
    const name = service.scopeName?.trim() || null;
    const key = JSON.stringify([service.contributionKey ?? null, name]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(service);
  }
  return [...groups.values()].map(services => ({ scopeName: services[0].scopeName?.trim() || null, services,
    ...(services[0].contributionKey ? { contributionKey: services[0].contributionKey } : {}) }));
}
