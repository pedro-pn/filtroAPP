import env from '../../config/env.js';

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
    occurredAt: now.toISOString()
  };
}

export async function captureOperationalError(error, {
  source = 'backend',
  level = 'error',
  context = {},
  webhookUrl = env.errorTrackingWebhookUrl,
  fetchFn = globalThis.fetch,
  logger = console,
  now = new Date()
} = {}) {
  if (!webhookUrl) return { sent: false, reason: 'not-configured' };
  if (typeof fetchFn !== 'function') return { sent: false, reason: 'fetch-unavailable' };

  const payload = operationalErrorPayload(error, { source, level, context, now });
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
