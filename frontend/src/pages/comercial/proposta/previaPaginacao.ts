import type {
  ScopeBlock,
  ScopePhotoBlock,
  ScopeServiceItem
} from '../../../../../shared/comercial/dist/scope-content.js';
import {
  scopeDescriptionParagraphs,
  type ScopeDescriptionParagraph
} from '../../../../../shared/comercial/dist/scope-descriptions.js';
import {
  buildTechnicalReportsText,
  type TechnicalServiceSelection
} from '../../../../../shared/comercial/dist/technical-services.js';
import {
  categoriaCanonicaResponsabilidade,
  ordenarLinhasDeResponsabilidade
} from '../../../../../shared/comercial/dist/modelo-documento.js';

/**
 * Onde cada página do documento quebra (tarefa T065).
 *
 * Porte de `createScopePreviewPages`, `paginateScopePreviewRows`,
 * `wrapScopePreviewText` e `createTechnicalPreviewPages` (`app/page.tsx`).
 *
 * **Isto não é apresentação, é regra** — e por isso vive num módulo puro, longe
 * do JSX. Uma tabela de 40 linhas não cabe numa folha A4: alguém precisa decidir
 * onde ela parte, e a decisão tem de ser a mesma na prévia e no PDF. Se a prévia
 * quebrasse num lugar e o PDF em outro, a prévia deixaria de servir para o que
 * existe: conferir o documento antes de emitir.
 *
 * O orçamento é em **linhas**, não em caracteres, porque é a linha que ocupa
 * altura. Uma célula com texto longo empurra a linha inteira da tabela para
 * baixo, e é isso que estoura a folha.
 */

/** Linhas de texto que cabem numa folha de tabela do escopo. */
export const ORCAMENTO_DE_LINHAS = 24;

/** Linhas que cabem numa folha de texto técnico corrido. */
export const ORCAMENTO_DE_LINHAS_TECNICO = 22;

/**
 * Quebra o texto em linhas de no máximo `caracteresPorLinha`.
 *
 * Palavra maior que a linha inteira é **fatiada**, não deixada estourando: um
 * código de peça de 90 caracteres numa coluna de 20 arrebentaria a largura da
 * tabela no PDF, e ali não há barra de rolagem para salvar.
 */
export function quebrarTexto(
  valor: string,
  caracteresPorLinha: number
): string[] {
  return String(valor || '—')
    .split(/\r?\n/)
    .flatMap((paragrafo) => {
      const palavras = paragrafo.trim().split(/\s+/).filter(Boolean);
      if (!palavras.length) return [''];

      const linhas: string[] = [];
      let linha = '';

      for (const palavra of palavras) {
        if (palavra.length > caracteresPorLinha) {
          if (linha) {
            linhas.push(linha);
            linha = '';
          }
          for (let i = 0; i < palavra.length; i += caracteresPorLinha) {
            linhas.push(palavra.slice(i, i + caracteresPorLinha));
          }
        } else if (
          !linha ||
          `${linha} ${palavra}`.length <= caracteresPorLinha
        ) {
          linha = linha ? `${linha} ${palavra}` : palavra;
        } else {
          linhas.push(linha);
          linha = palavra;
        }
      }

      if (linha) linhas.push(linha);
      return linhas;
    });
}

/**
 * Reparte as linhas da tabela em folhas.
 *
 * Duas sutilezas que a referência resolve e que não são óbvias:
 *
 * 1. **Uma linha alta demais para uma folha vazia é partida ao meio**, não
 *    empurrada para sempre. Sem isso, uma célula com um parágrafo inteiro
 *    entraria em laço: nunca cabe, nunca avança.
 * 2. **Nunca devolve lista vazia.** Tabela sem linha nenhuma vira uma folha com
 *    uma linha em branco — porque o cabeçalho ainda precisa aparecer.
 */
