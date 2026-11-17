import { receiveConectaEvent } from './service.js';
import { requireConectaCompany } from './schema.js';

const resources = ['job-roles', 'employments', 'role-changes', 'compliance', 'job-role-salaries'];

// Não registra URLs, tokens ou corpos da origem. O mesmo receptor atende push e recuperação.
export async function syncConectaRh({ database, companyId, apiUrl, token, fetchImpl = fetch, production = true }) {
  requireConectaCompany(companyId, companyId);
  const origin = new URL(apiUrl);
  if (origin.username || origin.password || origin.search || origin.hash || (production && origin.protocol !== 'https:')
    || !['https:', 'http:'].includes(origin.protocol)) throw new Error('CONECTA_RH_API_URL inválida.');
  if (!token) throw new Error('Configure a credencial de leitura do Conecta.');
  const base = origin.href.replace(/\/$/, '');
  const request = async (path, query = {}, method = 'GET') => {
    const url = new URL(base + path);
    for (const [name, value] of Object.entries({ companyId, ...query })) if (value != null) url.searchParams.set(name, value);
    const response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!response.ok) {
      const error = new Error('Não foi possível ler a integração de RH do Conecta.');
      error.statusCode = response.status;
      throw error;
    }
    return response.json();
  };
  const apply = async items => {
    if (!Array.isArray(items)) throw new Error('Página de RH incompatível com o contrato.');
    for (const event of items) await receiveConectaEvent(database, event, { companyId, idempotencyKey: event.eventId });
  };
  const saveCursor = cursor => database.conectaRhSyncState.upsert({ where: { companyId }, create: { companyId, cursor }, update: { cursor } });
  let cursor = (await database.conectaRhSyncState.findUnique({ where: { companyId } }))?.cursor;
  let snapshots = 0, events = 0;
  async function snapshot() {
    const state = await request('/snapshots', {}, 'POST');
    if (typeof state.snapshotId !== 'string' || !/^[0-9a-f-]{36}$/i.test(state.snapshotId) || typeof state.watermarkCursor !== 'string') {
      throw new Error('Snapshot de RH incompatível com o contrato.');
    }
    for (const resource of resources) {
      let pageCursor;
      do {
        let page;
        try { page = await request(`/snapshots/${state.snapshotId}/${resource}`, { cursor: pageCursor, limit: 500 }); }
        catch (error) { if (resource === 'job-role-salaries' && error.statusCode === 403) break; throw error; }
        if (page.snapshotId !== state.snapshotId || page.watermarkCursor !== state.watermarkCursor) throw new Error('Snapshot de RH inconsistente.');
        await apply(page.items); events += page.items.length;
        if (typeof page.hasMore !== 'boolean' || (page.hasMore && (typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor === pageCursor))) {
          throw new Error('Paginação de RH incompatível com o contrato.');
        }
        pageCursor = page.hasMore ? page.nextCursor : null;
      } while (pageCursor);
    }
    // Só avança após concluir todos os recursos. Recomeçar uma carga é idempotente.
    cursor = state.watermarkCursor;
    await saveCursor(cursor);
    snapshots++;
  }
  if (!cursor) await snapshot();
  for (;;) {
    let page;
    try { page = await request('/changes', { cursor, limit: 500 }); }
    catch (error) {
      if (error.statusCode !== 410 || snapshots) throw error;
      await snapshot(); continue;
    }
    if (typeof page.nextCursor !== 'string' || typeof page.hasMore !== 'boolean' || (page.hasMore && page.nextCursor === cursor)) {
      throw new Error('Feed de RH incompatível com o contrato.');
    }
    await apply(page.items); events += page.items.length;
    cursor = page.nextCursor;
    await saveCursor(cursor); // Inclusive quando items está vazio.
    if (!page.hasMore) break;
  }
  return { events, snapshots };
}
