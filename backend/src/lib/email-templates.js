function wrapEmailHtml({ title, intro, body, footer }) {
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
      <div style="border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:20px">
        <div style="font-size:22px;font-weight:700;color:#30503a">Filtrovali</div>
      </div>
      <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:#243d2c">${title}</h1>
      <p style="font-size:14px;line-height:1.7;margin:0 0 16px">${intro}</p>
      ${body}
      <p style="font-size:12px;line-height:1.6;color:#6b7280;margin-top:24px">${footer}</p>
    </div>
  `.trim();
}

export function buildTestEmailTemplate({ host, port, user, timestamp }) {
  const title = 'Teste de conexao SMTP';
  const intro = 'Este e um e-mail de teste gerado pelo diagnostico do sistema Filtrovali.';
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Servidor:</strong> ${host}:${port}</div>
        <div><strong>Conta:</strong> ${user}</div>
        <div><strong>Data:</strong> ${timestamp}</div>
      </div>
    </div>
  `;
  const footer = 'Se voce recebeu esta mensagem, a configuracao SMTP esta funcionando corretamente.';

  return {
    subject: '[Filtrovali] Teste de conexao SMTP',
    text: [
      'Este e um e-mail de teste gerado pelo diagnostico do sistema Filtrovali.',
      '',
      'Se voce recebeu esta mensagem, a configuracao SMTP esta funcionando corretamente.',
      '',
      `Servidor: ${host}:${port}`,
      `Conta: ${user}`,
      `Data: ${timestamp}`
    ].join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildReportApprovedEmailTemplate({ projectCode, projectName, clientName, reportType, reportNumber, reportDate, appUrl }) {
  const title = 'Relatorio aprovado pelo gestor';
  const intro = `O relatorio ${reportType} ${reportNumber} do projeto ${projectCode} - ${projectName} foi aprovado e esta disponivel no sistema.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Cliente:</strong> ${clientName}</div>
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Relatorio:</strong> ${reportType} ${reportNumber}</div>
        <div><strong>Data:</strong> ${reportDate}</div>
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema em: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] ${reportType} ${reportNumber} aprovado`,
    text: [
      `O relatorio ${reportType} ${reportNumber} foi aprovado.`,
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
  const title = 'Recuperacao de senha';
  const intro = `Recebemos uma solicitacao para redefinir a senha da conta ${userName}.`;
  const body = `
    <p style="font-size:14px;line-height:1.7;margin:0 0 16px">Use o link abaixo para cadastrar uma nova senha:</p>
    <p style="margin:0 0 16px"><a href="${resetUrl}" style="display:inline-block;background:#30503a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Redefinir senha</a></p>
    <p style="font-size:13px;line-height:1.7;margin:0 0 8px">Se preferir, copie e cole este link no navegador:</p>
    <p style="font-size:12px;line-height:1.7;word-break:break-all;margin:0">${resetUrl}</p>
  `;
  const footer = `Este link expira em ${expiresLabel}. Se voce nao solicitou esta alteracao, ignore este e-mail.`;

  return {
    subject: '[Filtrovali] Recuperacao de senha',
    text: [
      `Recebemos uma solicitacao para redefinir a senha da conta ${userName}.`,
      '',
      `Use este link para redefinir a senha: ${resetUrl}`,
      '',
      `Este link expira em ${expiresLabel}.`,
      'Se voce nao solicitou esta alteracao, ignore este e-mail.'
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
        <div><strong>Usuario:</strong> ${cnpj}</div>
        <div><strong>Senha inicial:</strong> ${password}</div>
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema em: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
  `;
  const footer = 'Guarde estas informacoes com seguranca. Depois do primeiro acesso, a senha pode ser alterada na area de conta.';

  return {
    subject: '[Filtrovali] Seu acesso foi criado',
    text: [
      `A conta do cliente ${clientName} foi criada no sistema Filtrovali.`,
      '',
      `Projeto inicial: ${projectCode} - ${projectName}`,
      `Usuario: ${cnpj}`,
      `Senha inicial: ${password}`,
      appUrl ? `Acesso: ${appUrl}` : '',
      '',
      'Depois do primeiro acesso, a senha pode ser alterada na area de conta.'
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildClientProjectLinkedEmailTemplate({ clientName, appUrl, projectCode, projectName, contractCode }) {
  const title = 'Novo projeto vinculado a sua conta';
  const intro = `Um novo projeto foi vinculado a conta do cliente ${clientName} no sistema Filtrovali.`;
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
      `Um novo projeto foi vinculado a conta do cliente ${clientName}.`,
      '',
      `Projeto: ${projectCode} - ${projectName}`,
      `Contrato: ${contractCode || '---'}`,
      appUrl ? `Acesso: ${appUrl}` : ''
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}

export function buildClientAccessReminderEmailTemplate({ clientName, cnpj, appUrl, projectCount }) {
  const title = 'Acesso do cliente';
  const intro = `Segue um lembrete de acesso da conta do cliente ${clientName} no sistema Filtrovali.`;
  const body = `
    <div style="background:#f8faf8;border:1px solid #d7dfda;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Usuario:</strong> ${cnpj}</div>
        <div><strong>Projetos vinculados:</strong> ${projectCount}</div>
      </div>
    </div>
    <p style="font-size:14px;line-height:1.7;margin:16px 0 0">Caso a senha nao esteja disponivel, use a opcao "Esqueci minha senha" na tela de login.</p>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema em: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: '[Filtrovali] Lembrete de acesso',
    text: [
      `Segue um lembrete de acesso da conta do cliente ${clientName}.`,
      '',
      `Usuario: ${cnpj}`,
      `Projetos vinculados: ${projectCount}`,
      'Se necessario, use a opcao "Esqueci minha senha" na tela de login.',
      appUrl ? `Acesso: ${appUrl}` : ''
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}
