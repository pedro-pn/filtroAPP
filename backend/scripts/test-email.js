import env from '../src/config/env.js';
import { buildTestEmailTemplate } from '../src/lib/email-templates.js';
import { createMailerTransport, getMissingMailerConfig } from '../src/lib/mailer.js';

function printCommonGuidance() {
  console.log('Configuracao esperada do Exchange Online:');
  console.log('  - Exchange Online: SMTP_HOST=smtp.office365.com e SMTP_PORT=587');
  console.log('  - Use SMTP_AUTH_MODE=oauth2 e SMTP_SECURE=false (STARTTLS)');
  console.log('  - A aplicacao Entra precisa de SMTP.SendAsApp e acesso a caixa remetente');
  console.log('  - O SMTP autenticado precisa estar habilitado para a caixa remetente');
  console.log('');
}

function diagnose(err) {
  const msg = err?.message || '';
  console.error(`  Erro: ${msg}\n`);

  if (msg.includes('ECONNREFUSED')) {
    console.error('  DIAGNOSTICO: conexao recusada pelo host/porta informados.');
    console.error('  -> Verifique SMTP_HOST, SMTP_PORT e firewall da rede.\n');
  } else if (msg.includes('ETIMEDOUT')) {
    console.error('  DIAGNOSTICO: timeout ao tentar alcancar o servidor SMTP.');
    console.error('  -> Verifique rota de rede, DNS, firewall e se o host esta acessivel.\n');
  } else if (msg.includes('invalid_client') || msg.includes('AADSTS')) {
    console.error('  DIAGNOSTICO: o Microsoft Entra recusou as credenciais da aplicacao.');
    console.error('  -> Confira MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID e o VALOR do client secret.');
    console.error('  -> Confirme se o segredo ainda esta valido.\n');
  } else if (msg.includes('535') || msg.includes('Authentication') || msg.includes('credentials') || msg.includes('EAUTH')) {
    console.error('  DIAGNOSTICO: falha de autenticacao.');
    console.error('  -> Verifique SMTP_USER e as credenciais da aplicacao Microsoft Entra.');
    console.error('  -> Confirme SMTP.SendAsApp, o service principal no Exchange e a permissao da caixa.');
    console.error('  -> Confirme se SMTP autenticado esta habilitado para a conta.\n');
  } else if (msg.includes('self signed') || msg.includes('certificate') || msg.includes('ESOCKET')) {
    console.error('  DIAGNOSTICO: problema de TLS/certificado ou handshake.');
    console.error('  -> Para Exchange on-premises, confirme certificado e STARTTLS.');
    console.error('  -> Para porta 587, normalmente SMTP_SECURE deve ficar false.\n');
  } else if (msg.includes('550') || msg.includes('relay')) {
    console.error('  DIAGNOSTICO: relay negado pelo servidor.');
    console.error('  -> Confirme permissao de envio para a conta ou IP da aplicacao.\n');
  } else {
    console.error('  DIAGNOSTICO: falha nao classificada automaticamente.');
    console.error('  -> Codigo do erro:', err?.code || 'desconhecido');
    console.error('  -> Stack:', err?.stack || 'indisponivel');
    console.error('');
  }

  printCommonGuidance();
}

async function runTest() {
  console.log('\nTeste de E-mail OAuth2 - Microsoft Exchange Online\n');
  console.log(`  Host:       ${env.smtpHost || '(nao definido)'}`);
  console.log(`  Porta:      ${env.smtpPort}`);
  console.log(`  Secure:     ${env.smtpSecure ? 'true' : 'false'}`);
  console.log(`  Auth:       ${env.smtpAuthMode}`);
  console.log(`  Usuario:    ${env.smtpUser || '(nao definido)'}`);
  if (env.smtpAuthMode === 'oauth2') {
    console.log(`  Tenant ID:  ${env.microsoftTenantId || '(nao definido)'}`);
    console.log(`  Client ID:  ${env.microsoftClientId || '(nao definido)'}`);
  }
  console.log(`  Destino:    ${env.smtpTestDest || '(nao definido)'}`);
  console.log('');

  const missing = getMissingMailerConfig();
  if (missing.length || !env.smtpTestDest) {
    console.error('Configuracao SMTP incompleta.\n');
    if (missing.length) console.error(`Campos obrigatorios ausentes: ${missing.join(', ')}`);
    if (!env.smtpTestDest) console.error('Campo obrigatorio ausente: smtpTestDest');
    console.error('\nPreencha backend/.env antes de rodar este script.\n');
    printCommonGuidance();
    process.exit(1);
  }

  const transporter = createMailerTransport();

  console.log('[ 1/2 ] Verificando conexao com o servidor SMTP...');
  try {
    await transporter.verify();
    console.log('  OK  Conexao estabelecida com sucesso.\n');
  } catch (err) {
    console.error('  FALHA  Nao foi possivel verificar a conexao.\n');
    diagnose(err);
    process.exit(1);
  }

  console.log(`[ 2/2 ] Enviando e-mail de teste para ${env.smtpTestDest}...`);
  try {
    const timestamp = new Date().toLocaleString('pt-BR');
    const template = buildTestEmailTemplate({
      host: env.smtpHost,
      port: env.smtpPort,
      user: env.smtpUser,
      timestamp
    });
    const info = await transporter.sendMail({
      to: env.smtpTestDest,
      from: env.smtpFrom,
      ...template
    });

    console.log('  OK  E-mail enviado com sucesso.');
    console.log(`     Message ID: ${info.messageId}`);
    if (info.response) console.log(`     Resposta:   ${info.response}`);
    console.log('\nTudo OK. O servico de e-mail esta pronto para integracao.\n');
  } catch (err) {
    console.error('  FALHA  Nao foi possivel enviar o e-mail.\n');
    diagnose(err);
    process.exit(1);
  }
}

runTest();
