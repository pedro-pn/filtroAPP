import { useState } from 'react';

import {
  listarLevantamentos,
  mensagemDeErro,
  type LevantamentoSalvo
} from '../../../api/comercial';
import { BotaoFecharDialogo } from '../components/FecharDialogo';
import { LOGO_URL } from '../components/marca';
import { MarcaDeOpcao } from '../components/MarcaDeOpcao';
import { formatarValorDoLevantamento } from './levantamentoVinculado';

/** Entrada da proposta: nova ou revisão de um número existente (PROP-CTL-001..005). */
export function PropostaModeDialog({
  recado,
  onLevantamento,
  onConcluirLevantamento,
  onPropostaExistente,
  onNova,
  onRevisao,
  onFechar
}: {
  recado: string;
  onLevantamento: (levantamento: LevantamentoSalvo) => void;
  onConcluirLevantamento: (levantamento: LevantamentoSalvo) => void;
  onPropostaExistente: (levantamento: LevantamentoSalvo) => void;
  onNova: () => void;
  onRevisao: (codigo: string) => Promise<boolean>;
  /** Fechar sem escolher volta ao menu do módulo. */
  onFechar: () => void;
}) {
  const [mostrarLevantamentos, setMostrarLevantamentos] = useState(false);
  const [mostrarRevisao, setMostrarRevisao] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [carregandoLevantamentos, setCarregandoLevantamentos] = useState(false);
  const [levantamentos, setLevantamentos] = useState<LevantamentoSalvo[]>([]);
  const [erroDosLevantamentos, setErroDosLevantamentos] = useState('');

  async function abrirLevantamentos(forcar = false) {
    setMostrarLevantamentos(true);
    setMostrarRevisao(false);
    if ((!forcar && levantamentos.length) || carregandoLevantamentos) return;

    setCarregandoLevantamentos(true);
    setErroDosLevantamentos('');
    try {
      const resposta = await listarLevantamentos({
        pageSize: 100
      });
      setLevantamentos(resposta.items);
    } catch (error) {
      setErroDosLevantamentos(
        mensagemDeErro(
          error,
          'Não foi possível carregar os levantamentos salvos.'
        )
      );
    } finally {
      setCarregandoLevantamentos(false);
    }
  }

  async function carregar() {
    const procurado = codigo.trim();
    if (!procurado || carregando) return;
    setCarregando(true);
    try {
      await onRevisao(procurado);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div
      className="com-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="com-proposta-modo-titulo"
    >
      <section className="com-painel com-modo-card">
        <BotaoFecharDialogo fechar={onFechar} />
        <img className="com-modo-logo" src={LOGO_URL} alt="Filtrovali" />
        <span className="com-eyebrow">PROPOSTA TÉCNICA E COMERCIAL</span>
        <h1 id="com-proposta-modo-titulo">Como deseja começar?</h1>
        <p>
          Continue de um levantamento salvo para aproveitar o código e o preço
          já calculado. Se necessário, também é possível criar uma proposta
          avulsa ou revisar uma existente.
        </p>

        <div className="com-modo-opcoes com-modo-tres">
          <button type="button" onClick={() => void abrirLevantamentos()}>
            <MarcaDeOpcao tipo="ok" />
            <strong>Usar levantamento salvo</strong>
            <span>
              Vincula custos, código, revisão e preço de venda à proposta.
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMostrarLevantamentos(false);
              onNova();
            }}
          >
            <MarcaDeOpcao tipo="nova" />
            <strong>Proposta avulsa</strong>
            <span>
              Cria os documentos sem levantamento de custos vinculado.
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMostrarLevantamentos(false);
              setMostrarRevisao(true);
            }}
          >
            <MarcaDeOpcao tipo="revisao" />
            <strong>Revisar proposta</strong>
            <span>Carrega os dados salvos e calcula a próxima revisão.</span>
          </button>
        </div>

        {mostrarLevantamentos && (
          <section className="com-levantamentos-entrada" aria-live="polite">
            <div className="com-levantamentos-cabecalho">
              <div>
                <strong>Levantamentos salvos</strong>
                <span>
                  Use um levantamento concluído ou abra um rascunho para
                  revisar e concluir. Se já houver proposta, você continuará nela.
                </span>
              </div>
              {!carregandoLevantamentos && (
                <button
                  type="button"
                  className="com-btn com-btn-fantasma"
                  onClick={() => {
                    void abrirLevantamentos(true);
                  }}
                >
                  Atualizar
                </button>
              )}
            </div>

            {carregandoLevantamentos ? (
              <p>Carregando levantamentos...</p>
            ) : erroDosLevantamentos ? (
              <p className="com-recado">{erroDosLevantamentos}</p>
            ) : levantamentos.length === 0 ? (
              <p>
                Nenhum levantamento foi encontrado. Salve um orçamento para
                encontrá-lo aqui e continuar a proposta.
              </p>
            ) : (
              <div className="com-levantamentos-lista">
                {levantamentos.map((item) => {
                  const proposta = item.propostaVinculada;
                  const rascunho = item.status !== 'SALVO';
                  const emProcessamento = proposta?.status === 'FINALIZANDO';
                  const rotulo =
                    proposta?.status === 'RASCUNHO'
                      ? 'Continuar proposta'
                      : proposta?.status === 'FALHA_INTEGRACAO'
                        ? 'Tentar integrações novamente'
                        : proposta?.status === 'FINALIZADA'
                          ? 'Criar revisão'
                          : emProcessamento
                            ? 'Finalização em andamento'
                            : '';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={emProcessamento}
                      onClick={() => {
                        if (!proposta && rascunho) return onConcluirLevantamento(item);
                        if (!proposta) return onLevantamento(item);
                        if (proposta.status === 'FINALIZADA') {
                          void onRevisao(proposta.proposalCode);
                          return;
                        }
                        onPropostaExistente(item);
                      }}
                    >
                      <span>
                        <strong>
                          Proposta {item.proposalCode}
                          {item.revisionNumber > 0
                            ? ` · Rev ${item.revisionNumber}`
                            : ''}
                        </strong>
                        <small>
                          {rascunho ? 'Rascunho salvo' : 'Levantamento concluído'} ·{' '}
                          {item.title || 'Levantamento sem título'}
                          {rotulo ? ` · ${rotulo}` : ''}
                        </small>
                      </span>
                      <b>
                        {!proposta && rascunho ? 'Revisar e concluir orçamento · ' : ''}
                        {formatarValorDoLevantamento(item.salePrice) ||
                          'Preço a revisar'}
                      </b>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {mostrarRevisao && (
          <div className="com-revisao-entrada">
            <div className="field-group">
              <label htmlFor="com-proposta-revisao">
                Número da proposta existente
              </label>
              <input
                id="com-proposta-revisao"
                autoFocus
                inputMode="numeric"
                value={codigo}
                placeholder="Ex.: 4418"
                onChange={(evento) =>
                  setCodigo(evento.target.value.replace(/\D/g, ''))
                }
                onKeyDown={(evento) => {
                  if (evento.key === 'Enter') carregar();
                }}
              />
            </div>
            <button
              type="button"
              className="com-btn com-btn-fantasma"
              disabled={carregando || !codigo.trim()}
              onClick={carregar}
            >
              {carregando ? 'Carregando...' : 'Carregar revisão'}
            </button>
          </div>
        )}

        {recado && <p className="com-recado">{recado}</p>}
      </section>
    </div>
  );
}
