import { useId } from 'react';

/**
 * Confirmação de escopo — "Confirmo que não haverá mão de obra".
 *
 * Porte de `.scope-confirmation` (`app/custos/page.tsx:680`). Reusada por mão
 * de obra, materiais e insumos, e logística.
 *
 * **Não é um checkbox de conveniência.** Um levantamento pode legitimamente
 * não ter mão de obra, e sem esta confirmação ele ficaria travado para sempre
 * no rodapé-guia — com a saída óbvia sendo preencher qualquer coisa, o que
 * produz preço errado. A confirmação transforma "está vazio" em "o usuário
 * disse que não se aplica", que são coisas diferentes.
 *
 * Por isso a caixa é âmbar quando pendente e verde quando confirmada: é um
 * aviso enquanto ninguém decidiu, e um registro depois.
 */

export function ConfirmacaoEscopo({
  confirmado,
  tituloPendente,
  tituloConfirmado,
  descricaoPendente,
  descricaoConfirmada,
  rotulo,
  error,
  onChange
}: {
  confirmado: boolean;
  tituloPendente: string;
  tituloConfirmado: string;
  descricaoPendente: string;
  descricaoConfirmada: string;
  rotulo: string;
  error?: string;
  onChange: (valor: boolean) => void;
}) {
  const errorId = useId();
  return (
    <div className={`com-confirmacao${confirmado ? ' is-confirmada' : ''}${error ? ' com-campo-invalido' : ''}`}>
      <div>
        <strong>{confirmado ? tituloConfirmado : tituloPendente}</strong>
        <span>{confirmado ? descricaoConfirmada : descricaoPendente}</span>
        {error && <small id={errorId} className="field-error">{error}</small>}
      </div>
      <label>
        <input
          type="checkbox"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          checked={confirmado}
          onChange={event => onChange(event.target.checked)}
        />
        <b>{rotulo}</b>
      </label>
    </div>
  );
}

/** Aviso de pendência dentro da seção. */
export function AvisoPendencia({ children }: { children: React.ReactNode }) {
  return (
    <div className="com-aviso" role="status">
      {children}
    </div>
  );
}