export function paginarLinhasDaTabela(
  linhas: string[][],
  quantidadeDeColunas: number
): string[][][] {
  const paginas: string[][][] = [];
  let pagina: string[][] = [];
  let restantes = ORCAMENTO_DE_LINHAS;

  // Quanto mais colunas, menos cabe em cada uma: a folha tem largura fixa.
  const caracteresPorLinha = Math.max(
    8,
    Math.floor(72 / Math.max(2, quantidadeDeColunas))
  );

  const fecharPagina = () => {
    if (pagina.length) paginas.push(pagina);
    pagina = [];
    restantes = ORCAMENTO_DE_LINHAS;
  };

  for (const linha of linhas) {
    const celulas = Array.from({ length: quantidadeDeColunas }, (_, i) =>
      quebrarTexto(linha[i] || '—', caracteresPorLinha)
    );
    // A linha da tabela é tão alta quanto a célula mais alta dela.
    const alturaDaLinha = Math.max(...celulas.map((celula) => celula.length));

    if (
      pagina.length &&
      alturaDaLinha + 1 > restantes &&
      alturaDaLinha + 1 <= ORCAMENTO_DE_LINHAS
    ) {
      fecharPagina();
    }

    let deslocamento = 0;
    while (deslocamento < alturaDaLinha) {
      if (restantes <= 1) fecharPagina();
      const nestaPagina = Math.min(alturaDaLinha - deslocamento, restantes - 1);
      pagina.push(linha);
      restantes -= nestaPagina + 1;
      deslocamento += nestaPagina;
      if (deslocamento < alturaDaLinha) fecharPagina();
    }
  }

  fecharPagina();
  return paginas.length
    ? paginas
    : [[Array.from({ length: quantidadeDeColunas }, () => '')]];
}

export type PaginaDoEscopo =
  | {
      chave: string;
      tipo: 'table';
      scopeItemId?: string;
      rotulo: string;
      colunas: string[];
      linhas: string[][];
      parte: number;
      totalDePartes: number;
    }
  | {
      chave: string;
      tipo: 'photo';
      scopeItemId?: string;
      rotulo: string;
      bloco: ScopePhotoBlock;
    };

/**
 * As folhas de conteúdo do escopo.
 *
 * A numeração — "Tabela 1", "Figura 2" — é **contínua na proposta inteira**, não
 * por serviço. É como o documento se lê: quem procura a Figura 3 não quer saber
 * de qual serviço ela é.
 */
export function paginasDoEscopo(blocos: ScopeBlock[]): PaginaDoEscopo[] {
  let numeroDaTabela = 0;
  let numeroDaFoto = 0;

  return blocos.flatMap<PaginaDoEscopo>((bloco) => {
    if (bloco.type === 'photo') {
      numeroDaFoto += 1;
      return [
        {
          chave: bloco.id,
          tipo: 'photo',
          scopeItemId: bloco.scopeItemId,
          rotulo: `Figura ${numeroDaFoto}`,
          bloco
        }
      ];
    }

    numeroDaTabela += 1;
    const linhas = bloco.rows.length
      ? bloco.rows
      : [bloco.columns.map(() => '')];
    const pedacos = paginarLinhasDaTabela(linhas, bloco.columns.length);

    return pedacos.map((pedaco, i) => ({
      chave: `${bloco.id}-${i}`,
      tipo: 'table' as const,
      scopeItemId: bloco.scopeItemId,
      rotulo: `Tabela ${numeroDaTabela}${bloco.title ? ` — ${bloco.title}` : ''}`,
      colunas: bloco.columns,
      linhas: pedaco,
      parte: i + 1,
      totalDePartes: pedacos.length
    }));
  });
}

/** "2.3 Flushing" — o cabeçalho que amarra a folha ao serviço de onde ela veio. */
export function tituloDoItemDeEscopo(
  itens: ScopeServiceItem[],
  scopeItemId?: string
) {
  const indice = itens.findIndex((item) => item.id === scopeItemId);
  const item = indice >= 0 ? itens[indice] : itens[0];
  if (!item) return '2.1 Conteúdo complementar do escopo';

  const numero =
    scopeDescriptionParagraphs(itens).find((p) => p.scopeItemId === item.id)
      ?.number ?? '2.1';
  return `${numero} ${item.title || `Serviço ${Math.max(0, indice) + 1}`}`;
}

