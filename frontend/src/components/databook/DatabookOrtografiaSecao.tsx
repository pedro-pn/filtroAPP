import type { DatabookRevisaoPreparada } from '../../api/databook';
import { Alert, Select } from '../ui/ds';

interface DatabookOrtografiaSecaoProps {
  preparada: DatabookRevisaoPreparada;
  correcoes: Record<string, string>;
  disabled?: boolean;
  onChange: (correcoes: Record<string, string>) => void;
}

/**
 * Possíveis erros de ortografia nos textos dos relatórios (atividades, OBS, comentários). Nada é
 * trocado sozinho: a correção escolhida vale para a palavra inteira, só nesses textos.
 */
export function DatabookOrtografiaSecao({ preparada, correcoes, disabled, onChange }: DatabookOrtografiaSecaoProps) {
  const ortografia = preparada.ortografia;
  if (!ortografia) return null;
  return (
    <section className="databook-revisao__secao" aria-labelledby="databook-ortografia-titulo">
      <h3 id="databook-ortografia-titulo">Ortografia dos textos dos relatórios</h3>
      {!ortografia.disponivel ? (
        <Alert tone="info" title="Verificação ortográfica indisponível neste servidor." />
      ) : !ortografia.palavras.length ? (
        <Alert tone="success" title="Nenhuma palavra suspeita nas atividades e observações." />
      ) : (
        <>
          <p className="databook-revisao__ajuda">
            Escolha a correção de cada palavra ou mantenha como está. A troca vale para a palavra inteira, apenas nas
            atividades, OBS e comentários; tags, horários, números e nomes nunca são alterados.
          </p>
          <ul className="databook-revisao__ortografia">
            {ortografia.palavras.map(p => (
              <li key={p.palavra}>
                <div className="databook-revisao__ortografia-palavra">
                  <strong>{p.palavra}</strong>
                  <span className="databook-revisao__ajuda">
                    {p.ocorrencias.length}× · {p.ocorrencias[0].data} · {p.ocorrencias[0].campo}: “…{p.ocorrencias[0].trecho}…”
                  </span>
                </div>
                <Select
                  aria-label={`Correção para ${p.palavra}`}
                  value={correcoes[p.palavra] || ''}
                  disabled={disabled}
                  options={[{ value: '', label: 'Manter como está' }, ...p.sugestoes.map(s => ({ value: s, label: `Trocar por “${s}”` }))]}
                  onChange={e => onChange({ ...correcoes, [p.palavra]: e.target.value })}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
