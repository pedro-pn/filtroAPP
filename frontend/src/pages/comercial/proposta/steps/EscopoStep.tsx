import { useState } from 'react';
import {
  MAX_SCOPE_SERVICE_ITEMS,
  createScopeServiceItem,
  type ScopeBlock,
  type ScopeServiceItem,
  type ScopeTopic
} from '../../../../../../shared/comercial/dist/scope-content.js';
import {
  createScopeTopic,
  scopeDescriptionParagraphs,
  scopeItemWithTopics,
  scopeTopicsForItem
} from '../../../../../../shared/comercial/dist/scope-descriptions.js';
import { Field } from '../../components/Field';
import { ScopeContentEditor } from './ScopeContentEditor';
import { ScopeTopicsEditor } from './ScopeTopicsEditor';
import { useReordenacao } from '../useReordenacao';
import { SERVICOS_DA_PROPOSTA, tituloDoNovoServico, VALOR_OUTRO_SERVICO } from '../servicosDaProposta';

type Props = {
  titulo: string;
  onTitulo: (valor: string) => void;
  itens: ScopeServiceItem[];
  onItens: (atualizar: (atual: ScopeServiceItem[]) => ScopeServiceItem[]) => void;
  blocos: ScopeBlock[];
  onBlocos: (atualizar: (atual: ScopeBlock[]) => ScopeBlock[]) => void;
  erroDe: (campo: string) => string | undefined;
};

function novoId() {
  return `escopo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mover<T>(lista: T[], indice: number, direcao: -1 | 1): T[] {
  const destino = indice + direcao;
  if (destino < 0 || destino >= lista.length) return lista;
  const proximo = [...lista];
  [proximo[indice], proximo[destino]] = [proximo[destino], proximo[indice]];
  return proximo;
}

/** Serviços mantêm suas tabelas/fotos; os tópicos internos geram a numeração. */
export function EscopoStep({ titulo, onTitulo, itens, onItens, blocos, onBlocos, erroDe }: Props) {
  const noLimite = itens.length >= MAX_SCOPE_SERVICE_ITEMS;
  const [servicoParaAdicionar, setServicoParaAdicionar] = useState('');
  const paragrafos = scopeDescriptionParagraphs(itens, { includeEmpty: true });

  function adicionarServico() {
    if (noLimite || !servicoParaAdicionar) return;
    const id = novoId();
    onItens(atual => [...atual, {
      ...createScopeServiceItem(id, atual.length),
      title: tituloDoNovoServico(servicoParaAdicionar, atual.length),
      topics: [createScopeTopic(`${id}-topic`)]
    }]);
    setServicoParaAdicionar('');
  }

  function atualizarTopicos(id: string, topics: ScopeTopic[]) {
    onItens(atual => atual.map(item => item.id === id ? scopeItemWithTopics(item, topics) : item));
  }

  const reordenar = useReordenacao({
    itens,
    aoReordenar: proximos => onItens(() => proximos),
    idDe: item => item.id,
    seletorDaLinha: '.com-escopo-card',
    desligado: itens.length < 2
  });

  return (
    <section className="com-painel">
      <div className="com-secao-titulo">
        <div>
          <h2>Escopo comum</h2>
          <p>Este conteúdo será compartilhado pelas propostas técnica e comercial.</p>
        </div>
      </div>
      <Field label="Título da proposta" required value={titulo}
        placeholder="Ex.: Limpeza química de tubulações" error={erroDe('title')} onChange={onTitulo} />

      <div className="com-secao-titulo com-escopo-cabecalho">
        <div>
          <strong>Serviços do escopo</strong>
          <span>Cada serviço pode ter vários tópicos e subitens, além de suas tabelas e fotos.</span>
        </div>
        <div className="com-secao-acoes com-escopo-adicionar">
          <select aria-label="Serviço para adicionar" value={servicoParaAdicionar} disabled={noLimite}
            onChange={evento => setServicoParaAdicionar(evento.target.value)}>
            <option value="">Selecione um serviço...</option>
            {SERVICOS_DA_PROPOSTA.map(servico => <option key={servico} value={servico}>{servico}</option>)}
            <option value={VALOR_OUTRO_SERVICO}>Outro serviço</option>
          </select>
          <button type="button" className="com-btn-add" disabled={noLimite || !servicoParaAdicionar}
            onClick={adicionarServico}>＋ Adicionar serviço</button>
        </div>
      </div>
      {itens.length === 0 && <p className="com-vazio">Adicione um serviço para montar seus tópicos de escopo.</p>}

      {itens.map((item, indice) => {
        const numeros = new Map<string, string>();
        for (const paragrafo of paragrafos.filter(p => p.scopeItemId === item.id)) {
          if (!numeros.has(paragrafo.topicId)) numeros.set(paragrafo.topicId, paragrafo.number);
        }
        return (
          <article className={`com-fase-card com-escopo-card${reordenar.idArrastado === item.id ? ' drag-placeholder' : ''}`}
            key={item.id} {...reordenar.propsDaLinha(item.id)}>
            <header className="com-fase-card-topo">
              <div className="com-escopo-numero">
                <b aria-hidden="true">{indice + 1}</b>
                <div><strong>Serviço {indice + 1}</strong><span>Os tópicos, tabelas e fotos abaixo pertencem a este serviço.</span></div>
              </div>
              <div className="com-fase-acoes">
                <span className="com-alca" role="button" tabIndex={-1}
                  {...reordenar.propsDaAlca(item.id, `serviço ${indice + 1}`)}>⠿</span>
                <button type="button" className="com-btn com-btn-fantasma" aria-label={`Mover serviço ${indice + 1} para cima`}
                  disabled={indice === 0} onClick={() => onItens(atual => mover(atual, indice, -1))}>↑</button>
                <button type="button" className="com-btn com-btn-fantasma" aria-label={`Mover serviço ${indice + 1} para baixo`}
                  disabled={indice === itens.length - 1} onClick={() => onItens(atual => mover(atual, indice, 1))}>↓</button>
                <button type="button" className="com-remover" aria-label={`Remover serviço ${indice + 1}`}
                  onClick={() => {
                    onItens(atual => atual.filter(candidato => candidato.id !== item.id));
                    onBlocos(atual => atual.filter(bloco => bloco.scopeItemId !== item.id));
                  }}>×</button>
              </div>
            </header>
            <Field label={`Título do serviço ${indice + 1}`} required value={item.title}
              placeholder="Ex.: Serviço de flushing" error={erroDe(`escopo[${indice}].title`)}
              onChange={title => onItens(atual => atual.map(c => c.id === item.id ? { ...c, title } : c))} />
            <ScopeTopicsEditor topicos={scopeTopicsForItem(item)} numeros={numeros}
              onChange={topicos => atualizarTopicos(item.id, topicos)} />
            <ScopeContentEditor itemId={item.id} blocks={blocos.filter(bloco => bloco.scopeItemId === item.id)}
              allBlocks={blocos} onChange={onBlocos} />
          </article>
        );
      })}
    </section>
  );
}
