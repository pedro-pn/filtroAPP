// Avalia a adequação com a API REAL da OpenAI contra os exemplos aprovados (instrucoes/).
// Gera custo (pequeno: ~3 chamadas). Só roda com --confirmar. Uso: npm run openai:avaliar -- --confirmar
import fs from 'node:fs';

import env from '../src/config/env.js';
import { adequarAnotacao } from '../src/lib/anotacoes/adequar.js';
import { problemasDeFormato } from '../src/lib/anotacoes/aderencia.js';
import { ARQUIVO_EXEMPLOS, ARQUIVO_INSTRUCOES } from '../src/lib/anotacoes/instrucoes.js';

if (!process.argv.includes('--confirmar')) {
  console.error('Este script chama a API real (gera custo). Rode com --confirmar.');
  process.exit(1);
}

function pares() {
  const instr = [...fs.readFileSync(ARQUIVO_INSTRUCOES, 'utf8').matchAll(/"([\s\S]+?)"/g)].map(m => m[1]).filter(t => t.includes('\n'));
  const exemplos = fs.readFileSync(ARQUIVO_EXEMPLOS, 'utf8').split(/^## Exemplo \d+/m).slice(1).map(bloco => {
    const [, original, aprovado] = bloco.split(/^### .*$/m);
    return { original: original.trim(), aprovado: aprovado.trim() };
  });
  return [{ original: instr[0], aprovado: instr[1] }, ...exemplos];
}

// Semelhança de vocabulário (Jaccard): referência, não nota — redações diferentes podem estar corretas.
function semelhanca(a, b) {
  const palavras = t => new Set(t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) || []);
  const x = palavras(a);
  const y = palavras(b);
  const inter = [...x].filter(p => y.has(p)).length;
  return inter / (new Set([...x, ...y]).size || 1);
}

console.log(`Modelo: ${env.openaiModel} · esforço: ${env.openaiReasoningEffort}\n`);
for (const [i, { original, aprovado }] of pares().entries()) {
  const { textoFormatado, avisos } = await adequarAnotacao(original, { usuarioId: 'avaliacao' });
  console.log(`=== Exemplo ${i + 1} ===\n${textoFormatado}\n`);
  console.log(`Semelhança com o aprovado: ${(semelhanca(textoFormatado, aprovado) * 100).toFixed(0)}%`);
  console.log(`Avisos de aderência: ${avisos.length ? avisos.join(' | ') : 'nenhum'}`);
  const formato = problemasDeFormato(textoFormatado);
  console.log(`Formato: ${formato.length ? formato.join(' | ') : 'ok'}\n`);
}
