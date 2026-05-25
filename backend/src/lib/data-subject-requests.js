const REQUEST_TYPE_PREFIX = {
  CONFIRMATION: 'CNF',
  ACCESS: 'ACS',
  CORRECTION: 'COR',
  ANONYMIZATION: 'ANM',
  BLOCKING: 'BLK',
  DELETION: 'DEL',
  PORTABILITY: 'PRT',
  SHARING_INFO: 'SHR',
  CONSENT_REVOCATION: 'REV',
  OPPOSITION: 'OPP',
  OTHER: 'OTH'
};

export const DATA_SUBJECT_REQUEST_TYPES = Object.keys(REQUEST_TYPE_PREFIX);

export function normalizeDataSubjectRequestType(type) {
  const normalized = String(type || '').trim().toUpperCase();
  return DATA_SUBJECT_REQUEST_TYPES.includes(normalized) ? normalized : 'OTHER';
}

export function dataSubjectProtocol(type, now = new Date(), random = Math.random) {
  const prefix = REQUEST_TYPE_PREFIX[normalizeDataSubjectRequestType(type)];
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.floor(random() * 36 ** 6)
    .toString(36)
    .toUpperCase()
    .padStart(6, '0');
  return `LGPD-${date}-${prefix}-${suffix}`;
}

export function dataSubjectRequestPublicShape(request) {
  return {
    protocol: request.protocol,
    type: request.type,
    status: request.status,
    createdAt: request.createdAt
  };
}

export function deletionRequestDetails(user) {
  const identifier = [user?.username, user?.email].filter(Boolean).join(' / ');
  return [
    'Solicitação autenticada de eliminação/análise manual de dados pessoais.',
    identifier ? `Identificador da conta: ${identifier}.` : '',
    'A solicitação deve respeitar hipóteses legais de retenção, incluindo documentos assinados, obrigações legais e exercício regular de direitos.'
  ].filter(Boolean).join(' ');
}
