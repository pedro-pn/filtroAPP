// Tela genérica de e-mails de aviso por finalidade, na Administração do Efetivo. Cada linha é uma
// "finalidade" (um tipo de aviso automático) com um e-mail padrão configurável; novas finalidades futuras só
// precisam de uma nova entrada aqui.
export const NOTIFICATION_EMAIL_PURPOSES = [
  {
    key: 'PROJECT_WORKFLOW_CLIENT_REGISTRATION',
    label: 'Cadastro de cliente (itens críticos da gestão de projetos)',
    description: 'Avisado quando o Líder de Projetos responde, na Análise inicial, que é necessário cadastro da Filtrovali junto ao cliente.'
  }
];

export function notificationEmailPurposeKeys() {
  return NOTIFICATION_EMAIL_PURPOSES.map(item => item.key);
}

export function makeNotificationEmailSettingSchema(z) {
  return z.object({
    purpose: z.enum(notificationEmailPurposeKeys()),
    email: z.string().trim().email('Informe um e-mail válido.').max(160)
  }).strict();
}
