export function databaseUrlWithConnectionLimit(databaseUrl, connectionLimit) {
  if (!databaseUrl || !connectionLimit) return databaseUrl;

  const parsed = new URL(databaseUrl);
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) return databaseUrl;
  if (!parsed.searchParams.has('connection_limit')) {
    parsed.searchParams.set('connection_limit', String(connectionLimit));
  }
  return parsed.toString();
}
