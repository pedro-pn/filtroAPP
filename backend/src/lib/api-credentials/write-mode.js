export const isApiWriteMethod = method => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase());

export function shouldSimulateWrite(method, headers = {}, credential = {}) {
  return isApiWriteMethod(method) && (credential.writeMode === 'SIMULATE'
    || String(headers.prefer || '').split(',').some(value => /^validate-only(?:\s*;|\s*$)/i.test(value.trim())));
}

export function applySimulationPreference(req, res, credential = req.apiAuth?.credential) {
  if (shouldSimulateWrite(req.method, req.headers, credential)) {
    req.apiSimulated = true;
    res.setHeader('Preference-Applied', 'validate-only');
  }
}
