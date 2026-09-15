import { MoneyField, Field, NumberField, SelectField } from '../../components/Field';
import { ConfirmacaoEscopo } from '../ConfirmacaoEscopo';
import { money, number, numberValue, percent } from '../formato';
import {
  custoTotalLogistica,
  custoTotalMateriaisEInsumos
} from '../totaisDasSecoes';
import type { Levantamento } from '../useLevantamento';

/**
 * Seção 5 — Resumo e QQP.
 *
 * `CUSTO-CTL-395..465` (71 controles). Porte de `SummarySection`
 * (`app/custos/page.tsx:1958-...`).
 *
 * É onde o custo vira **preço**: a apresentação comercial escolhe se o preço
 * é derivado do custo ou imposto pelo comercial, e as comissões entram sobre
 * ele. Também é onde vive a quarta pendência do rodapé-guia — a de comissões.
 *
 * O ponto que faz esta tela importar: **o preço global fechado não é um
 * desconto**. Quando o comercial impõe o valor, o motor recalcula margem e
 * saldo por diferença — e se houver comissão de representante, aplica o
 * gross-up e eleva o preço ao mínimo que preserva a margem configurada. Quem
 * digita um preço sem entender isso acha que está dando desconto e está
 * mudando a conta inteira.
 */

type AnyRecord = Record<string, unknown>;

const MODOS_PRECO = [
  { value: 'calculated', label: 'Calculado a partir do custo' },
  { value: 'global', label: 'Preço global fechado' }
];

const BASES_COMISSAO = [
  {
    value: 'net_after_tax',
    label: 'Valor líquido após impostos — o que entra na conta'
  },
  { value: 'gross_invoice', label: 'Valor bruto da nota fiscal' }
];

