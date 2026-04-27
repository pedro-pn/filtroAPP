export const EMAIL_LOGO_CID = 'filtrovali-logo-colorido';

function wrapEmailHtml({ title, intro, body, footer }) {
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
      <div style="border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:20px">
        <img src="cid:${EMAIL_LOGO_CID}" alt="Filtrovali" style="display:block;max-width:220px;width:100%;height:auto">
      </div>
      <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:#243d2c">${title}</h1>
      <p style="font-size:14px;line-height:1.7;margin:0 0 16px">${intro}</p>
      ${body}
      <p style="font-size:12px;line-height:1.6;color:#6b7280;margin-top:24px">${footer}</p>
    </div>
  `.trim();
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
      appUrl ? `Acesso: ${appUrl}` : ''
    ].filter(Boolean).join('\n'),
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
      'Depois do primeiro acesso, a senha pode ser alterada na área de conta.'
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
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: '[Filtrovali] Novo projeto vinculado',
    text: [
      `Um novo projeto foi vinculado à conta do cliente ${clientName}.`,
      '',
      `Projeto: ${projectCode} - ${projectName}`,
      `Contrato: ${contractCode || '---'}`,
      appUrl ? `Acesso: ${appUrl}` : ''
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
      appUrl ? `Acesso: ${appUrl}` : ''
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}
