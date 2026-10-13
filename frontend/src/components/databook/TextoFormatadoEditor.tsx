import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

import { useFieldContext } from '../ui/ds/field-context';
import {
  escreverMarcacao,
  lerMarcacao,
  trechosDoEditor,
  type TrechoFormatado
} from '../../utils/textoFormatado';
import './TextoFormatadoEditor.css';

interface TextoFormatadoEditorProps {
  /** Marcação aceita pelo gerador do PDF (<b>, <i>, <br/>). */
  value: string;
  onChange: (marcacao: string) => void;
  /** Rótulo acessível (o mesmo do Field). */
  ariaLabel: string;
  disabled?: boolean;
  minLinhas?: number;
}

/** Monta os nós do editor a partir dos trechos, sem innerHTML (o texto entra sempre como texto). */
function montar(raiz: HTMLElement, trechos: TrechoFormatado[]) {
  const nos: Node[] = [];
  for (const t of trechos) {
    if (t.tipo === 'quebra') {
      nos.push(document.createElement('br'));
      continue;
    }
    let no: Node = document.createTextNode(t.texto);
    if (t.italico) {
      const i = document.createElement('i');
      i.append(no);
      no = i;
    }
    if (t.negrito) {
      const b = document.createElement('b');
      b.append(no);
      no = b;
    }
    nos.push(no);
  }
  // Uma quebra no fim precisa de um <br> extra para a linha vazia aparecer no contenteditable.
  if (trechos[trechos.length - 1]?.tipo === 'quebra') nos.push(document.createElement('br'));
  raiz.replaceChildren(...nos);
}

function inserirTextoPuro(texto: string) {
  const selecao = window.getSelection();
  if (!selecao?.rangeCount) return;
  const range = selecao.getRangeAt(0);
  range.deleteContents();
  const fragmento = document.createDocumentFragment();
  texto.replace(/\r\n?/g, '\n').split('\n').forEach((linha, i) => {
    if (i > 0) fragmento.append(document.createElement('br'));
    if (linha) fragmento.append(document.createTextNode(linha));
  });
  const ultimo = fragmento.lastChild;
  range.insertNode(fragmento);
  if (ultimo) {
    range.setStartAfter(ultimo);
    range.collapse(true);
    selecao.removeAllRanges();
    selecao.addRange(range);
  }
}

function inserirQuebra(raiz: HTMLElement | null) {
  const selecao = window.getSelection();
  if (!raiz || !selecao?.rangeCount) return;
  const range = selecao.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);
  // No fim do campo, um <br> sozinho não cria linha visível: acrescenta outro como apoio do cursor
  // (o <br/> final é descartado ao gravar a marcação).
  // insertNode no fim de um texto deixa um nó de texto vazio depois do <br>: ignorar ao decidir.
  let seguinte = br.nextSibling;
  while (seguinte && seguinte.nodeType === Node.TEXT_NODE && !seguinte.textContent) {
    const vazio = seguinte;
    seguinte = seguinte.nextSibling;
    vazio.remove();
  }
  if (!seguinte) raiz.append(document.createElement('br'));
  range.setStartAfter(br);
  range.collapse(true);
  selecao.removeAllRanges();
  selecao.addRange(range);
}

/**
 * Campo de texto que mostra negrito, itálico e quebras de linha (em vez das marcas <b></b> cruas)
 * e devolve a marcação que o gerador do Data Book entende.
 */
export function TextoFormatadoEditor({ value, onChange, ariaLabel, disabled, minLinhas = 4 }: TextoFormatadoEditorProps) {
  const field = useFieldContext();
  const ref = useRef<HTMLDivElement>(null);
  const ultimoValor = useRef<string | null>(null);

  // Só remonta quando o valor muda de fora (rascunho, "Aplicar ao campo"), não a cada tecla.
  useEffect(() => {
    if (!ref.current || value === ultimoValor.current) return;
    montar(ref.current, lerMarcacao(value));
    ultimoValor.current = value;
  }, [value]);

  function publicar() {
    if (!ref.current) return;
    const marcacao = escreverMarcacao(trechosDoEditor(ref.current));
    ultimoValor.current = marcacao;
    onChange(marcacao);
  }

  function formatar(comando: 'bold' | 'italic') {
    ref.current?.focus();
    // execCommand é o único jeito nativo de alternar estilo na seleção de um contenteditable;
    // ainda é suportado por todos os navegadores. Sem ele, o campo segue editável sem os botões.
    if (typeof document.execCommand === 'function') document.execCommand(comando);
    publicar();
  }

  function aoColar(event: ClipboardEvent<HTMLDivElement>) {
    // Colar sempre como texto puro: nada de HTML, estilos ou scripts de outras páginas.
    event.preventDefault();
    inserirTextoPuro(event.clipboardData.getData('text/plain'));
    publicar();
  }

  function aoTeclar(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter') {
      // Quebra simples (<br>), igual ao PDF; evita os <div> que o navegador criaria.
      event.preventDefault();
      inserirQuebra(ref.current);
      publicar();
    }
  }

  const desabilitado = disabled || field?.disabled;
  return (
    <div className="texto-formatado" data-disabled={desabilitado || undefined}>
      <div className="texto-formatado__barra" role="toolbar" aria-label={`Formatação de ${ariaLabel}`}>
        <button type="button" className="texto-formatado__botao" disabled={desabilitado} aria-label="Negrito (Ctrl+B)"
          title="Negrito (Ctrl+B)" onMouseDown={e => e.preventDefault()} onClick={() => formatar('bold')}><b>B</b></button>
        <button type="button" className="texto-formatado__botao" disabled={desabilitado} aria-label="Itálico (Ctrl+I)"
          title="Itálico (Ctrl+I)" onMouseDown={e => e.preventDefault()} onClick={() => formatar('italic')}><i>I</i></button>
      </div>
      <div
        ref={ref}
        id={field?.controlId}
        className="texto-formatado__area"
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        aria-disabled={desabilitado || undefined}
        contentEditable={!desabilitado}
        suppressContentEditableWarning
        style={{ minHeight: `${minLinhas * 1.6}em` }}
        onInput={publicar}
        onPaste={aoColar}
        onKeyDown={aoTeclar}
      />
    </div>
  );
}
