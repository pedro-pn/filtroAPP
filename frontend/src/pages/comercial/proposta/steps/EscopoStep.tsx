import { useState } from 'react';

import {
  MAX_SCOPE_SERVICE_ITEMS,
  MAX_SCOPE_SERVICE_SUBITEMS,
  type ScopeBlock,
  type ScopeServiceItem
} from '../../../../../../shared/comercial/dist/scope-content.js';
import { Area, Field } from '../../components/Field';
import { ScopeContentEditor } from './ScopeContentEditor';
import { useReordenacao } from '../useReordenacao';
import {
  SCOPE_DESCRIPTION_TEMPLATES,
  createScopeDescriptionItem,
  scopeDescriptionParagraphs,
  splitScopeParagraphs
} from '../../../../../../shared/comercial/dist/scope-descriptions.js';

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
  onItens: (
    atualizar: (atual: ScopeServiceItem[]) => ScopeServiceItem[]
  ) => void;
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

  function adicionarServico(modelo?: string) {
    if (noLimite) return;
    onItens((atual) => [
      ...atual,
      createScopeDescriptionItem(novoId(), modelo)
    ]);
    setServicoParaAdicionar('');
  }

  function atualizarItem(id: string, mudancas: Partial<ScopeServiceItem>) {
    onItens((atual) =>
      atual.map((item) => (item.id === id ? { ...item, ...mudancas } : item))
    );
  }

  function separarParagrafos(item: ScopeServiceItem) {
    if (item.format !== 'paragraph') return;
    const textos = splitScopeParagraphs(item.description);
    if (
      textos.length < 2 ||
      itens.length + textos.length - 1 > MAX_SCOPE_SERVICE_ITEMS
    )
      return;
    onItens((atual) =>
      atual.flatMap((candidato) =>
        candidato.id !== item.id
          ? [candidato]
          : textos.map((description, indice) => ({
              ...candidato,
              id: indice === 0 ? candidato.id : novoId(),
              description,
              // Os detalhes pertencem ao último parágrafo, que os introduz.
              subitems:
                indice === textos.length - 1 ? candidato.subitems : undefined
            }))
      )
    );
  }

  const reordenar = useReordenacao({
    itens,
    aoReordenar: (proximos) => onItens(() => proximos),
    idDe: (item) => item.id,
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
          <p>
            Este conteúdo será compartilhado pelas propostas técnica e
            comercial.
          </p>
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
            Escolha um modelo ou escreva livremente. Edite, combine e remova os
            textos conforme o serviço. Cada parágrafo será um item numerado
            (2.1, 2.2...).
          </span>
        </div>
        <div className="com-secao-acoes com-escopo-adicionar">
          <select
            aria-label="Modelo de descrição"
            value={servicoParaAdicionar}
            disabled={noLimite}
            onChange={(evento) => setServicoParaAdicionar(evento.target.value)}
          >
            <option value="">Selecione um modelo de texto...</option>
            {SCOPE_DESCRIPTION_TEMPLATES.map((servico) => (
              <option key={servico.id} value={servico.id}>
                {servico.title}
              </option>
            ))}
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
            onClick={() => adicionarServico(servicoParaAdicionar)}
          >
            ＋ Adicionar modelo
          </button>
          <button
            type="button"
            className="com-btn com-btn-fantasma"
            disabled={noLimite}
            onClick={() => adicionarServico()}
          >
            ＋ Texto livre
          </button>
        </div>
      </div>

      {itens.length === 0 && (
        <p className="com-vazio">
          Adicione um modelo ou um texto livre para começar o escopo.
        </p>
      )}

      {itens.map((item, indice) => {
        const numero =
          scopeDescriptionParagraphs(itens.slice(0, indice)).filter(
            (p) => p.level === 1
          ).length + 1;
        const numeroDoSubitem =
          numero +
          Math.max(1, splitScopeParagraphs(item.description).length) -
          1;
        return (
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
                <b aria-hidden="true">2.{numero}</b>
                <div>
                  <strong>
                    {item.format === 'paragraph'
                      ? item.title
                      : `Serviço ${indice + 1}`}
                  </strong>
                  <span>
                    Todo o conteúdo abaixo ficará vinculado somente a este item.
                  </span>
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
                  onClick={() => onItens((atual) => mover(atual, indice, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="com-btn com-btn-fantasma"
                  aria-label={`Mover serviço ${indice + 1} para baixo`}
                  disabled={indice === itens.length - 1}
                  onClick={() => onItens((atual) => mover(atual, indice, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="com-remover"
                  aria-label={`Remover serviço ${indice + 1}`}
                  onClick={() => {
                    onItens((atual) =>
                      atual.filter((candidato) => candidato.id !== item.id)
                    );
                    onBlocos((atual) =>
                      atual.filter((bloco) => bloco.scopeItemId !== item.id)
                    );
                  }}
                >
                  ×
                </button>
              </div>
            </header>

            <div className="com-form-grid">
              {item.format !== 'paragraph' && (
                <>
                  <Field
                    label={`Título do item 2.${numero}`}
                    required
                    value={item.title}
                    placeholder="Ex.: Serviço de flushing"
                    error={erroDe(`escopo[${indice}].title`)}
                    onChange={(valor) =>
                      onItens((atual) =>
                        atual.map((c) =>
                          c.id === item.id ? { ...c, title: valor } : c
                        )
                      )
                    }
                  />

                  <Area
                    label="Descrição completa do serviço (opcional)"
                    value={item.description}
                    hint='Na proposta comercial, o texto começará automaticamente por "Serviço especializado em mão de obra e execução técnica".'
                    onChange={(valor) =>
                      onItens((atual) =>
                        atual.map((c) =>
                          c.id === item.id ? { ...c, description: valor } : c
                        )
                      )
                    }
                  />
                </>
              )}
              {item.format === 'paragraph' && (
                <div
                  className="com-escopo-texto"
                  onBlur={() => separarParagrafos(item)}
                >
                  <Area
                    label={`Texto do item 2.${numero}`}
                    value={item.description}
                    hint="O texto será impresso como você escrever. Cada quebra de linha gera outro item; não digite a numeração."
                    onChange={(description) =>
                      atualizarItem(item.id, { description })
                    }
                  />
                </div>
              )}
            </div>

            <div className="com-escopo-subitens">
              {(item.subitems ?? []).map((texto, subindice) => (
                <div
                  className="com-escopo-subitem"
                  key={`${item.id}-${subindice}`}
                >
                  <Area
                    label={`Subitem 2.${numeroDoSubitem}.${subindice + 1}`}
                    value={texto}
                    onChange={(valor) =>
                      atualizarItem(item.id, {
                        subitems: item.subitems!.map((atual, i) =>
                          i === subindice ? valor : atual
                        )
                      })
                    }
                  />
                  <div className="com-fase-acoes">
                    <button
                      type="button"
                      className="com-btn com-btn-fantasma"
                      aria-label={`Mover subitem ${subindice + 1} para cima`}
                      disabled={subindice === 0}
                      onClick={() =>
                        atualizarItem(item.id, {
                          subitems: mover(item.subitems!, subindice, -1)
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="com-remover"
                      aria-label={`Remover subitem ${subindice + 1}`}
                      onClick={() =>
                        atualizarItem(item.id, {
                          subitems: item.subitems!.filter(
                            (_, i) => i !== subindice
                          )
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="com-btn com-btn-fantasma"
                disabled={
                  (item.subitems?.length ?? 0) >= MAX_SCOPE_SERVICE_SUBITEMS
                }
                onClick={() =>
                  atualizarItem(item.id, {
                    subitems: [...(item.subitems ?? []), '']
                  })
                }
              >
                ＋ Adicionar subitem
              </button>
            </div>

            <ScopeContentEditor
              itemId={item.id}
              blocks={blocos.filter((bloco) => bloco.scopeItemId === item.id)}
              allBlocks={blocos}
              onChange={onBlocos}
            />
          </article>
        );
      })}
    </section>
  );
}
