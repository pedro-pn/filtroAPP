// Mantém os serviços transacionais independentes da configuração dos caches.
// Os caches em uso no servidor registram aqui a limpeza dos dados derivados.
const collaboratorCacheInvalidators = new Set();

export function registerCollaboratorCacheInvalidator(invalidate) {
  collaboratorCacheInvalidators.add(invalidate);
  return () => collaboratorCacheInvalidators.delete(invalidate);
}

export function invalidateCollaboratorDerivedCaches() {
  collaboratorCacheInvalidators.forEach(invalidate => invalidate());
}
