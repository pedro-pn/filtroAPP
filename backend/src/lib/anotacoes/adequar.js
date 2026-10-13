import { createHash } from 'node:crypto';

import OpenAI from 'openai';

import env from '../../config/env.js';
import { createKeyedTtlCache } from '../ttl-cache.js';
import { verificarAderencia } from './aderencia.js';
import { montarInstrucoes } from './instrucoes.js';

export const MAX_CARACTERES = 4000;
const MAX_TOKENS_SAIDA = 4000;
// Mesma anotação, mesmo usuário: reaproveita o resultado (e a chamada em andamento) por 10 min.
const cacheResultados = createKeyedTtlCache(10 * 60 * 1000, 200);

let clientePadrao = null;

export function adequacaoConfigurada() {
  return Boolean(env.openaiApiKey);
}

function cliente() {
  if (!clientePadrao) {
    clientePadrao = new OpenAI({ apiKey: env.openaiApiKey, timeout: env.openaiTimeoutMs, maxRetries: 1 });
  }
  return clientePadrao;
}

function erro(status, message, codigo) {
  return Object.assign(new Error(message), { status, codigo });
}

function hash(texto) {
  return createHash('sha256').update(texto).digest('hex');
}

/** Converte falhas do SDK em respostas padronizadas (sem detalhes internos para o usuário). */
export function traduzirErro(error) {
  if (error?.status && error?.codigo) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return erro(504, 'A OpenAI demorou demais para responder. Tente novamente.', 'TIMEOUT');
  }
  if (error instanceof OpenAI.RateLimitError) {
    return erro(503, 'O limite de uso da OpenAI foi atingido. Tente novamente em alguns minutos.', 'LIMITE_OPENAI');
  }
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return erro(503, 'A integração com a OpenAI não está configurada corretamente. Avise o administrador.', 'CONFIGURACAO');
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return erro(503, 'Não foi possível conectar à OpenAI. Tente novamente.', 'CONEXAO');
  }
  return erro(502, 'A OpenAI não conseguiu adequar a anotação agora. Tente novamente.', 'FALHA_OPENAI');
}

function registrarUso(response, inicio) {
  // Só métricas: nunca o texto da anotação nem o resultado.
  const u = response?.usage || {};
  console.info(JSON.stringify({
    evento: 'anotacao_adequada',
    modelo: response?.model,
    status: response?.status,
    tokensEntrada: u.input_tokens ?? null,
    tokensSaida: u.output_tokens ?? null,
    tokensRaciocinio: u.output_tokens_details?.reasoning_tokens ?? null,
    ms: Date.now() - inicio
  }));
}

async function chamarOpenAI(anotacao, { usuarioId, openai }) {
  const inicio = Date.now();
  const response = await openai.responses.create({
    model: env.openaiModel,
    instructions: montarInstrucoes(),
    input: anotacao,
    reasoning: { effort: env.openaiReasoningEffort },
    max_output_tokens: MAX_TOKENS_SAIDA,
    store: false,
    // Identificador anônimo do usuário (hash), recomendado pela OpenAI para detecção de abuso.
    ...(usuarioId ? { safety_identifier: hash(`filtrovali:${usuarioId}`).slice(0, 32) } : {})
  });
  registrarUso(response, inicio);
  if (response.status === 'incomplete') {
    throw erro(502, 'A resposta da OpenAI veio incompleta. Tente com uma anotação menor.', 'INCOMPLETA');
  }
  const texto = String(response.output_text || '').trim();
  if (!texto) throw erro(502, 'A OpenAI não devolveu texto. Tente novamente.', 'VAZIA');
  return texto;
}

/**
 * Adequa uma anotação de campo ao padrão do relatório. A anotação original não é alterada aqui:
 * o resultado volta para a tela, onde o usuário revisa e decide se aplica.
 */
export async function adequarAnotacao(anotacao, { usuarioId, openai } = {}) {
  if (!adequacaoConfigurada() && !openai) {
    throw erro(503, 'A adequação de anotações não está habilitada neste servidor.', 'DESABILITADA');
  }
  const texto = String(anotacao ?? '').trim();
  if (!texto) throw erro(400, 'Escreva a anotação antes de adequar.', 'VAZIA');
  if (texto.length > MAX_CARACTERES) {
    throw erro(400, `A anotação tem ${texto.length} caracteres; o limite é ${MAX_CARACTERES}.`, 'GRANDE_DEMAIS');
  }
  const chave = hash(`${usuarioId || ''}\n${env.openaiModel}\n${texto}`);
  try {
    const textoFormatado = await cacheResultados.get(chave, () => chamarOpenAI(texto, { usuarioId, openai: openai || cliente() }));
    return { textoFormatado, avisos: verificarAderencia(texto, textoFormatado) };
  } catch (error) {
    const traduzido = traduzirErro(error);
    if (traduzido !== error) console.warn(JSON.stringify({ evento: 'anotacao_falhou', codigo: traduzido.codigo, status: error?.status ?? null }));
    throw traduzido;
  }
}

export function limparCacheAdequacao() {
  cacheResultados.clear();
}
