export const EMAIL_LOGO_CID = 'filtrovali-logo-colorido';
const PRIVACY_CONTACT = 'privacidade@filtrovali.com.br';

function privacyTextLine() {
  return `Canal de privacidade: ${PRIVACY_CONTACT}`;
}

function privacyHtmlLine() {
  return `<p style="font-size:12px;line-height:1.7;margin:16px 0 0;color:#4b5563">Canal de privacidade: <a href="mailto:${PRIVACY_CONTACT}" style="color:#30503a">${PRIVACY_CONTACT}</a>.</p>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEmailDate(value) {
  const raw = value instanceof Date ? value.toISOString() : String(value || '');
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR');
}

function wrapEmailHtml({ title, intro, body, footer }) {
  return `
<style>
  /* Instrui clientes que suportam color-scheme a não aplicar dark mode automático */
  :root { color-scheme: light only; }

  /* Outlook.com dark mode: injeta [data-ogsc] no body ao ativar dark mode */
  [data-ogsc] .ew-outer  { background-color: #eef4ef !important; }
  [data-ogsc] .ew-header { background-color: #243d2c !important; }
  [data-ogsc] .ew-card   { background-color: #ffffff !important; color: #1a1a1a !important; }
  [data-ogsc] .ew-title  { color: #243d2c !important; }
  [data-ogsc] .ew-intro  { color: #374151 !important; }
  [data-ogsc] .ew-footer { background-color: #f3f6f4 !important; }
  [data-ogsc] .ew-footer-text { color: #6b7280 !important; }

  /* Apple Mail, iOS Mail, Thunderbird — força as mesmas cores no dark mode */
  @media (prefers-color-scheme: dark) {
    .ew-outer  { background-color: #eef4ef !important; }
    .ew-header { background-color: #243d2c !important; }
    .ew-card   { background-color: #ffffff !important; color: #1a1a1a !important; }
    .ew-title  { color: #243d2c !important; }
    .ew-intro  { color: #374151 !important; }
    .ew-footer { background-color: #f3f6f4 !important; }
    .ew-footer-text { color: #6b7280 !important; }
  }
</style>
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef4ef" style="background-color:#eef4ef;font-family:Segoe UI,Arial,sans-serif">
  <tr>
    <td class="ew-outer" align="center" style="padding:32px 16px;background-color:#eef4ef">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px">
        <tr>
          <td class="ew-header" bgcolor="#243d2c" style="background-color:#243d2c;padding:20px 32px;border-radius:12px 12px 0 0">
            <img src="cid:${EMAIL_LOGO_CID}" alt="Filtrovali" width="180" style="display:block;max-width:180px;width:100%;height:auto;border:0">
          </td>
        </tr>
        <tr>
          <td class="ew-card" style="padding:32px;color:#1a1a1a;background-color:#ffffff">
            <h1 class="ew-title" style="font-size:22px;line-height:1.3;margin:0 0 12px;color:#243d2c">${title}</h1>
            <p class="ew-intro" style="font-size:14px;line-height:1.7;margin:0 0 20px;color:#374151">${intro}</p>
            ${body}
            <!--PREFS_PLACEHOLDER-->
          </td>
        </tr>
        <tr>
          <td class="ew-footer" bgcolor="#f3f6f4" style="background-color:#f3f6f4;border-top:3px solid #d1e0d5;padding:20px 32px;border-radius:0 0 12px 12px">
            <p class="ew-footer-text" style="font-size:12px;line-height:1.6;color:#6b7280;margin:0">${footer}</p>
            <p style="font-size:11px;line-height:1.5;color:#9ca3af;margin:8px 0 0">Este e-mail foi gerado automaticamente. Por favor, não responda diretamente a esta mensagem.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
  `.trim();
}

export function addNotificationPreferencesLink(template, url) {
  if (!url) return template;
  const safeUrl = escapeHtml(url);
  const prefsHtml = `
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb">
      <a href="${safeUrl}" style="display:inline-block;background:#eef4ef;color:#30503a;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700;font-size:13px">Não receber notificações</a>
      <p style="font-size:12px;line-height:1.6;color:#6b7280;margin:10px 0 0">Este link permite alterar apenas suas preferências de notificação.</p>
    </div>`;
  const html = (template.html || '').replace('<!--PREFS_PLACEHOLDER-->', prefsHtml);
  return {
    ...template,
    text: [
      template.text || '',
      '',
      `Não receber notificações: ${url}`,
      'Este link permite alterar apenas suas preferências de notificação.'
    ].filter(Boolean).join('\n'),
    html
  };
}

export function buildTestEmailTemplate({ host, port, user, timestamp }) {
  const title = 'Teste de conexão SMTP';
  const intro = 'Este é um e-mail de teste gerado pelo diagnóstico do sistema Filtrovali.';
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Servidor:</strong> ${host}:${port}</div>
        <div><strong>Conta:</strong> ${user}</div>
        <div><strong>Data:</strong> ${timestamp}</div>
      </div>
    </div>
  `;
  const footer = 'Se você recebeu esta mensagem, a configuração SMTP está funcionando corretamente.';

  return {
    subject: '[Filtrovali] Teste de conexão SMTP',
    text: [
      'Este é um e-mail de teste gerado pelo diagnóstico do sistema Filtrovali.',
      '',
      'Se você recebeu esta mensagem, a configuração SMTP está funcionando corretamente.',
      '',
      `Servidor: ${host}:${port}`,
      `Conta: ${user}`,
      `Data: ${timestamp}`
    ].join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildDataSubjectRequestCreatedEmailTemplate({ protocol, typeLabel, requesterName, requesterEmail, identifier, details, appUrl }) {
  const safeProtocol = escapeHtml(protocol);
  const safeTypeLabel = escapeHtml(typeLabel);
  const safeRequesterName = escapeHtml(requesterName);
  const safeRequesterEmail = escapeHtml(requesterEmail);
  const safeIdentifier = escapeHtml(identifier || '---');
  const safeDetails = escapeHtml(details);
  const safeAppUrl = escapeHtml(appUrl);
  const title = 'Nova solicitação LGPD registrada';
  const intro = `Uma nova solicitação de direitos do titular foi registrada com o protocolo ${safeProtocol}.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Protocolo:</strong> ${safeProtocol}</div>
        <div><strong>Tipo:</strong> ${safeTypeLabel}</div>
        <div><strong>Titular:</strong> ${safeRequesterName}</div>
        <div><strong>E-mail:</strong> ${safeRequesterEmail}</div>
        <div><strong>Identificador:</strong> ${safeIdentifier}</div>
      </div>
    </div>
    <div style="margin-top:16px;font-size:14px;line-height:1.7">
      <strong>Detalhes:</strong>
      <p style="margin:8px 0 0;white-space:pre-wrap">${safeDetails}</p>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o módulo de privacidade em: <a href="${safeAppUrl}" style="color:#30503a">${safeAppUrl}</a></p>` : ''}
    ${privacyHtmlLine()}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Nova solicitação LGPD - ${protocol}`,
    text: [
      `Nova solicitação LGPD registrada: ${protocol}`,
      '',
      `Tipo: ${typeLabel}`,
      `Titular: ${requesterName}`,
      `E-mail: ${requesterEmail}`,
      `Identificador: ${identifier || '---'}`,
      '',
      'Detalhes:',
      details,
      appUrl ? `Acesso: ${appUrl}` : '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildDataSubjectRequestResponseEmailTemplate({ protocol, typeLabel, requesterName, message, resolved, privacyContact = PRIVACY_CONTACT }) {
  const safeProtocol = escapeHtml(protocol);
  const safeTypeLabel = escapeHtml(typeLabel);
  const safeRequesterName = escapeHtml(requesterName);
  const safeMessage = escapeHtml(message);
  const safePrivacyContact = escapeHtml(privacyContact);
  const statusText = resolved ? 'concluída' : 'em análise';
  const title = `Resposta à solicitação LGPD ${safeProtocol}`;
  const intro = `Olá, ${safeRequesterName}. Enviamos uma resposta sobre a sua solicitação LGPD.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Protocolo:</strong> ${safeProtocol}</div>
        <div><strong>Tipo:</strong> ${safeTypeLabel}</div>
        <div><strong>Status:</strong> ${statusText}</div>
      </div>
    </div>
    <div style="margin-top:16px;font-size:14px;line-height:1.7">
      <strong>Resposta:</strong>
      <p style="margin:8px 0 0;white-space:pre-wrap">${safeMessage}</p>
    </div>
    <p style="font-size:12px;line-height:1.7;margin:16px 0 0;color:#4b5563">Para complementar esta solicitação, responda este e-mail ou entre em contato pelo canal de privacidade: <a href="mailto:${safePrivacyContact}" style="color:#30503a">${safePrivacyContact}</a>.</p>
  `;
  const footer = 'Este envio foi gerado pelo sistema Filtrovali para atendimento de direitos LGPD.';

  return {
    subject: `[Filtrovali] Resposta à solicitação LGPD - ${protocol}`,
    text: [
      `Resposta à solicitação LGPD ${protocol}`,
      '',
      `Tipo: ${typeLabel}`,
      `Status: ${statusText}`,
      '',
      'Resposta:',
      message,
      '',
      `Canal de privacidade: ${privacyContact}`
    ].join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildReportApprovedEmailTemplate({ projectCode, projectName, clientName, reportType, reportNumber, reportDate, appUrl }) {
  const title = 'Relatório gerado no sistema Filtrovali';
  const intro = `O relatório ${reportType} ${reportNumber} do projeto ${projectCode} - ${projectName} foi gerado e está disponível no sistema.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Cliente:</strong> ${clientName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Relatório:</strong> ${reportType} ${reportNumber}</div>
        <div><strong>Data:</strong> ${reportDate}</div>
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema em: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
    ${privacyHtmlLine()}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] ${reportType} ${reportNumber} gerado no sistema Filtrovali`,
    text: [
      `O relatório ${reportType} ${reportNumber} foi gerado no sistema Filtrovali.`,
      '',
      `Cliente: ${clientName}`,
      `Projeto: ${projectCode} - ${projectName}`,
      `Data: ${reportDate}`,
      appUrl ? `Acesso: ${appUrl}` : '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildRomaneioCreatedEmailTemplate({
  romaneioType = 'Saída',
  projectCode,
  projectName,
  clientName,
  romaneioDate,
  driverName,
  vehiclePlate,
  itemCount,
  categorySummary,
  appUrl
}) {
  const typeText = romaneioType || 'Saída';
  const typeTextLower = typeText.toLowerCase();
  const title = `Romaneio de ${typeTextLower} gerado`;
  const intro = `O romaneio de ${typeTextLower} do projeto ${projectCode} - ${projectName} foi criado no sistema Filtrovali e segue anexado em PDF.`;
  const categories = Array.isArray(categorySummary) ? categorySummary : [];
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Tipo:</strong> ${typeText}</div>
        <div><strong>Cliente:</strong> ${clientName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Data:</strong> ${romaneioDate}</div>
        <div><strong>Motorista:</strong> ${driverName}</div>
        <div><strong>Placa:</strong> ${vehiclePlate}</div>
        <div><strong>Total de itens:</strong> ${itemCount}</div>
      </div>
    </div>
    ${categories.length ? `
      <div style="margin-top:16px">
        <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#30503a;margin-bottom:8px">Categorias</div>
        <div style="display:grid;gap:8px">
          ${categories.map(item => `
            <div style="display:flex;justify-content:space-between;gap:12px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;font-size:13px">
              <span style="font-weight:600;color:#243d2c">${item.categoryName}</span>
              <span style="color:#6b7280">${item.count} item(ns)</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema em: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
    ${privacyHtmlLine()}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo módulo de Romaneio da Filtrovali.';

  return {
    subject: `[Filtrovali] Romaneio de ${typeText} - ${projectCode} - ${projectName}`,
    text: [
      `O romaneio de ${typeTextLower} do projeto ${projectCode} - ${projectName} foi criado e segue anexado em PDF.`,
      '',
      `Tipo: ${typeText}`,
      `Cliente: ${clientName}`,
      `Projeto: ${projectCode} - ${projectName}`,
      `Data: ${romaneioDate}`,
      `Motorista: ${driverName}`,
      `Placa: ${vehiclePlate}`,
      `Total de itens: ${itemCount}`,
      categories.length ? '' : '',
      ...categories.map(item => `${item.categoryName}: ${item.count} item(ns)`),
      appUrl ? `Acesso: ${appUrl}` : '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildMonthlyAllocationReportEmailTemplate({ monthLabel, summary }) {
  const safeMonth = escapeHtml(monthLabel);
  const counts = summary || {};
  const title = 'Relatório mensal de alocação';
  const intro = `Segue em anexo o relatório mensal de alocação de colaboradores referente a ${safeMonth}.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Competência:</strong> ${safeMonth}</div>
        <div><strong>RDOs considerados:</strong> ${counts.reportCount || 0}</div>
        <div><strong>Colaboradores:</strong> ${counts.collaboratorCount || 0}</div>
        <div><strong>Alocações:</strong> ${counts.allocationCount || 0}</div>
        <div><strong>Projetos:</strong> ${counts.projectCount || 0}</div>
      </div>
    </div>
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Relatório mensal de alocação - ${monthLabel}`,
    text: [
      `Relatório mensal de alocação - ${monthLabel}`,
      '',
      'Segue em anexo o PDF com o resumo dia a dia por colaborador, projeto e CNPJ.',
      '',
      `RDOs considerados: ${counts.reportCount || 0}`,
      `Colaboradores: ${counts.collaboratorCount || 0}`,
      `Alocações: ${counts.allocationCount || 0}`,
      `Projetos: ${counts.projectCount || 0}`
    ].join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildPasswordResetEmailTemplate({ userName, resetUrl, expiresLabel }) {
  const title = 'Recuperação de senha';
  const intro = `Recebemos uma solicitação para redefinir a senha da conta ${userName}.`;
  const body = `
    <p style="font-size:14px;line-height:1.7;margin:0 0 16px">Use o link abaixo para cadastrar uma nova senha:</p>
    <p style="margin:0 0 16px"><a href="${resetUrl}" style="display:inline-block;background:#30503a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Redefinir senha</a></p>
    <p style="font-size:13px;line-height:1.7;margin:0 0 8px">Se preferir, copie e cole este link no navegador:</p>
    <p style="font-size:12px;line-height:1.7;word-break:break-all;margin:0">${resetUrl}</p>
  `;
  const footer = `Este link expira em ${expiresLabel}. Se você não solicitou esta alteração, ignore este e-mail.`;

  return {
    subject: '[Filtrovali] Recuperação de senha',
    text: [
      `Recebemos uma solicitação para redefinir a senha da conta ${userName}.`,
      '',
      `Use este link para redefinir a senha: ${resetUrl}`,
      '',
      `Este link expira em ${expiresLabel}.`,
      'Se você não solicitou esta alteração, ignore este e-mail.'
    ].join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildEmailChangeConfirmationTemplate({ userName, email, confirmUrl, expiresLabel }) {
  const title = 'Confirmação de troca de e-mail';
  const intro = `Recebemos uma solicitação para vincular este e-mail à conta ${userName}.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Novo e-mail:</strong> ${email}</div>
      </div>
    </div>
    <p style="font-size:14px;line-height:1.7;margin:16px 0">Use o link abaixo para confirmar a alteração:</p>
    <p style="margin:0 0 16px"><a href="${confirmUrl}" style="display:inline-block;background:#30503a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Confirmar e-mail</a></p>
    <p style="font-size:13px;line-height:1.7;margin:0 0 8px">Se preferir, copie e cole este link no navegador:</p>
    <p style="font-size:12px;line-height:1.7;word-break:break-all;margin:0">${confirmUrl}</p>
  `;
  const footer = `Este link expira em ${expiresLabel}. Se você não solicitou esta alteração, ignore este e-mail.`;

  return {
    subject: '[Filtrovali] Confirme seu novo e-mail',
    text: [
      `Recebemos uma solicitação para vincular ${email} à conta ${userName}.`,
      '',
      `Confirme a alteração neste link: ${confirmUrl}`,
      '',
      `Este link expira em ${expiresLabel}.`,
      'Se você não solicitou esta alteração, ignore este e-mail.'
    ].join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildClientWelcomeEmailTemplate({ clientName, cnpj, password, appUrl, projectCode, projectName }) {
  const title = 'Acesso do cliente liberado';
  const intro = `A conta do cliente ${clientName} foi criada no sistema Filtrovali.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Projeto inicial:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Usuário:</strong> ${cnpj}</div>
        <div><strong>Senha inicial:</strong> ${password}</div>
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema em: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
    ${privacyHtmlLine()}
  `;
  const footer = 'Guarde estas informações com segurança. Depois do primeiro acesso, a senha pode ser alterada na área de conta.';

  return {
    subject: '[Filtrovali] Seu acesso foi criado',
    text: [
      `A conta do cliente ${clientName} foi criada no sistema Filtrovali.`,
      '',
      `Projeto inicial: ${projectCode} - ${projectName}`,
      `Usuário: ${cnpj}`,
      `Senha inicial: ${password}`,
      appUrl ? `Acesso: ${appUrl}` : '',
      '',
      'Depois do primeiro acesso, a senha pode ser alterada na área de conta.',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildInternalUserWelcomeEmailTemplate({ userName, username, password, roleLabel, appUrl }) {
  const title = 'Acesso ao sistema liberado';
  const intro = `A conta de ${roleLabel} ${userName} foi criada no sistema Filtrovali.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Perfil:</strong> ${roleLabel}</div>
        <div><strong>Usuário:</strong> ${username}</div>
        <div><strong>Senha inicial:</strong> ${password}</div>
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema em: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
    ${privacyHtmlLine()}
  `;
  const footer = 'Guarde estas informações com segurança. Depois do primeiro acesso, a senha pode ser alterada na área de conta.';

  return {
    subject: '[Filtrovali] Seu acesso foi criado',
    text: [
      `A conta de ${roleLabel} ${userName} foi criada no sistema Filtrovali.`,
      '',
      `Perfil: ${roleLabel}`,
      `Usuário: ${username}`,
      `Senha inicial: ${password}`,
      appUrl ? `Acesso: ${appUrl}` : '',
      '',
      'Depois do primeiro acesso, a senha pode ser alterada na área de conta.',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildClientProjectLinkedEmailTemplate({ clientName, appUrl, projectCode, projectName, contractCode }) {
  const title = 'Novo projeto vinculado à sua conta';
  const intro = `Um novo projeto foi vinculado à conta do cliente ${clientName} no sistema Filtrovali.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Contrato:</strong> ${contractCode || '---'}</div>
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema em: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
    ${privacyHtmlLine()}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: '[Filtrovali] Novo projeto vinculado',
    text: [
      `Um novo projeto foi vinculado à conta do cliente ${clientName}.`,
      '',
      `Projeto: ${projectCode} - ${projectName}`,
      `Contrato: ${contractCode || '---'}`,
      appUrl ? `Acesso: ${appUrl}` : '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildClientAccessReminderEmailTemplate({ clientName, cnpj, newPassword, appUrl, projectCount }) {
  const title = 'Acesso do cliente';
  const intro = `Segue o acesso atualizado da conta do cliente ${clientName} no sistema Filtrovali.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Usuário:</strong> ${cnpj}</div>
        <div><strong>Senha:</strong> ${newPassword}</div>
        <div><strong>Projetos vinculados:</strong> ${projectCount}</div>
      </div>
    </div>
    <p style="font-size:14px;line-height:1.7;margin:16px 0 0">Após o primeiro acesso, recomendamos alterar a senha pela opção "Esqueci minha senha" na tela de login.</p>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema em: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
    ${privacyHtmlLine()}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: '[Filtrovali] Seus dados de acesso',
    text: [
      `Segue o acesso atualizado da conta do cliente ${clientName}.`,
      '',
      `Usuário: ${cnpj}`,
      `Senha: ${newPassword}`,
      `Projetos vinculados: ${projectCount}`,
      'Após o primeiro acesso, recomendamos alterar a senha.',
      appUrl ? `Acesso: ${appUrl}` : '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildReportReapprovedEmailTemplate({ projectCode, projectName, clientName, reportType, reportNumber, reportDate, appUrl }) {
  const title = 'Relatório revisado e disponível para nova avaliação';
  const intro = `O relatório ${reportType} ${reportNumber} do projeto ${projectCode} - ${projectName}, que havia sido reprovado anteriormente, foi revisado pelo gestor e está disponível para sua avaliação.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Cliente:</strong> ${clientName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Relatório:</strong> ${reportType} ${reportNumber}</div>
        <div><strong>Data:</strong> ${reportDate}</div>
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema para avaliar: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
    ${privacyHtmlLine()}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] ${reportType} ${reportNumber} revisado — disponível para nova avaliação`,
    text: [
      `O relatório ${reportType} ${reportNumber} foi revisado e está disponível para nova avaliação.`,
      '',
      `Cliente: ${clientName}`,
      `Projeto: ${projectCode} - ${projectName}`,
      `Data: ${reportDate}`,
      appUrl ? `Acesso: ${appUrl}` : ''
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildReportRejectedByClientEmailTemplate({ projectCode, projectName, clientName, reportType, reportNumber, reportDate, comment, appUrl }) {
  const title = 'Relatório reprovado pelo cliente';
  const reviewer = clientName || 'Cliente';
  const intro = `O relatório ${reportType} ${reportNumber} do projeto ${projectCode} - ${projectName} foi reprovado por ${reviewer} e precisa ser revisado.`;
  const safeProjectCode = escapeHtml(projectCode);
  const safeProjectName = escapeHtml(projectName);
  const safeReviewer = escapeHtml(reviewer);
  const safeReportType = escapeHtml(reportType);
  const safeReportNumber = escapeHtml(reportNumber);
  const safeReportDate = escapeHtml(reportDate);
  const safeComment = escapeHtml(comment);
  const safeAppUrl = escapeHtml(appUrl);
  const safeIntro = `O relatório ${safeReportType} ${safeReportNumber} do projeto ${safeProjectCode} - ${safeProjectName} foi reprovado por ${safeReviewer} e precisa ser revisado.`;
  const body = `
    <div style="background:#fff8f8;border:1px solid #f5c6c6;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Cliente que reprovou:</strong> ${safeReviewer}</div>
        <div><strong>Projeto:</strong> ${safeProjectCode} - ${safeProjectName}</div>
        <div><strong>Relatório:</strong> ${safeReportType} ${safeReportNumber}</div>
        <div><strong>Data:</strong> ${safeReportDate}</div>
        ${comment ? `<div style="margin-top:12px"><strong>Justificativa do cliente:</strong><br><span style="white-space:pre-wrap">${safeComment}</span></div>` : ''}
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema para revisar: <a href="${safeAppUrl}" style="color:#30503a">${safeAppUrl}</a></p>` : ''}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] ${reportType} ${reportNumber} reprovado pelo cliente`,
    text: [
      `O relatório ${reportType} ${reportNumber} foi reprovado por ${reviewer}.`,
      '',
      `Cliente que reprovou: ${reviewer}`,
      `Projeto: ${projectCode} - ${projectName}`,
      `Data: ${reportDate}`,
      comment ? `Justificativa: ${comment}` : '',
      appUrl ? `Acesso: ${appUrl}` : ''
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro: safeIntro, body, footer })
  };
}

export function buildReportSignatureReceivedEmailTemplate({
  projectCode,
  projectName,
  reportType,
  reportNumber,
  reportDate,
  signerName,
  signerEmail,
  signedCount,
  requiredCount,
  appUrl
}) {
  const title = 'Assinatura recebida';
  const progress = `${signedCount}/${requiredCount}`;
  const intro = `Uma assinatura foi registrada para o relatório ${reportType} ${reportNumber} do projeto ${projectCode} - ${projectName}.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Relatório:</strong> ${reportType} ${reportNumber}</div>
        <div><strong>Data:</strong> ${reportDate}</div>
        <div><strong>Signatário:</strong> ${signerName} (${signerEmail})</div>
        <div><strong>Progresso:</strong> ${progress} assinaturas obrigatórias</div>
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema para acompanhar: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] ${reportType} ${reportNumber} recebeu uma assinatura`,
    text: [
      `Uma assinatura foi registrada para o relatório ${reportType} ${reportNumber}.`,
      '',
      `Projeto: ${projectCode} - ${projectName}`,
      `Data: ${reportDate}`,
      `Signatário: ${signerName} (${signerEmail})`,
      `Progresso: ${progress} assinaturas obrigatórias`,
      appUrl ? `Acesso: ${appUrl}` : '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildReportSignatureRequestEmailTemplate({
  projectCode,
  projectName,
  reportType,
  reportNumber,
  reportDate,
  signerName,
  signUrl,
  expiresLabel
}) {
  const title = 'Assinatura eletrônica disponível';
  const intro = `O relatório ${reportType} ${reportNumber} do projeto ${projectCode} - ${projectName} está disponível para assinatura eletrônica.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Signatário:</strong> ${signerName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Relatório:</strong> ${reportType} ${reportNumber}</div>
        <div><strong>Data:</strong> ${reportDate}</div>
        <div><strong>Prazo:</strong> ${expiresLabel}</div>
      </div>
    </div>
    <p style="margin:16px 0"><a href="${signUrl}" style="display:inline-block;background:#30503a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Assinar relatório</a></p>
    <p style="font-size:13px;line-height:1.7;margin:0 0 8px">Se preferir, copie e cole este link no navegador:</p>
    <p style="font-size:12px;line-height:1.7;word-break:break-all;margin:0">${signUrl}</p>
    ${privacyHtmlLine()}
  `;
  const footer = 'Este link é individual e foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Assinatura disponível - ${reportType} ${reportNumber}`,
    text: [
      `Olá, ${signerName}.`,
      '',
      `O relatório ${reportType} ${reportNumber} está disponível para assinatura eletrônica.`,
      '',
      `Projeto: ${projectCode} - ${projectName}`,
      `Data: ${reportDate}`,
      `Prazo: ${expiresLabel}`,
      '',
      `Assinar relatório: ${signUrl}`,
      '',
      privacyTextLine()
    ].join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildReportSignatureReminderEmailTemplate({
  projectCode,
  projectName,
  reportType,
  reportNumber,
  reportDate,
  signerName,
  signUrl,
  expiresLabel
}) {
  const title = 'Lembrete de assinatura eletrônica';
  const intro = `O relatório ${reportType} ${reportNumber} do projeto ${projectCode} - ${projectName} ainda está pendente de assinatura.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Signatário:</strong> ${signerName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Relatório:</strong> ${reportType} ${reportNumber}</div>
        <div><strong>Data:</strong> ${reportDate}</div>
        <div><strong>Link válido por:</strong> ${expiresLabel}</div>
      </div>
    </div>
    <p style="margin:16px 0"><a href="${signUrl}" style="display:inline-block;background:#30503a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Assinar relatório</a></p>
    <p style="font-size:13px;line-height:1.7;margin:0 0 8px">Se preferir, copie e cole este link no navegador:</p>
    <p style="font-size:12px;line-height:1.7;word-break:break-all;margin:0">${signUrl}</p>
    ${privacyHtmlLine()}
  `;
  const footer = 'Este lembrete foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Lembrete de assinatura - ${reportType} ${reportNumber}`,
    text: [
      `Olá, ${signerName}.`,
      '',
      `O relatório ${reportType} ${reportNumber} ainda está pendente de assinatura eletrônica.`,
      '',
      `Projeto: ${projectCode} - ${projectName}`,
      `Data: ${reportDate}`,
      `Link válido por: ${expiresLabel}`,
      '',
      `Assinar relatório: ${signUrl}`,
      '',
      privacyTextLine()
    ].join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildCalibrationReminderEmailTemplate({
  category,
  milestoneLabel,
  introLabel,
  equipments
}) {
  const safeCategory = escapeHtml(category || 'Equipamentos');
  const safeMilestoneLabel = escapeHtml(milestoneLabel || 'calibração');
  const safeIntroLabel = escapeHtml(introLabel || 'Verifique os equipamentos abaixo.');
  const safeEquipments = Array.isArray(equipments) ? equipments : [];
  const rows = safeEquipments.map(equipment => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(equipment.code || '---')}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(equipment.serialNumber || '---')}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(formatEmailDate(equipment.expiresAt) || '---')}</td>
    </tr>
  `).join('');
  const title = `Calibração de ${safeCategory}`;
  const intro = safeIntroLabel;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Categoria:</strong> ${safeCategory}</div>
        <div><strong>Situação:</strong> ${safeMilestoneLabel}</div>
        <div><strong>Equipamentos:</strong> ${safeEquipments.length}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px;background:#eef4ef;color:#30503a">Código</th>
          <th style="text-align:left;padding:8px;background:#eef4ef;color:#30503a">Serial</th>
          <th style="text-align:left;padding:8px;background:#eef4ef;color:#30503a">Vencimento</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${privacyHtmlLine()}
  `;
  const footer = 'Este lembrete foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Calibração ${milestoneLabel || ''} - ${category || 'Equipamentos'}`,
    text: [
      introLabel || 'Verifique os equipamentos abaixo.',
      '',
      `Categoria: ${category || 'Equipamentos'}`,
      `Situação: ${milestoneLabel || 'calibração'}`,
      `Equipamentos: ${safeEquipments.length}`,
      '',
      ...safeEquipments.map(equipment => [
        `Código: ${equipment.code || '---'}`,
        equipment.serialNumber ? `Serial: ${equipment.serialNumber}` : '',
        `Vencimento: ${formatEmailDate(equipment.expiresAt) || '---'}`
      ].filter(Boolean).join(' | ')),
      '',
      privacyTextLine()
    ].join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildCalibrationUpdatedEmailTemplate({
  category,
  equipment,
  previousExpiresAt
}) {
  const safeCategory = escapeHtml(category || 'Equipamentos');
  const safeCode = escapeHtml(equipment?.code || '---');
  const safeSerial = escapeHtml(equipment?.serialNumber || '---');
  const expiresAt = formatEmailDate(equipment?.expiresAt) || '---';
  const calibratedAt = formatEmailDate(equipment?.calibratedAt) || '---';
  const previousExpiration = previousExpiresAt ? formatEmailDate(previousExpiresAt) : '';
  const title = `Equipamento calibrado - ${safeCategory}`;
  const intro = `O equipamento ${safeCode} teve a calibração atualizada no sistema.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Categoria:</strong> ${safeCategory}</div>
        <div><strong>Código:</strong> ${safeCode}</div>
        <div><strong>Serial:</strong> ${safeSerial}</div>
        <div><strong>Calibrado em:</strong> ${escapeHtml(calibratedAt)}</div>
        <div><strong>Nova validade:</strong> ${escapeHtml(expiresAt)}</div>
        ${previousExpiration ? `<div><strong>Validade anterior:</strong> ${escapeHtml(previousExpiration)}</div>` : ''}
      </div>
    </div>
    ${privacyHtmlLine()}
  `;
  const footer = 'Esta notificação foi gerada automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Equipamento calibrado - ${category || 'Equipamentos'} ${equipment?.code || ''}`.trim(),
    text: [
      `O equipamento ${equipment?.code || '---'} teve a calibração atualizada no sistema.`,
      '',
      `Categoria: ${category || 'Equipamentos'}`,
      `Código: ${equipment?.code || '---'}`,
      equipment?.serialNumber ? `Serial: ${equipment.serialNumber}` : '',
      `Calibrado em: ${calibratedAt}`,
      `Nova validade: ${expiresAt}`,
      previousExpiration ? `Validade anterior: ${previousExpiration}` : '',
      '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildBatchReportSignatureReminderEmailTemplate({
  projectCode,
  projectName,
  signerName,
  reports,
  signUrl,
  expiresLabel
}) {
  const safeReports = Array.isArray(reports) ? reports : [];
  const title = 'Lembrete de assinaturas eletrônicas';
  const intro = `Existem ${safeReports.length} RDOs do projeto ${projectCode} - ${projectName} pendentes de assinatura.`;
  const reportRows = safeReports.map(report => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${report.reportType || 'RDO'} ${report.reportNumber || '---'}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${report.reportDate || '---'}</td>
    </tr>
  `).join('');
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Signatário:</strong> ${signerName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>RDOs pendentes:</strong> ${safeReports.length}</div>
        <div><strong>Link válido por:</strong> ${expiresLabel}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px;background:#eef4ef;color:#30503a">Relatório</th>
          <th style="text-align:left;padding:8px;background:#eef4ef;color:#30503a">Data</th>
        </tr>
      </thead>
      <tbody>${reportRows}</tbody>
    </table>
    <p style="margin:16px 0"><a href="${signUrl}" style="display:inline-block;background:#30503a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Assinar RDOs pendentes</a></p>
    <p style="font-size:13px;line-height:1.7;margin:0 0 8px">Se preferir, copie e cole este link no navegador:</p>
    <p style="font-size:12px;line-height:1.7;word-break:break-all;margin:0">${signUrl}</p>
    ${privacyHtmlLine()}
  `;
  const footer = 'Este lembrete foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Lembrete de assinatura - ${safeReports.length} RDOs pendentes`,
    text: [
      `Olá, ${signerName}.`,
      '',
      `${safeReports.length} RDOs do projeto ${projectCode} - ${projectName} ainda estão pendentes de assinatura eletrônica.`,
      '',
      ...safeReports.map(report => `- ${report.reportType || 'RDO'} ${report.reportNumber || '---'} - ${report.reportDate || '---'}`),
      '',
      `Link válido por: ${expiresLabel}`,
      `Assinar RDOs pendentes: ${signUrl}`,
      '',
      privacyTextLine()
    ].join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildReportSignatureCompletedEmailTemplate({
  projectCode,
  projectName,
  reportType,
  reportNumber,
  reportDate,
  signerName,
  signerEmail,
  finalDocumentHash,
  appUrl
}) {
  const title = 'Relatório assinado';
  const intro = `Todas as assinaturas obrigatórias do relatório ${reportType} ${reportNumber} foram concluídas.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Relatório:</strong> ${reportType} ${reportNumber}</div>
        <div><strong>Data:</strong> ${reportDate}</div>
        <div><strong>Último signatário:</strong> ${signerName} (${signerEmail})</div>
        ${finalDocumentHash ? `<div><strong>Hash PDF final:</strong> <span style="word-break:break-all">${finalDocumentHash}</span></div>` : ''}
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema para baixar o PDF assinado: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] ${reportType} ${reportNumber} assinado`,
    text: [
      `Todas as assinaturas obrigatórias do relatório ${reportType} ${reportNumber} foram concluídas.`,
      '',
      `Projeto: ${projectCode} - ${projectName}`,
      `Data: ${reportDate}`,
      `Último signatário: ${signerName} (${signerEmail})`,
      finalDocumentHash ? `Hash PDF final: ${finalDocumentHash}` : '',
      appUrl ? `Acesso: ${appUrl}` : '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildReleasedServiceReportsEmailTemplate({
  projectCode,
  projectName,
  rdoNumber,
  rdoDate,
  reports = [],
  appUrl
}) {
  const safeProjectCode = escapeHtml(projectCode || '---');
  const safeProjectName = escapeHtml(projectName || 'Sem projeto');
  const safeRdoNumber = escapeHtml(rdoNumber || '');
  const safeRdoDate = escapeHtml(rdoDate || '');
  const safeAppUrl = escapeHtml(appUrl || '');
  const rdoLabel = safeRdoNumber ? `RDO ${safeRdoNumber}` : 'RDO';
  const reportCount = reports.length;
  const plural = reportCount === 1 ? '' : 's';
  const title = 'Relatórios de serviço liberados';
  const intro = `Com a assinatura do ${rdoLabel}, ${reportCount} relatório${plural} de serviço do projeto ${safeProjectCode} - ${safeProjectName} foram liberados.`;
  const reportLines = reports.map(report => {
    const number = report.sequenceNumber == null ? '' : ` ${report.sequenceNumber}`;
    const date = report.reportDate ? ` - ${formatEmailDate(report.reportDate)}` : '';
    return `${report.reportType}${number}${date}`;
  });
  const reportItems = reportLines
    .map(line => `<li>${escapeHtml(line)}</li>`)
    .join('');
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Projeto:</strong> ${safeProjectCode} - ${safeProjectName}</div>
        <div><strong>RDO assinado:</strong> ${rdoLabel}</div>
        <div><strong>Data do RDO:</strong> ${safeRdoDate}</div>
        <div><strong>Relatórios liberados:</strong></div>
        <ul style="margin:8px 0 0 20px;padding:0">${reportItems}</ul>
      </div>
    </div>
    <p style="font-size:14px;line-height:1.7;margin:16px 0 0">Os PDFs dos relatórios liberados seguem anexados a este e-mail.</p>
    ${safeAppUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema: <a href="${safeAppUrl}" style="color:#30503a">${safeAppUrl}</a></p>` : ''}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Relatórios de serviço liberados - ${projectCode || 'Projeto'}`,
    text: [
      `Com a assinatura do ${rdoNumber ? `RDO ${rdoNumber}` : 'RDO'}, ${reportCount} relatório${plural} de serviço foram liberados.`,
      '',
      `Projeto: ${projectCode || '---'} - ${projectName || 'Sem projeto'}`,
      `Data do RDO: ${rdoDate || '-'}`,
      'Relatórios liberados:',
      ...reportLines.map(line => `- ${line}`),
      '',
      'Os PDFs dos relatórios liberados seguem anexados a este e-mail.',
      appUrl ? `Acesso: ${appUrl}` : '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildSurveyInviteEmailTemplate({ clientName, projectCode, projectName, surveyUrl, optOutUrl, expiresLabel }) {
  const title = 'Pesquisa de satisfação';
  const intro = `Gostaríamos de ouvir sua opinião sobre o projeto ${projectCode} - ${projectName}.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Cliente:</strong> ${clientName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Prazo:</strong> ${expiresLabel}</div>
      </div>
    </div>
    <p style="font-size:14px;line-height:1.7;margin:16px 0">Sua resposta nos ajuda a melhorar continuamente nossos serviços.</p>
    <p style="margin:0 0 16px"><a href="${surveyUrl}" style="display:inline-block;background:#30503a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Responder pesquisa</a></p>
    <p style="font-size:13px;line-height:1.7;margin:0 0 8px">Se preferir, copie e cole este link no navegador:</p>
    <p style="font-size:12px;line-height:1.7;word-break:break-all;margin:0 0 16px">${surveyUrl}</p>
    <p style="font-size:12px;line-height:1.7;margin:0 0 8px">Aviso de privacidade: ao responder, trataremos seu e-mail, respostas, comentários, IP e dados do navegador/dispositivo para gestão de qualidade e melhoria do serviço, com base em legítimo interesse. Canal de privacidade: <a href="mailto:${PRIVACY_CONTACT}" style="color:#30503a">${PRIVACY_CONTACT}</a>.</p>
    ${optOutUrl ? `<p style="font-size:12px;line-height:1.7;margin:0">Para parar de receber lembretes desta pesquisa, acesse: <a href="${optOutUrl}" style="color:#30503a">${optOutUrl}</a></p>` : ''}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Pesquisa de satisfação - ${projectCode}`,
    text: [
      `Gostaríamos de ouvir sua opinião sobre o projeto ${projectCode} - ${projectName}.`,
      '',
      `Cliente: ${clientName}`,
      `Projeto: ${projectCode} - ${projectName}`,
      `Prazo: ${expiresLabel}`,
      '',
      `Responder pesquisa: ${surveyUrl}`,
      `Aviso de privacidade: ao responder, trataremos seu e-mail, respostas, comentários, IP e dados do navegador/dispositivo para gestão de qualidade e melhoria do serviço, com base em legítimo interesse. Canal: ${PRIVACY_CONTACT}`,
      optOutUrl ? `Parar lembretes: ${optOutUrl}` : ''
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildSurveyReminderEmailTemplate({ clientName, projectCode, projectName, surveyUrl, optOutUrl, daysRemaining }) {
  const expiresLabel = daysRemaining > 0 ? `${daysRemaining} dia${daysRemaining !== 1 ? 's' : ''}` : 'em breve';
  const title = 'Lembrete: pesquisa de satisfação';
  const intro = `A pesquisa de satisfação do projeto ${projectCode} - ${projectName} ainda está disponível.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Cliente:</strong> ${clientName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Disponível por:</strong> ${expiresLabel}</div>
      </div>
    </div>
    <p style="margin:16px 0"><a href="${surveyUrl}" style="display:inline-block;background:#30503a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Responder pesquisa</a></p>
    <p style="font-size:12px;line-height:1.7;word-break:break-all;margin:0 0 16px">${surveyUrl}</p>
    <p style="font-size:12px;line-height:1.7;margin:0 0 8px">Aviso de privacidade: ao responder, trataremos seu e-mail, respostas, comentários, IP e dados do navegador/dispositivo para gestão de qualidade e melhoria do serviço, com base em legítimo interesse. Canal de privacidade: <a href="mailto:${PRIVACY_CONTACT}" style="color:#30503a">${PRIVACY_CONTACT}</a>.</p>
    ${optOutUrl ? `<p style="font-size:12px;line-height:1.7;margin:0">Para parar de receber lembretes desta pesquisa, acesse: <a href="${optOutUrl}" style="color:#30503a">${optOutUrl}</a></p>` : ''}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Lembrete de pesquisa de satisfação - ${projectCode}`,
    text: [
      `A pesquisa de satisfação do projeto ${projectCode} - ${projectName} ainda está disponível.`,
      '',
      `Cliente: ${clientName}`,
      `Disponível por: ${expiresLabel}`,
      '',
      `Responder pesquisa: ${surveyUrl}`,
      `Aviso de privacidade: ao responder, trataremos seu e-mail, respostas, comentários, IP e dados do navegador/dispositivo para gestão de qualidade e melhoria do serviço, com base em legítimo interesse. Canal: ${PRIVACY_CONTACT}`,
      optOutUrl ? `Parar lembretes: ${optOutUrl}` : ''
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildSurveyRespondedEmailTemplate({ clientName, projectCode, projectName, nps, appUrl }) {
  const title = 'Pesquisa de satisfação respondida';
  const intro = `O cliente ${clientName} respondeu a pesquisa de satisfação do projeto ${projectCode} - ${projectName}.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Cliente:</strong> ${clientName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>NPS:</strong> ${nps ?? '-'}</div>
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema em: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
    ${privacyHtmlLine()}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Pesquisa respondida - ${projectCode}`,
    text: [
      `O cliente ${clientName} respondeu a pesquisa de satisfação.`,
      '',
      `Projeto: ${projectCode} - ${projectName}`,
      `NPS: ${nps ?? '-'}`,
      appUrl ? `Acesso: ${appUrl}` : '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildSurveyExpiredEmailTemplate({ clientName, projectCode, projectName, emailTo, sentAt, expiresAt, appUrl }) {
  const title = 'Pesquisa de satisfação expirada';
  const intro = `A pesquisa de satisfação do projeto ${projectCode} - ${projectName} expirou sem resposta do cliente.`;
  const body = `
    <div style="background:#fff8f8;border:1px solid #f5c6c6;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Cliente:</strong> ${clientName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>E-mail enviado:</strong> ${emailTo}</div>
        <div><strong>Enviada em:</strong> ${sentAt}</div>
        <div><strong>Expirada em:</strong> ${expiresAt}</div>
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema para reenviar a pesquisa: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Pesquisa expirada - ${projectCode}`,
    text: [
      `A pesquisa de satisfação do projeto ${projectCode} - ${projectName} expirou sem resposta do cliente.`,
      '',
      `Cliente: ${clientName}`,
      `E-mail enviado: ${emailTo}`,
      `Enviada em: ${sentAt}`,
      `Expirada em: ${expiresAt}`,
      appUrl ? `Acesso: ${appUrl}` : '',
      privacyTextLine()
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}