/** A seção 2 pode ocupar várias folhas; textos extensos não podem ser cortados. */
export function paginasDasDescricoes(paragrafos: ScopeDescriptionParagraph[]) {
  type Trecho = ScopeDescriptionParagraph & { continuacao: boolean };
  const paginas: Trecho[][] = [[]];
  let restantes = 16; // A primeira folha compartilha espaço com os clientes (1.3).
  for (const paragrafo of paragrafos) {
    const linhas = quebrarTexto(
      paragrafo.text,
      paragrafo.level === 2 ? 65 : 70
    );
    let offset = 0;
    while (offset < linhas.length) {
      if (
        restantes < 3 ||
        (offset === 0 && linhas.length + 1 > restantes && linhas.length < 27)
      ) {
        paginas.push([]);
        restantes = 28;
      }
      const quantidade = Math.min(linhas.length - offset, restantes - 1);
      paginas[paginas.length - 1].push({
        ...paragrafo,
        key: `${paragrafo.key}-${offset}`,
        text: linhas.slice(offset, offset + quantidade).join(' '),
        continuacao: offset > 0
      });
      offset += quantidade;
      restantes -= quantidade + 1;
    }
  }
  return paginas;
}

/**
 * As folhas da **matriz de responsabilidade** (tarefa T071b).
 *
 * A referência cabia numa folha porque mostrava `.slice(0, 6)` de cada lado. Com
 * a matriz dos `.docx` são ~15 linhas Filtrovali e ~20 do Contratante, e cortar
 * em 6 não é resumir: é omitir obrigação contratual da prévia que existe
 * justamente para conferir o documento antes de emitir.
 */
export type EntradaDaMatriz =
  | { tipo: 'categoria'; texto: string }
  | {
      tipo: 'linha';
      numero: number;
      item: string;
      nota: string;
      subitens: string[];
    };

export type FolhaDaMatriz = {
  chave: string;
  titulo: string;
  entradas: EntradaDaMatriz[];
};

/** Linhas que cabem numa folha da matriz. Ela tem título de bloco por cima. */
export const ORCAMENTO_DE_LINHAS_MATRIZ = 22;

type LinhaCrua = {
  item: string;
  owner: string;
  note: string;
  categoria?: string;
  subitens?: string[];
};

function alturaDaLinhaDaMatriz(linha: LinhaCrua): number {
  const escopo = quebrarTexto(linha.item || '—', 48).length;
  const nota = quebrarTexto(linha.note || '—', 22).length;
  const subitens = (linha.subitens || []).reduce(
    (soma, subitem) => soma + quebrarTexto(subitem, 46).length,
    0
  );
  return Math.max(escopo, nota) + subitens;
}

