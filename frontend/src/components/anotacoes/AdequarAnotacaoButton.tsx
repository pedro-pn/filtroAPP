import { useEffect, useId, useRef, useState } from 'react';

import { adequarAnotacao } from '../../api/anotacoes';
import { useAdequacaoConfig, useAdequacaoPermitida } from '../../hooks/useAdequacaoAnotacao';
import { Modal } from '../ui/Modal';
import { Alert, Button, Field, Spinner, Textarea } from '../ui/ds';
import './AdequarAnotacaoButton.css';

interface AdequarAnotacaoButtonProps {
  /** Texto atual do campo (a anotação original). */
  valor: string;
  /** Nome do campo, usado no título do painel (ex.: "Atividades do dia"). */
  campo: string;
  /** Chamado só quando o usuário clica em "Aplicar ao campo". */
  onAplicar: (texto: string) => void;
  disabled?: boolean;
}

function mensagemDeErro(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Não foi possível adequar a anotação agora.';
}

/**
 * "Adequar para relatório": envia a anotação ao backend (OpenAI), mostra o original e o texto
 * adequado lado a lado; o usuário edita e decide se aplica. Nada é gravado automaticamente.
 */
export function AdequarAnotacaoButton(props: AdequarAnotacaoButtonProps) {
  // Só gestor/coordenador do RDO chegam a consultar a configuração do servidor.
  return useAdequacaoPermitida() ? <AdequarAnotacaoComConfig {...props} /> : null;
}

function AdequarAnotacaoComConfig({ valor, campo, onAplicar, disabled }: AdequarAnotacaoButtonProps) {
  const { disponivel, maxCaracteres } = useAdequacaoConfig();
  const tituloId = useId();
  const [aberto, setAberto] = useState(false);
  const [original, setOriginal] = useState('');
  const [resultado, setResultado] = useState('');
  const [avisos, setAvisos] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const controle = useRef<AbortController | null>(null);

  useEffect(() => () => controle.current?.abort(), []);

  if (!disponivel) return null;

  const texto = valor.trim();
  const grandeDemais = texto.length > maxCaracteres;

  async function enviar(anotacao: string) {
    if (carregando) return; // sem envios simultâneos
    controle.current?.abort();
    const atual = new AbortController();
    controle.current = atual;
    setCarregando(true);
    setErro(null);
    try {
      const r = await adequarAnotacao(anotacao, atual.signal);
      if (atual.signal.aborted) return;
      setResultado(r.textoFormatado);
      setAvisos(r.avisos || []);
    } catch (error) {
      if (!atual.signal.aborted) setErro(mensagemDeErro(error));
    } finally {
      if (controle.current === atual) setCarregando(false);
    }
  }

  function abrir() {
    setOriginal(valor);
    setResultado('');
    setAvisos([]);
    setAberto(true);
    void enviar(valor);
  }

  function fechar() {
    controle.current?.abort();
    setCarregando(false);
    setAberto(false);
  }

  function aplicar() {
    onAplicar(resultado);
    setAberto(false);
  }

  return (
    <>
      <div className="adequar-anotacao__acao">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={disabled || !texto || grandeDemais || carregando}
          title={grandeDemais ? `A anotação passa de ${maxCaracteres} caracteres.` : !texto ? 'Escreva a anotação primeiro.' : undefined}
          onClick={abrir}
        >
          Adequar para relatório
        </Button>
        {grandeDemais ? <small className="adequar-anotacao__ajuda">Limite de {maxCaracteres} caracteres para adequar.</small> : null}
      </div>
      {aberto ? (
        <Modal
          open
          onClose={fechar}
          size="lg"
          appearance="design-system"
          panelClassName="adequar-anotacao rdo-ds-actions"
          ariaLabelledBy={tituloId}
          closeOnBackdrop={false}
          title={<h2 id={tituloId} className="adequar-anotacao__titulo">Adequar para relatório · {campo}</h2>}
          footer={(
            <>
              <Button variant="secondary" size="sm" type="button" onClick={fechar}>Descartar</Button>
              <Button variant="primary" size="sm" type="button" disabled={carregando || !resultado.trim()} onClick={aplicar}>
                Aplicar ao campo
              </Button>
            </>
          )}
        >
          <p className="adequar-anotacao__ajuda">
            Revise e edite o texto adequado. A anotação original só é substituída se você clicar em "Aplicar ao campo";
            depois, salve o relatório normalmente.
          </p>
          {erro ? (
            <Alert tone="danger" title={erro}>
              <Button variant="secondary" size="sm" type="button" onClick={() => void enviar(original)}>Tentar novamente</Button>
            </Alert>
          ) : null}
          {avisos.length ? (
            <Alert tone="warning" title="Confira antes de aplicar">
              <ul className="adequar-anotacao__avisos">{avisos.map(a => <li key={a}>{a}</li>)}</ul>
            </Alert>
          ) : null}
          <div className="adequar-anotacao__colunas">
            <Field label="Anotação original" optionalText="">
              <Textarea value={original} readOnly rows={12} />
            </Field>
            <Field label="Texto adequado" optionalText="">
              {carregando ? (
                <div className="adequar-anotacao__carregando"><Spinner label="Adequando a anotação…" /></div>
              ) : (
                <Textarea value={resultado} rows={12} disabled={!resultado && Boolean(erro)} onChange={e => setResultado(e.target.value)} />
              )}
            </Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
