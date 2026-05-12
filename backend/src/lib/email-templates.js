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

export function buildReportRejectedByClientEmailTemplate({ projectCode, projectName, reportType, reportNumber, reportDate, comment, appUrl }) {
  const title = 'Relatório reprovado pelo cliente';
  const intro = `O relatório ${reportType} ${reportNumber} do projeto ${projectCode} - ${projectName} foi reprovado pelo cliente e precisa ser revisado.`;
  const body = `
    <div style="background:#fff8f8;border:1px solid #f5c6c6;border-radius:12px;padding:16px">
      <div style="font-size:14px;line-height:1.8">
        <div><strong>Projeto:</strong> ${projectCode} - ${projectName}</div>
        <div><strong>Relatório:</strong> ${reportType} ${reportNumber}</div>
        <div><strong>Data:</strong> ${reportDate}</div>
        ${comment ? `<div style="margin-top:12px"><strong>Justificativa do cliente:</strong><br><span style="white-space:pre-wrap">${comment}</span></div>` : ''}
      </div>
    </div>
    ${appUrl ? `<p style="font-size:14px;line-height:1.7;margin:16px 0 0">Acesse o sistema para revisar: <a href="${appUrl}" style="color:#30503a">${appUrl}</a></p>` : ''}
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] ${reportType} ${reportNumber} reprovado pelo cliente`,
    text: [
      `O relatório ${reportType} ${reportNumber} foi reprovado pelo cliente.`,
      '',
      `Projeto: ${projectCode} - ${projectName}`,
      `Data: ${reportDate}`,
      comment ? `Justificativa: ${comment}` : '',
      appUrl ? `Acesso: ${appUrl}` : ''
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
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
      appUrl ? `Acesso: ${appUrl}` : ''
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
      `Assinar relatório: ${signUrl}`
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
      appUrl ? `Acesso: ${appUrl}` : ''
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
  `;
  const footer = 'Este envio foi gerado automaticamente pelo sistema Filtrovali.';

  return {
    subject: `[Filtrovali] Pesquisa respondida - ${projectCode}`,
    text: [
      `O cliente ${clientName} respondeu a pesquisa de satisfação.`,
      '',
      `Projeto: ${projectCode} - ${projectName}`,
      `NPS: ${nps ?? '-'}`,
      appUrl ? `Acesso: ${appUrl}` : ''
    ].filter(Boolean).join('\n'),
    html: wrapEmailHtml({ title, intro, body, footer })
  };
}