export function folhasDaMatriz(linhas: LinhaCrua[]): FolhaDaMatriz[] {
  const folhas: FolhaDaMatriz[] = [];

  for (const responsavel of ['Filtrovali', 'Contratante'] as const) {
    const doLado = ordenarLinhasDeResponsabilidade(
      linhas.filter(
        (linha) => linha.owner === responsavel && linha.item.trim()
      ),
      responsavel
    );
    if (!doLado.length) continue;

    const titulo = `Responsabilidade da ${responsavel === 'Filtrovali' ? 'Filtrovali' : 'Contratante'}`;
    let entradas: EntradaDaMatriz[] = [];
    let restantes = ORCAMENTO_DE_LINHAS_MATRIZ;
    let numero = 0;
    let categoriaAberta = '';
    let parte = 0;

    const fechar = () => {
      if (!entradas.length) return;
      folhas.push({
        chave: `matriz-${responsavel}-${parte}`,
        titulo: parte ? `${titulo} (continuação)` : titulo,
        entradas
      });
      parte += 1;
      entradas = [];
      restantes = ORCAMENTO_DE_LINHAS_MATRIZ;
    };

    for (const linha of doLado) {
      const categoria = categoriaCanonicaResponsabilidade(
        linha.categoria || '',
        responsavel
      );
      const altura = alturaDaLinhaDaMatriz(linha);
      const abreCategoria = categoria && categoria !== categoriaAberta;
      const custo = altura + (abreCategoria ? 1 : 0);

      // Uma categoria que abre no pé da folha ficaria órfã do primeiro item
      // dela. Empurra as duas juntas — a não ser que nem numa folha vazia caibam,
      // caso em que forçar a quebra entraria em laço.
      if (
        entradas.length &&
        custo > restantes &&
        custo <= ORCAMENTO_DE_LINHAS_MATRIZ
      ) {
        fechar();
      }

      if (categoria && categoria !== categoriaAberta) {
        entradas.push({ tipo: 'categoria', texto: categoria });
        restantes -= 1;
        categoriaAberta = categoria;
      } else if (
        categoria &&
        !entradas.some((entrada) => entrada.tipo === 'categoria')
      ) {
        // A folha virou no meio de uma categoria: o subtítulo se repete, senão as
        // linhas da folha seguinte aparecem sob cabeçalho nenhum.
        entradas.push({
          tipo: 'categoria',
          texto: `${categoria} (continuação)`
        });
        restantes -= 1;
      }

      numero += 1;
      entradas.push({
        tipo: 'linha',
        numero,
        item: linha.item,
        nota: linha.note,
        subitens: linha.subitens || []
      });
      restantes -= altura;
    }

    fechar();
  }

  return folhas;
}

export type PaginaTecnica = {
  chave: string;
  titulo: string;
  texto: string;
  parte: number;
  totalDePartes: number;
};

function paginarTextoTecnico(valor: string): string[] {
  const linhas = quebrarTexto(valor || '—', 78);
  const total = Math.max(
    1,
    Math.ceil(linhas.length / ORCAMENTO_DE_LINHAS_TECNICO)
  );
  return Array.from({ length: total }, (_, i) =>
    linhas
      .slice(
        i * ORCAMENTO_DE_LINHAS_TECNICO,
        (i + 1) * ORCAMENTO_DE_LINHAS_TECNICO
      )
      .join('\n')
  );
}

/**
 * As folhas da proposta técnica: um texto por serviço, e a de relatórios no fim.
 *
 * O texto dos relatórios sai de `buildTechnicalReportsText`, em
 * `shared/comercial` — ele lista os relatórios que os serviços escolhidos geram,
 * e é compromisso com o cliente, não texto de tela.
 */
export function paginasTecnicas(
  selecoes: TechnicalServiceSelection[],
  complementoDosRelatorios: string
): PaginaTecnica[] {
  if (!selecoes.length) return [];

  const paginas: PaginaTecnica[] = [];

  selecoes.forEach((selecao, indiceDoServico) => {
    const pedacos = paginarTextoTecnico(selecao.text);
    pedacos.forEach((texto, i) => {
      paginas.push({
        chave: `${selecao.instanceId}-${i}`,
        titulo: `7.${indiceDoServico + 1} — ${selecao.title}${i ? ' (continuação)' : ''}`,
        texto,
        parte: i + 1,
        totalDePartes: pedacos.length
      });
    });
  });

  const relatorios = paginarTextoTecnico(
    buildTechnicalReportsText(selecoes, complementoDosRelatorios)
  );
  relatorios.forEach((texto, i) => {
    paginas.push({
      chave: `relatorios-${i}`,
      titulo: `8. Relatórios${i ? ' (continuação)' : ''}`,
      texto,
      parte: i + 1,
      totalDePartes: relatorios.length
    });
  });

  return paginas;
}
