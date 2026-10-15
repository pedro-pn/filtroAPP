import type { DatabookIntervalo, DatabookPrevia, DatabookRevisaoPreparada } from '../api/databook';
import type { DatabookFormulario } from './databook';

export interface PedidoPreviaDatabook {
  projetoId: string;
  formulario: DatabookFormulario;
  dados: DatabookRevisaoPreparada;
  periodo: DatabookIntervalo;
}

export interface ResultadoPreviaDatabook {
  info: DatabookPrevia;
  pdf: Blob;
  formulario: string;
}

/** Uma geração por vez; salvar aguarda/reutiliza exatamente a prévia do último texto. */
export function criarFilaPreviaDatabook(executar: (pedido: PedidoPreviaDatabook) => Promise<ResultadoPreviaDatabook>) {
  let versao = 0;
  let cache: { chave: string; resultado: ResultadoPreviaDatabook } | null = null;
  let pendente: { chave: string; promessa: Promise<ResultadoPreviaDatabook> } | null = null;
  return {
    limparCache() { versao += 1; cache = null; },
    async obter(pedido: PedidoPreviaDatabook): Promise<ResultadoPreviaDatabook> {
      const versaoPedido = versao;
      const chave = JSON.stringify([versaoPedido, pedido.projetoId, pedido.dados.origem?.id, pedido.periodo, pedido.formulario]);
      if (cache?.chave === chave) return cache.resultado;
      if (pendente?.chave === chave) return pendente.promessa;
      const anterior = pendente?.promessa;
      const promessa = (async () => {
        if (anterior) await anterior.catch(() => undefined);
        const resultado = await executar(pedido);
        if (versao === versaoPedido) cache = { chave, resultado };
        return resultado;
      })();
      pendente = { chave, promessa };
      try { return await promessa; }
      finally { if (pendente?.promessa === promessa) pendente = null; }
    }
  };
}
