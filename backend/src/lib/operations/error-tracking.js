import env from '../../config/env.js';
import { appVersion } from './app-version.js';
import { sendOperationalErrorEmail } from './alert-email.js';

const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 8000;

function text(value, maxLength = MAX_MESSAGE_LENGTH) {
  return String(value || '').slice(0, maxLength);
}

function errorMessage(error) {
  return text(error?.message || error || 'Erro operacional.');
}

function errorStack(error) {
  return error?.stack ? text(error.stack, MAX_STACK_LENGTH) : null;
}

function jsonSafe(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return item.toString();
      if (item instanceof Error) {
        return {
          name: item.name,
          message: item.message,
          stack: item.stack
        };
      }
      return item;
    }));
  } catch {
    return { unserializable: true };
  }
}

export function errorTrackingStatus(config = env) {
  return {
    enabled: Boolean(config.errorTrackingWebhookUrl),
    provider: config.errorTrackingProvider || 'webhook'
  };
}

export function operationalErrorPayload(error, {
  source = 'backend',
  level = 'error',
  context = {},
  now = new Date()
} = {}) {
  return {
    source,
    level,
    provider: env.errorTrackingProvider || 'webhook',
    message: errorMessage(error),
    name: text(error?.name || 'Error', 120),
    stack: errorStack(error),
    context: jsonSafe(context),
    version: appVersion(),
    environment: env.nodeEnv || null,
    occurredAt: now.toISOString()
  };
}

async function postErrorWebhook(payload, { webhookUrl, fetchFn, logger }) {
  if (!webhookUrl) return { sent: false, reason: 'not-configured' };
  if (typeof fetchFn !== 'function') return { sent: false, reason: 'fetch-unavailable' };

  try {
    const response = await fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      return { sent: false, reason: 'http-error', status: response.status };
    }
    return { sent: true };
  } catch (sendError) {
    logger.warn?.('Falha ao enviar erro para rastreamento operacional.', sendError);
    return { sent: false, reason: 'send-error' };
  }
}

// Envia o erro para os canais configurados: webhook (todas as ocorrências) e
// e-mail (com controle de repetição). `email: false` desliga o e-mail para
// origens que não devem acionar pessoas, como erros reportados pelo navegador
// na rota pública /api/operations/client-errors.
export async function captureOperationalError(error, {
  source = 'backend',
  level = 'error',
  context = {},
  webhookUrl = env.errorTrackingWebhookUrl,
  fetchFn = globalThis.fetch,
  logger = console,
  now = new Date(),
  email = true,
  emailSender = sendOperationalErrorEmail
} = {}) {
  const payload = operationalErrorPayload(error, { source, level, context, now });
  const [webhook, emailResult] = await Promise.all([
    postErrorWebhook(payload, { webhookUrl, fetchFn, logger }),
    email
      ? Promise.resolve()
        .then(() => emailSender(payload, { logger }))
        .catch(emailError => {
          logger.warn?.('Falha ao enviar e-mail de erro operacional.', emailError?.message || emailError);
          return { sent: false, reason: 'send-error' };
        })
      : Promise.resolve({ sent: false, reason: 'disabled' })
  ]);

  const sent = webhook.sent === true || emailResult?.sent === true;
  return {
    sent,
    ...(sent ? {} : { reason: webhook.reason, ...(webhook.status ? { status: webhook.status } : {}) }),
    webhook,
    email: emailResult
  };
}
