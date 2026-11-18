// Versão do código em execução (SHA do commit), gravada na imagem durante o
// build pela variável APP_GIT_SHA. Sem ela, a versão é "unknown".
export function appVersion(source = process.env) {
  const value = String(source?.APP_GIT_SHA || '').trim();
  return value ? value.slice(0, 64) : 'unknown';
}
