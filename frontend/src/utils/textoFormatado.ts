// Marcação dos textos do Data Book: o gerador do PDF aceita só <b>, <i> e <br/>. O editor mostra a
// formatação de verdade (negrito, itálico, quebras) e converte de volta para essa marcação.

export type TrechoFormatado =
  | { tipo: 'texto'; texto: string; negrito: boolean; italico: boolean }
  | { tipo: 'quebra' };

const TAG = /<(\/?)(b|i|br)\s*\/?>/gi;

/** Marcação → trechos (texto com estilo e quebras). Qualquer outra tag é tratada como texto comum. */
export function lerMarcacao(marcacao: string): TrechoFormatado[] {
  const trechos: TrechoFormatado[] = [];
  let negrito = 0;
  let italico = 0;
  let ultimo = 0;
  const empurrarTexto = (texto: string) => {
    for (const [i, linha] of texto.split(/\r?\n/).entries()) {
      if (i > 0) trechos.push({ tipo: 'quebra' });
      if (linha) trechos.push({ tipo: 'texto', texto: linha, negrito: negrito > 0, italico: italico > 0 });
    }
  };
  for (const m of String(marcacao || '').matchAll(TAG)) {
    empurrarTexto(marcacao.slice(ultimo, m.index));
    ultimo = (m.index ?? 0) + m[0].length;
    const fecha = m[1] === '/';
    const nome = m[2].toLowerCase();
    if (nome === 'br') trechos.push({ tipo: 'quebra' });
    else if (nome === 'b') negrito = Math.max(0, negrito + (fecha ? -1 : 1));
    else italico = Math.max(0, italico + (fecha ? -1 : 1));
  }
  empurrarTexto(String(marcacao || '').slice(ultimo));
  return trechos;
}

/** Trechos → marcação compacta (<b>, <i>, <br/>), sem tags vazias ou redundantes. */
export function escreverMarcacao(trechos: TrechoFormatado[]): string {
  let saida = '';
  let negrito = false;
  let italico = false;
  const fechar = () => {
    if (italico) saida += '</i>';
    if (negrito) saida += '</b>';
    negrito = false;
    italico = false;
  };
  for (const t of trechos) {
    if (t.tipo === 'quebra') {
      fechar();
      saida += '<br/>';
      continue;
    }
    if (t.negrito !== negrito || t.italico !== italico) {
      fechar();
      if (t.negrito) saida += '<b>';
      if (t.italico) saida += '<i>';
      negrito = t.negrito;
      italico = t.italico;
    }
    saida += t.texto;
  }
  fechar();
  return saida.replace(/(<br\/>)+$/, '');
}

/** Texto sem marcação (para enviar à IA ou contar caracteres); <br/> vira quebra de linha. */
export function textoSemMarcacao(marcacao: string): string {
  return lerMarcacao(marcacao).map(t => (t.tipo === 'quebra' ? '\n' : t.texto)).join('');
}

/** Texto puro → marcação (quebras de linha viram <br/>), sem formatação. */
export function marcacaoDeTextoPuro(texto: string): string {
  return escreverMarcacao(lerMarcacao(String(texto || '').replace(TAG, '')));
}

// ------------------------------------------------------------------ DOM do editor
interface NoLike {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<NoLike>;
}

const BLOCOS = new Set(['DIV', 'P', 'LI']);

/** Conteúdo do editor (contenteditable) → trechos. Enter do navegador cria DIV/P: viram quebras. */
export function trechosDoEditor(raiz: NoLike): TrechoFormatado[] {
  const trechos: TrechoFormatado[] = [];
  const visitar = (no: NoLike, negrito: boolean, italico: boolean) => {
    if (no.nodeType === 3) {
      // Marcas digitadas ou coladas como texto não viram formatação: só o B/I do editor formata.
      const texto = (no.textContent || '').replace(/\u00a0/g, ' ').replace(TAG, '');
      if (texto) trechos.push({ tipo: 'texto', texto, negrito, italico });
      return;
    }
    if (no.nodeType !== 1) return;
    const nome = no.nodeName.toUpperCase();
    if (nome === 'BR') {
      trechos.push({ tipo: 'quebra' });
      return;
    }
    const bloco = BLOCOS.has(nome);
    if (bloco && trechos.length && trechos[trechos.length - 1].tipo !== 'quebra') trechos.push({ tipo: 'quebra' });
    const n = negrito || nome === 'B' || nome === 'STRONG';
    const it = italico || nome === 'I' || nome === 'EM';
    const filhos = Array.from(no.childNodes);
    // <div><br></div>: o <br> final de um bloco só segura a linha vazia; a quebra já vem do bloco.
    if (bloco && filhos.length && filhos[filhos.length - 1].nodeName.toUpperCase() === 'BR') filhos.pop();
    if (bloco && !filhos.length) {
      trechos.push({ tipo: 'quebra' }); // bloco vazio = linha em branco
      return;
    }
    filhos.forEach(filho => visitar(filho, n, it));
  };
  Array.from(raiz.childNodes).forEach(filho => visitar(filho, false, false));
  return trechos;
}
