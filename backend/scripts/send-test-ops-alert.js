// Envia um erro de teste pelos canais de alerta configurados (e-mail e/ou
// webhook) para provar que o alerta chega a uma pessoa.
//   npm run ops:test-alert
// Sai com código 0 se ao menos um canal entregou, 1 caso contrário.
import env from '../src/config/env.js';
import { alertEmailRecipients } from '../src/lib/operations/alert-email.js';
import { captureOperationalError } from '../src/lib/operations/error-tracking.js';

const recipients = alertEmailRecipients(env);
console.log(`E-mail: ${recipients.length ? `${recipients.length} destinatário(s)` : 'não configurado (OPERATIONS_ALERT_EMAILS)'}`);
console.log(`Webhook de erros: ${env.errorTrackingWebhookUrl ? 'configurado' : 'não configurado (ERROR_TRACKING_WEBHOOK_URL)'}`);
if (env.sendClientEmails === false) {
  console.log('Aviso: SEND_CLIENT_EMAILS=false bloqueia todo e-mail de saída neste ambiente.');
}

const error = new Error(`Teste de alerta operacional disparado manualmente em ${new Date().toISOString()}.`);
error.name = 'OperationalAlertTest';

const result = await captureOperationalError(error, {
  source: 'ops.test-alert',
  context: { process: 'script' }
});

console.log(`Resultado e-mail: ${JSON.stringify(result.email)}`);
console.log(`Resultado webhook: ${JSON.stringify(result.webhook)}`);
console.log(result.sent ? 'OK: alerta entregue a pelo menos um canal.' : 'FALHA: nenhum canal entregou o alerta.');
process.exit(result.sent ? 0 : 1);
