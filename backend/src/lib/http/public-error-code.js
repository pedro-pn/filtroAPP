// Em produção, um 5xx só devolve `code` quando é um código da aplicação
// (ex.: RH_EVIDENCE_NOT_CONFIGURED). Códigos internos (Prisma P1001, Node
// ECONNREFUSED/ERR_*, undici UND_ERR_*) revelam infraestrutura e ficam só no log.
export function publicErrorCode(err, status, isProduction) {
  const code = typeof err?.code === 'string' ? err.code : '';
  if (!code) return null;
  if (status < 500 || !isProduction) return code;
  if (err.syscall || typeof err.errno === 'number') return null;
  if (/^P\d{4}$/.test(code) || /^(ERR|UND_ERR)_/.test(code)) return null;
  return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(code) ? code : null;
}
