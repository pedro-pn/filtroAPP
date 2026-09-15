import { useState } from 'react';

import {
  MAX_SCOPE_SERVICE_ITEMS,
  createScopeServiceItem,
  type ScopeBlock,
  type ScopeServiceItem
} from '../../../../../../shared/comercial/dist/scope-content.js';
import { Area, Field } from '../../components/Field';
import { ScopeContentEditor } from './ScopeContentEditor';
import { useReordenacao } from '../useReordenacao';
import {
  SERVICOS_DA_PROPOSTA,
  tituloDoNovoServico,
  VALOR_OUTRO_SERVICO
} from '../servicosDaProposta';

/**
 * Etapa 2 — Escopo comum (`PROP-CTL-026..033` e `113..128`).
 *
 * Porte de `app/page.tsx:916-985`.
 *
 * Cada serviço vira um item numerado (2.1, 2.2…) e carrega as próprias tabelas e
 * fotos. A numeração é **posicional**: mover um serviço renumera tudo abaixo dele, e
 * é por isso que as setas existem — a ordem aqui é a ordem do documento.
 *
 * **Remover um serviço remove os blocos dele junto.** Sem isso os blocos ficariam
 * órfãos no array global, invisíveis na tela e presentes no PDF.
 */

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
  return `escopo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mover<T>(lista: T[], indice: number, direcao: -1 | 1): T[] {
  const destino = indice + direcao;
  if (destino < 0 || destino >= lista.length) return lista;
  const proximo = [...lista];
  [proximo[indice], proximo[destino]] = [proximo[destino], proximo[indice]];
  return proximo;
}

export function EscopoStep({
  titulo,
  onTitulo,
  itens,
  onItens,
  blocos,
  onBlocos,
  erroDe
}: Props) {
  const noLimite = itens.length >= MAX_SCOPE_SERVICE_ITEMS;
  const [servicoParaAdicionar, setServicoParaAdicionar] = useState('');

  function adicionarServico() {
    if (!servicoParaAdicionar || noLimite) return;
    onItens(atual => {
      const novo = createScopeServiceItem(novoId(), atual.length);
      return [
        ...atual,
        { ...novo, title: tituloDoNovoServico(servicoParaAdicionar, atual.length) }
      ];
    });
    setServicoParaAdicionar('');
  }

  const reordenar = useReordenacao({
    itens,
    aoReordenar: proximos => onItens(() => proximos),
    idDe: item => item.id,
    seletorDaLinha: '.com-escopo-card',
    // Com um item só não há para onde arrastar, e a alça acesa prometeria
    // um gesto que não faz nada.
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

      <Field
        label="Título da proposta"
        required
        value={titulo}
        placeholder="Ex.: Limpeza química de tubulações"
        error={erroDe('title')}
        onChange={onTitulo}
      />

      <div className="com-secao-titulo com-escopo-cabecalho">
        <div>
          <strong>Descrição dos serviços que serão executados</strong>
          <span>
            Cada serviço vira um item próprio (2.1, 2.2...) e pode ter suas próprias
            tabelas e fotos.
          </span>
        </div>
        <div className="com-secao-acoes com-escopo-adicionar">
          <select
            aria-label="Serviço para adicionar"
            value={servicoParaAdicionar}
            disabled={noLimite}
            onChange={evento => setServicoParaAdicionar(evento.target.value)}
          >
            <option value="">Selecione um serviço...</option>
            {SERVICOS_DA_PROPOSTA.map(servico => (
              <option key={servico} value={servico}>{servico}</option>
            ))}
            <option value={VALOR_OUTRO_SERVICO}>Outro serviço</option>
          </select>
          <button
            type="button"
            className="com-btn-add"
            disabled={noLimite || !servicoParaAdicionar}
            title={
              noLimite
                ? `Limite de ${MAX_SCOPE_SERVICE_ITEMS} serviços atingido`
                : !servicoParaAdicionar
                  ? 'Selecione um serviço antes de adicionar'
                  : undefined
            }
            onClick={adicionarServico}
          >
            ＋ Adicionar serviço
          </button>
        </div>
      </div>

      {itens.map((item, indice) => (
        <article
          className={
            reordenar.idArrastado === item.id
              ? 'com-fase-card com-escopo-card drag-placeholder'
              : 'com-fase-card com-escopo-card'
          }
          key={item.id}
          {...reordenar.propsDaLinha(item.id)}
        >
          <header className="com-fase-card-topo">
            <div className="com-escopo-numero">
              <b aria-hidden="true">2.{indice + 1}</b>
              <div>
                <strong>Serviço {indice + 1}</strong>
                <span>Todo o conteúdo abaixo ficará vinculado somente a este item.</span>
              </div>
            </div>
            <div className="com-fase-acoes">
              {/* A alça é o gesto novo (L2); as setas ficam ao lado, que é o
                  desvio nº 6 — arrastar é acréscimo, não substituição, e o
                  teclado precisa de um caminho. */}
              <span
                className="com-alca"
                role="button"
                tabIndex={-1}
                {...reordenar.propsDaAlca(item.id, `serviço ${indice + 1}`)}
              >
                ⠿
              </span>
              <button
                type="button"
                className="com-btn com-btn-fantasma"
                aria-label={`Mover serviço ${indice + 1} para cima`}
                disabled={indice === 0}
                onClick={() => onItens(atual => mover(atual, indice, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="com-btn com-btn-fantasma"
                aria-label={`Mover serviço ${indice + 1} para baixo`}
                disabled={indice === itens.length - 1}
                onClick={() => onItens(atual => mover(atual, indice, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                className="com-remover"
                aria-label={`Remover serviço ${indice + 1}`}
                /* O último não se remove: uma proposta sem serviço nenhum não é
                   proposta, e o documento sairia com a seção 2 vazia. */
                disabled={itens.length === 1}
                onClick={() => {
                  onItens(atual => atual.filter(candidato => candidato.id !== item.id));
                  onBlocos(atual => atual.filter(bloco => bloco.scopeItemId !== item.id));
                }}
              >
                ×
              </button>
            </div>
          </header>

          <div className="com-form-grid">
            <Field
              label={`Título do item 2.${indice + 1}`}
              required
              value={item.title}
              placeholder="Ex.: Serviço de flushing"
              error={erroDe(`escopo[${indice}].title`)}
              onChange={valor =>
                onItens(atual =>
                  atual.map(c => (c.id === item.id ? { ...c, title: valor } : c))
                )
              }
            />

            <Area
              label="Descrição completa do serviço"
              required
              value={item.description}
              hint='Na proposta comercial, o texto começará automaticamente por "Serviço especializado em mão de obra e execução técnica".'
              error={erroDe(`escopo[${indice}].description`)}
              onChange={valor =>
                onItens(atual =>
                  atual.map(c => (c.id === item.id ? { ...c, description: valor } : c))
                )
              }
            />
          </div>

          <ScopeContentEditor
            itemId={item.id}
            blocks={blocos.filter(bloco => bloco.scopeItemId === item.id)}
            allBlocks={blocos}
            onChange={onBlocos}
          />
        </article>
      ))}
    </section>
  );
}
