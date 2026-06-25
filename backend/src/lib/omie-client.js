/*
 * Cliente mínimo da API Omie (JSON over HTTP POST).
 * Toda chamada: { call, app_key, app_secret, param: [ {...} ] }.
 * Paginação típica: param.pagina / param.registros_por_pagina; filtro incremental por data.
 */

import env from '../config/env.js';

const BASE_URL = 'https://app.omie.com.br/api/v1';

export function omieConfigured() {
  return Boolean(env.omieAppKey && env.omieAppSecret);
}

/**
 * Faz uma chamada à API Omie.
 * @param {string} path  caminho do recurso (ex.: '/geral/projetos/') ou URL completa
 * @param {string} call  nome do método (ex.: 'ListarProjetos')
 * @param {object|object[]} [param]  parâmetros (objeto vira [objeto])
 * @param {object} [creds]  { appKey, appSecret } para sobrescrever o env
 */
export async function omieCall(path, call, param = {}, creds = {}) {
  const appKey = creds.appKey || env.omieAppKey;
  const appSecret = creds.appSecret || env.omieAppSecret;
  if (!appKey || !appSecret) {
    throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET não configurados.');
  }
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const body = {
    call,
    app_key: appKey,
    app_secret: appSecret,
    param: Array.isArray(param) ? param : [param]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  // Erros de negócio do Omie vêm com faultstring mesmo em HTTP 200/500.
  if (!response.ok || json?.faultstring) {
    const error = new Error(`Omie ${call} falhou: ${json?.faultstring || `HTTP ${response.status}`}`);
    error.status = response.status;
    error.body = json;
    throw error;
  }
  return json;
}
