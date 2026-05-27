const FIELD_LABELS = {
  username: 'Usuário',
  password: 'Senha',
  currentPassword: 'Senha atual',
  newPassword: 'Nova senha',
  identifier: 'Identificador',
  token: 'Token',
  email: 'E-mail',
  projectId: 'Projeto',
  createdByUserId: 'Usuário criador',
  reportDate: 'Data do relatório',
  arrivalTime: 'Chegada',
  departureTime: 'Saída',
  lunchBreak: 'Intervalo de almoço',
  collaboratorIds: 'Colaboradores',
  services: 'Serviços',
  serviceType: 'Tipo de serviço',
  status: 'Status',
  action: 'Ação',
  ids: 'Itens',
  format: 'Formato',
  fileName: 'Arquivo',
  mimeType: 'Tipo do arquivo',
  dataUrl: 'Arquivo',
  label: 'Nome',
  code: 'Código',
  name: 'Nome',
  clientName: 'Cliente',
  clientCnpj: 'CNPJ',
  clientEmailPrimary: 'E-mail principal',
  clientEmailCc: 'E-mails em cópia',
  clientSigners: 'Assinantes',
  contractCode: 'Contrato',
  location: 'Local',
  workdayHours: 'Jornada diária',
  weekendWorkdayHours: 'Jornada de fim de semana',
  authorizedUserIds: 'Usuários autorizados',
  reportSequences: 'Sequenciais',
  nextNumber: 'Próximo número',
  scale: 'Escala',
  calibrationCertCode: 'Certificado de calibração',
  privacyNoticeAccepted: 'Aceite de privacidade',
  privacyNoticeVersion: 'Versão do aviso de privacidade',
  recordIds: 'EPIs',
  type: 'Tipo',
  responseKind: 'Tipo de resposta',
  order: 'Ordem',
  slug: 'Identificador',
  romaneioDate: 'Data do romaneio',
  items: 'Itens',
  questions: 'Perguntas',
  options: 'Opções',
  moduleRoles: 'Permissões',
  accountType: 'Tipo de conta',
  role: 'Perfil'
};

const ENGLISH_ZOD_PATTERNS = [
  /\bRequired\b/i,
  /\bInvalid\b/i,
  /\bExpected\b/i,
  /\breceived\b/i,
  /\bmust\b/i,
  /\bString\b/i,
  /\bNumber\b/i,
  /\bArray\b/i,
  /\bBoolean\b/i,
  /\bUnrecognized\b/i,
  /\bcharacters?\b/i,
  /\bemail\b/i,
  /\burl\b/i
];

function hasPortugueseText(message) {
  return /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(message)
    || /\b(informe|inválid|obrigat|selecione|preencha|aceite|campo|dados|senha|usuário|conta|projeto)\b/i.test(message);
}

function isDefaultEnglishZodMessage(message) {
  const text = String(message || '').trim();
  return !!text && !hasPortugueseText(text) && ENGLISH_ZOD_PATTERNS.some(pattern => pattern.test(text));
}

function pluralizeItem(count) {
  return count === 1 ? 'item' : 'itens';
}

function fieldLabel(path = []) {
  const parts = Array.isArray(path) ? path : [];
  const lastString = [...parts].reverse().find(part => typeof part === 'string');
  if (!lastString) return 'Campo';
  return FIELD_LABELS[lastString] || lastString;
}

function requiredMessage(issue) {
  return `Preencha o campo ${fieldLabel(issue.path)}.`;
}

function tooSmallMessage(issue) {
  const minimum = Number(issue.minimum || 0);
  const label = fieldLabel(issue.path);
  if (issue.type === 'string') {
    return minimum <= 1
      ? `Preencha o campo ${label}.`
      : `${label} deve ter pelo menos ${minimum} caracteres.`;
  }
  if (issue.type === 'array') {
    return `Selecione pelo menos ${minimum} ${pluralizeItem(minimum)} em ${label}.`;
  }
  if (issue.type === 'number') {
    return `${label} deve ser maior ou igual a ${minimum}.`;
  }
  return `${label} está abaixo do valor mínimo permitido.`;
}

function tooBigMessage(issue) {
  const maximum = Number(issue.maximum || 0);
  const label = fieldLabel(issue.path);
  if (issue.type === 'string') return `${label} deve ter no máximo ${maximum} caracteres.`;
  if (issue.type === 'array') return `${label} deve ter no máximo ${maximum} ${pluralizeItem(maximum)}.`;
  if (issue.type === 'number') return `${label} deve ser menor ou igual a ${maximum}.`;
  return `${label} excede o valor máximo permitido.`;
}

function invalidStringMessage(issue) {
  const label = fieldLabel(issue.path);
  if (issue.validation === 'email') return `${label} deve ser um e-mail válido.`;
  if (issue.validation === 'url') return `${label} deve ser uma URL válida.`;
  if (issue.validation === 'uuid') return `${label} deve ser um identificador válido.`;
  if (issue.validation === 'regex') return `${label} possui formato inválido.`;
  return `${label} possui formato inválido.`;
}

export function localizeZodIssue(issue) {
  const originalMessage = String(issue?.message || '').trim();
  if (originalMessage && !isDefaultEnglishZodMessage(originalMessage)) return originalMessage;

  switch (issue?.code) {
    case 'invalid_type':
      if (issue.received === 'undefined' || issue.received === 'null') return requiredMessage(issue);
      return `${fieldLabel(issue.path)} deve ser do tipo correto.`;
    case 'too_small':
      return tooSmallMessage(issue);
    case 'too_big':
      return tooBigMessage(issue);
    case 'invalid_string':
      return invalidStringMessage(issue);
    case 'invalid_enum_value':
      return `${fieldLabel(issue.path)} inválido.`;
    case 'invalid_literal':
      return `${fieldLabel(issue.path)} inválido.`;
    case 'invalid_union':
      return `${fieldLabel(issue.path)} inválido.`;
    case 'invalid_date':
      return `${fieldLabel(issue.path)} deve ser uma data válida.`;
    case 'unrecognized_keys':
      return `Campo não reconhecido: ${(issue.keys || []).join(', ')}.`;
    case 'not_multiple_of':
      return `${fieldLabel(issue.path)} deve ser múltiplo de ${issue.multipleOf}.`;
    default:
      return originalMessage || 'Dados inválidos.';
  }
}

export function localizedZodIssues(issues = []) {
  return issues.map(issue => ({
    ...issue,
    message: localizeZodIssue(issue)
  }));
}

export function localizedZodErrorDetails(error) {
  const details = error.flatten();
  return {
    formErrors: (details.formErrors || []).map(message => (
      isDefaultEnglishZodMessage(message) ? 'Dados inválidos.' : message
    )),
    fieldErrors: Object.fromEntries(
      Object.entries(details.fieldErrors || {}).map(([field, messages]) => [
        field,
        (messages || []).map(message => (
          isDefaultEnglishZodMessage(message)
            ? localizeZodIssue({ code: 'invalid_type', received: 'undefined', path: [field], message })
            : message
        ))
      ])
    )
  };
}
