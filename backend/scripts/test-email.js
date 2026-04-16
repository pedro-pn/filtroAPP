import env from '../src/config/env.js';
import { buildTestEmailTemplate } from '../src/lib/email-templates.js';
import { createMailerTransport, getMissingMailerConfig } from '../src/lib/mailer.js';

function printCommonGuidance() {
  console.log('Como descobrir as configuracoes do Exchange:');
  console.log('  - Exchange Online: SMTP_HOST=smtp.office365.com e SMTP_PORT=587');
  console.log('  - Exchange on-premises: confirme host/porta com o TI');
  console.log('  - Para Exchange na porta 587, normalmente use SMTP_SECURE=false (STARTTLS)');
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
  } else if (msg.includes('535') || msg.includes('Authentication') || msg.includes('credentials') || msg.includes('EAUTH')) {
    console.error('  DIAGNOSTICO: falha de autenticacao.');
    console.error('  -> Verifique SMTP_USER e SMTP_PASS.');
    console.error('  -> Em M365, confirme se SMTP AUTH esta habilitado para a conta.');
    console.error('  -> Se houver MFA, use App Password se a politica permitir.\n');
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
  console.log('\nTeste de Conexao SMTP - Microsoft Exchange\n');
  console.log(`  Host:       ${env.smtpHost || '(nao definido)'}`);
  console.log(`  Porta:      ${env.smtpPort}`);
  console.log(`  Secure:     ${env.smtpSecure ? 'true' : 'false'}`);
  console.log(`  Usuario:    ${env.smtpUser || '(nao definido)'}`);
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