export function ResumoSection({ levantamento }: { levantamento: Levantamento }) {
  const { draft, result, setDraft, erroSe } = levantamento;

  const comercial = (draft.commercial as AnyRecord) || {};
  const comissao = (comercial.representativeCommission as AnyRecord) || {};
  const precoImposto = comercial.pricingMode === 'global';

  function editarComercial(patch: AnyRecord) {
    setDraft(atual => ({
      ...atual,
      commercial: { ...((atual.commercial as AnyRecord) || {}), ...patch }
    }));
  }

  function editarComissao(patch: AnyRecord) {
    setDraft(atual => {
      const atualComercial = (atual.commercial as AnyRecord) || {};
      return {
        ...atual,
        commercial: {
          ...atualComercial,
          representativeCommission: {
            ...((atualComercial.representativeCommission as AnyRecord) || {}),
            ...patch
          }
        }
      };
    });
  }

  const lucro = numberValue(result.profitValue);

  return (
    <>
      <section className="com-painel">
        <div className="com-secao-titulo">
          <div>
            <h2>Apresentação comercial</h2>
            <p>
              Escolha se o preço sai do custo ou é imposto pelo comercial. O QQP entra na
              proposta quando marcado.
            </p>
          </div>
        </div>

        <div className="com-form-grid">
          <SelectField
            label="Modo de precificação"
            value={String(comercial.pricingMode || 'calculated')}
            options={MODOS_PRECO}
            onChange={valor => editarComercial({ pricingMode: valor })}
          />

          {precoImposto && (
            <MoneyField
              label="Valor global fechado"
              required
              value={comercial.globalValue}
              error={erroSe(numberValue(comercial.globalValue) <= 0, 'Informe o valor fechado')}
              onChange={valor => editarComercial({ globalValue: valor })}
            />
          )}
        </div>

        {precoImposto && (
          <small className="com-nota">
            Neste modo o valor digitado é a base comercial. Havendo comissão de
            representante, o sistema aplica o gross-up e, se necessário, eleva o preço ao
            mínimo que preserva a margem configurada.
          </small>
        )}

        <label className="com-incluir com-incluir-bloco">
          <input
            type="checkbox"
            checked={comercial.includeQqp === true}
            onChange={event => editarComercial({ includeQqp: event.target.checked })}
          />
          Incluir o quadro de quantidades e preços (QQP) na proposta
        </label>
      </section>

      <section className="com-painel">
        <div className="com-secao-titulo">
          <div>
            <h2>Comissões e indicações</h2>
            <p>
              Comissão de representante e bônus de indicação entram na formação do preço,
              não como desconto depois.
            </p>
          </div>
        </div>

        <ConfirmacaoEscopo
          confirmado={comissao.enabled === true}
          tituloPendente="Sem representante nesta proposta"
          tituloConfirmado="Comissão de representante incluída"
          descricaoPendente="Marque apenas se houver representante externo — a comissão entra no cálculo do preço."
          descricaoConfirmada="O percentual entra na formação do preço, com gross-up quando necessário."
          rotulo="Há comissão de representante"
          onChange={valor => editarComissao({ enabled: valor })}
        />

        {comissao.enabled === true && (
          <div className="com-form-grid">
            <Field
              label="Nome do representante"
              required
              value={String(comissao.representativeName || '')}
              error={erroSe(!String(comissao.representativeName || '').trim(), 'Campo obrigatório')}
              onChange={valor => editarComissao({ representativeName: valor })}
            />

            <NumberField
              label="Percentual"
              required
              value={comissao.percent}
              min={0}
              max={99}
              step={0.01}
              error={erroSe(numberValue(comissao.percent) <= 0, 'Informe o percentual')}
              onChange={valor => editarComissao({ percent: valor })}
            />

            <SelectField
              label="Base de cálculo"
              value={String(comissao.basis || 'net_after_tax')}
              options={BASES_COMISSAO}
              onChange={valor => editarComissao({ basis: valor })}
            />
          </div>
        )}
      </section>

      <section className="com-painel">
        <div className="com-secao-titulo">
          <div>
            <h2>Formação do preço</h2>
            <p>De onde vem cada parcela do valor da proposta.</p>
          </div>
        </div>

        <div className="com-resumo-grade">
          <Dado label="Mão de obra" valor={money(numberValue(result.laborCost))} />
          <Dado
            label="Materiais e insumos"
            valor={money(custoTotalMateriaisEInsumos(result))}
          />
          <Dado label="Logística" valor={money(custoTotalLogistica(result))} />
          <Dado label="Custos indiretos" valor={money(numberValue(result.indirectCost))} />
          <Dado label="Custo direto" valor={money(numberValue(result.directCost))} destaque />
          <Dado label="Custo total" valor={money(numberValue(result.totalCost))} destaque />
          <Dado label="Impostos" valor={money(numberValue(result.taxValue))} />
          <Dado label="Comissão" valor={money(numberValue(result.commissionValue))} />
          <Dado
            label="Lucro"
            valor={money(lucro)}
            /* Lucro negativo é a informação mais importante desta tela.
               Num quadro de 12 números, ele some se não for marcado. */
            tom={lucro >= 0 ? 'positivo' : 'negativo'}
          />
          <Dado label="Margem" valor={percent(numberValue(result.margin))} />
          <Dado
            label="Valor da proposta"
            valor={money(numberValue(result.salePrice))}
            destaque
          />
          <Dado
            label="Pico simultâneo"
            valor={`${number(numberValue(result.peakHeadcount))} pessoas`}
          />
        </div>

        {!result.validPricing && (
          <small className="com-nota com-nota-alerta">
            A precificação ainda não fecha. Verifique as seções pendentes antes de salvar.
          </small>
        )}
      </section>
    </>
  );
}

function Dado({
  label,
  valor,
  destaque,
  tom
}: {
  label: string;
  valor: string;
  destaque?: boolean;
  tom?: 'positivo' | 'negativo';
}) {
  const classes = [
    'com-dado',
    destaque ? 'com-dado-destaque' : '',
    tom ? `com-dado-${tom}` : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={classes}>
      <span>{label}</span>
      <strong className="com-quebrar">{valor}</strong>
    </article>
  );
}
