// Verificações objetivas do texto adequado contra a anotação original. Modelos generativos podem
// variar a redação; estas regras olham só para o que não pode mudar: valores e pessoas.

const HORARIO = /\b(\d{1,2})\s*(?::|h)\s*(\d{2})\b/gi;
const DATA = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
const PESSOA = /\b(?:Sr|Sra|Srta|Eng|Engª|Dr|Dra|Téc|Tec)\.?\s+([A-ZÀ-Ý][\p{L}]+)/gu;

function normalizarAno(a) {
  return a.length === 2 ? `20${a}` : a;
}

/** Valores factuais do texto: horários (HH:MM), datas (DD/MM/AAAA) e números soltos (sem zeros à esquerda). */
export function valoresFactuais(texto) {
  let resto = String(texto || '');
  const valores = new Set();
  resto = resto.replace(DATA, (_, d, m, a) => {
    valores.add(`data:${d.padStart(2, '0')}/${m.padStart(2, '0')}/${normalizarAno(a)}`);
    return ' ';
  });
  resto = resto.replace(HORARIO, (_, h, m) => {
    valores.add(`hora:${h.padStart(2, '0')}:${m}`);
    return ' ';
  });
  for (const n of resto.match(/\d+/g) || []) valores.add(`num:${Number(n)}`);
  return valores;
}

function rotulo(valor) {
  return valor.replace(/^(data|hora|num):/, '');
}

export function pessoasCitadas(texto) {
  return new Set([...String(texto || '').matchAll(PESSOA)].map(m => m[1]));
}

/**
 * Avisos para o usuário antes de aplicar: valores que aparecem no texto adequado e não estão na
 * anotação (possível invenção) e pessoas citadas na anotação que sumiram do texto adequado.
 */
export function verificarAderencia(original, formatado) {
  const avisos = [];
  const doOriginal = valoresFactuais(original);
  const novos = [...valoresFactuais(formatado)].filter(v => !doOriginal.has(v));
  if (novos.length) {
    avisos.push(`O texto adequado contém valores que não estão na anotação: ${novos.map(rotulo).join(', ')}. Confira antes de aplicar.`);
  }
  const pessoasFormatado = pessoasCitadas(formatado);
  const sumiram = [...pessoasCitadas(original)].filter(p => !pessoasFormatado.has(p) && !String(formatado).includes(p));
  if (sumiram.length) {
    avisos.push(`A anotação cita ${sumiram.join(', ')}, que não aparece${sumiram.length > 1 ? 'm' : ''} no texto adequado. Confira antes de aplicar.`);
  }
  return avisos;
}

/**
 * Formato pedido nas instruções: etapas em linhas iniciadas por "*" e terminadas em ";" (a última
 * do grupo em "."). Usado nos testes de aderência e na avaliação com a API real.
 */
export function problemasDeFormato(formatado) {
  const problemas = [];
  for (const linha of String(formatado || '').split('\n').map(l => l.trim()).filter(Boolean)) {
    if (linha.startsWith('*') && !linha.startsWith('**') && !/[;.]$/.test(linha)) {
      problemas.push(`Etapa sem ";" ou "." no final: "${linha}"`);
    }
  }
  if (/^\s*(olá|segue|claro|aqui está)/i.test(String(formatado))) problemas.push('Resposta com saudação ou comentário.');
  return problemas;
}
