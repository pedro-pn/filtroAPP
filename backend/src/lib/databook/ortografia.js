import { execFile } from 'node:child_process';

import env from '../../config/env.js';

// Termos do ramo que o dicionário pt-BR não conhece (comparação sem acento, minúsculas).
const GLOSSARIO = new Set([
  'boroscopia', 'boroscopio', 'videoboroscopia', 'flushing', 'flushings', 'desengraxe', 'passivante', 'sequestrante',
  'neutralizante', 'spool', 'spools', 'termovacuo', 'manometro', 'manometros', 'skid', 'skids', 'hpu', 'apv', 'apvs',
  'ulq', 'uth', 'ufg', 'rdo', 'rlq', 'rcpu', 'rtp', 'rlm', 'dds', 'epi', 'epis', 'nas', 'iso', 'ppm', 'offshore',
  'onshore', 'tag', 'tags', 'flange', 'flanges', 'cunife', 'inox', 'standby', 'stand', 'by', 'checklist', 'layout',
  'carepas', 'carepa', 'decapagem', 'hidrojateamento', 'hidrojato', 'mangote', 'mangotes', 'niple', 'niples', 'tie', 'in'
]);

// Campos de texto livre que a revisão ortográfica pode tocar (nunca tags, horários, números ou medições).
export const CAMPOS_TEXTO_LIVRE = {
  atividade: 'Atividades',
  obs: 'OBS do serviço',
  comentario: 'Comentário da jornada',
  stand_by: 'Motivo do stand-by'
};

function semAcento(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Palavra que vale verificar: minúscula, só letras, 3+ letras, fora do glossário (nomes e siglas ficam de fora). */
export function palavraVerificavel(palavra) {
  const p = String(palavra || '');
  if (p.length < 3 || !/^\p{L}+$/u.test(p)) return false;
  if (p !== p.toLocaleLowerCase('pt-BR')) return false; // nome próprio, sigla ou início de frase com maiúscula
  return !GLOSSARIO.has(semAcento(p));
}

/** Percorre os textos livres do Data Book: [{ id, data, campo, texto }]. */
export function textosLivres(dados) {
  const out = [];
  for (const [d, dia] of (dados.dias || []).entries()) {
    (dia.atividades || []).forEach((a, i) => out.push({ id: `${d}:a:${i}`, data: dia.data, campo: 'atividade', texto: a.texto || '' }));
    (dia.servicos || []).forEach((s, i) => { if (s.obs) out.push({ id: `${d}:o:${i}`, data: dia.data, campo: 'obs', texto: s.obs }); });
    if (dia.comentario) out.push({ id: `${d}:c`, data: dia.data, campo: 'comentario', texto: dia.comentario });
    if (dia.stand_by?.motivo) out.push({ id: `${d}:s`, data: dia.data, campo: 'stand_by', texto: dia.stand_by.motivo });
  }
  return out;
}

/**
 * Interpreta a saída do `hunspell -a` (uma linha de entrada → linhas de resultado + linha em branco).
 * "& palavra n offset: s1, s2" (com sugestões) e "# palavra offset" (sem sugestões).
 */
export function interpretarHunspell(saida, quantidadeLinhas) {
  const blocos = String(saida).split('\n').slice(1).join('\n').split(/\n\n/);
  const resultado = [];
  for (let i = 0; i < quantidadeLinhas; i += 1) {
    const erros = [];
    for (const linha of String(blocos[i] || '').split('\n')) {
      const comSugestao = linha.match(/^& (\S+) \d+ \d+: (.*)$/);
      const semSugestao = linha.match(/^# (\S+) \d+$/);
      if (comSugestao) erros.push({ palavra: comSugestao[1], sugestoes: comSugestao[2].split(', ').filter(s => !s.includes(' ')).slice(0, 4) });
      else if (semSugestao) erros.push({ palavra: semSugestao[1], sugestoes: [] });
    }
    resultado.push(erros);
  }
  return resultado;
}

function rodarHunspell(linhas) {
  return new Promise((resolve, reject) => {
    // "^" no início de cada linha impede que o texto seja lido como comando do modo pipe.
    const entrada = linhas.map(l => `^${l.replace(/[\r\n]+/g, ' ')}`).join('\n') + '\n';
    const proc = execFile(env.databookHunspell, ['-d', env.databookHunspellDict, '-a', '-i', 'utf-8'],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    proc.stdin.end(entrada, 'utf8');
  });
}

/**
 * Possíveis erros de ortografia nos textos livres, agrupados por palavra. Sem Hunspell instalado
 * devolve { disponivel: false } — a revisão segue sem a verificação.
 */
export async function verificarOrtografia(dados, { executar = rodarHunspell } = {}) {
  const textos = textosLivres(dados).filter(t => t.texto.trim());
  if (!textos.length) return { disponivel: true, palavras: [] };
  let porLinha;
  try {
    porLinha = interpretarHunspell(await executar(textos.map(t => t.texto)), textos.length);
  } catch {
    return { disponivel: false, palavras: [] };
  }
  const porPalavra = new Map();
  porLinha.forEach((erros, i) => {
    for (const { palavra, sugestoes } of erros) {
      if (!palavraVerificavel(palavra)) continue;
      const item = porPalavra.get(palavra) || { palavra, sugestoes, ocorrencias: [] };
      const t = textos[i];
      const pos = t.texto.indexOf(palavra);
      item.ocorrencias.push({
        data: t.data, campo: CAMPOS_TEXTO_LIVRE[t.campo],
        trecho: t.texto.slice(Math.max(0, pos - 40), pos + palavra.length + 40).trim()
      });
      porPalavra.set(palavra, item);
    }
  });
  return { disponivel: true, palavras: [...porPalavra.values()].sort((a, b) => a.palavra.localeCompare(b.palavra, 'pt-BR')) };
}

function trocarPalavra(texto, palavra, por) {
  if (!texto) return texto;
  const escapada = palavra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return texto.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapada}(?![\\p{L}\\p{N}])`, 'gu'), por);
}

/** Aplica as correções escolhidas na revisão, palavra inteira, só nos textos livres. */
export function aplicarCorrecoes(dados, correcoes = []) {
  const validas = (Array.isArray(correcoes) ? correcoes : [])
    .filter(c => typeof c?.palavra === 'string' && typeof c?.por === 'string')
    .map(c => ({ palavra: c.palavra.trim(), por: c.por.trim() }))
    .filter(c => palavraVerificavel(c.palavra) && /^[\p{L} ]{1,60}$/u.test(c.por) && c.por !== c.palavra);
  if (!validas.length) return dados;
  const out = structuredClone(dados);
  const corrigir = texto => validas.reduce((t, c) => trocarPalavra(t, c.palavra, c.por), texto);
  for (const dia of out.dias || []) {
    for (const a of dia.atividades || []) a.texto = corrigir(a.texto);
    for (const s of dia.servicos || []) if (s.obs) s.obs = corrigir(s.obs);
    if (dia.comentario) dia.comentario = corrigir(dia.comentario);
    if (dia.stand_by?.motivo) dia.stand_by.motivo = corrigir(dia.stand_by.motivo);
  }
  return out;
}
