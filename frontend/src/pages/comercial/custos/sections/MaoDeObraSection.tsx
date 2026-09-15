import {
  HOTEL_SITE_COMMUTE_EXPENSE_CODE,
  LEC_CONTEXT_EXPENSE_PRESETS,
  LEC_CONTEXT_EXPENSES,
  roleSalary
} from '../../../../../../shared/comercial/dist/cost-model.js';
import { AvisoPendencia, ConfirmacaoEscopo } from '../ConfirmacaoEscopo';
import { money, number, numberValue, people } from '../formato';
import { custoTotalMaoDeObra } from '../totaisDasSecoes';
import type { Levantamento } from '../useLevantamento';
import { FaseCard } from './FaseCard';

/**
 * Seção 2 — Mão de obra por fases.
 *
 * É a maior das cinco: `CUSTO-CTL-039..137`, 99 controles. Porte de
 * `LaborSection` (`app/custos/page.tsx:639-1038`).
 *
 * **Este passo entrega a moldura da seção**: confirmação de escopo, os quatro
 * avisos de pendência, o resumo de três indicadores e a lista de fases com o
 * que cada uma exige. A edição por alocação — cargo, salário, turno, horas,
 * despesas — é o grosso dos 99 controles e vem no passo seguinte.
 *
 * O que já é real aqui: a **pendência** que alimenta o rodapé-guia. Com esta
 * seção no ar, o botão do rodapé passa a dizer "Preencher itens obrigatórios
 * da mão de obra →" de verdade, e levar até aqui.
 */

type AnyRecord = Record<string, unknown>;

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

function id(prefixo: string) {
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Cria a fase padrão de execução usada pela referência do levantamento. */
function novaFase(indice: number, inicio: number): AnyRecord {
  const funcao = indice === 0 ? 'COORDENADOR' : 'OPERADOR';

  return {
    id: id('fase'),
    name: indice === 0 ? 'Pré-engenharia' : `Etapa ${indice}`,
    description:
      indice === 0 ? 'Planejamento, levantamento e preparação antes da execução.' : '',
    startOffsetDays: inicio,
    durationDays: 30,
    workingDays: 22,
    hoursPerDay: 8.8,
    workCondition: '',
    workConditionConfirmed: false,
    hotelSiteDistanceKmPerDay: LEC_CONTEXT_EXPENSES.hotelSiteDistanceKmPerDay,
    weekdayExtra70HoursPerDay: 0,
    saturdayCount: 0,
    saturdayHoursPerDay: 0,
    sundayCount: 0,
    sundayHoursPerDay: 0,
    vehicleType: '',
    vehicleCountMode: 'automatic',
    vehicleCount: 0,
    assignments: [{
      id: id('cargo'),
      role: funcao,
      quantity: 1,
      monthlySalary: roleSalary(funcao),
      adjustment: 0,
      allocationPercent: 100,
      shift: 'day',
      nightPremiumPercent: 35,
      notes: ''
    }],
    expenses: (LEC_CONTEXT_EXPENSE_PRESETS as ReadonlyArray<AnyRecord>).map(item => ({
      ...item,
      id: id('despesa-lec'),
      included: item.basis === 'per_vehicle_staffed_day' || indice > 0
    })),
    enabled: true
  };
}

export function MaoDeObraSection({ levantamento }: { levantamento: Levantamento }) {
  const { draft, result, setDraft } = levantamento;

  const confirmacoes = (draft.scopeConfirmations as AnyRecord) || {};
  const semMaoDeObra = confirmacoes.noLabor === true;
  const fases = registros(draft.laborContexts);

  function definirSemMaoDeObra(valor: boolean) {
    setDraft(atual => ({
      ...atual,
      scopeConfirmations: { ...((atual.scopeConfirmations as AnyRecord) || {}), noLabor: valor }
    }));
  }

  function incluirOuAdicionarFase() {
    setDraft(atual => {
      const atuais = registros(atual.laborContexts);
      const confirmacoesAtuais = (atual.scopeConfirmations as AnyRecord) || {};
      const apenasReativar = confirmacoesAtuais.noLabor === true && atuais.length > 0;
      const ultimoFim = atuais.reduce(
        (maior, fase) =>
          Math.max(
            maior,
            numberValue(fase.startOffsetDays) + numberValue(fase.durationDays)
          ),
        0
      );

      return {
        ...atual,
        laborContexts: apenasReativar
          ? atuais
          : [...atuais, novaFase(atuais.length, ultimoFim)],
        scopeConfirmations: apenasReativar
          ? { ...confirmacoesAtuais, noLabor: false }
          : {
              ...confirmacoesAtuais,
              noLabor: false,
              mobilizationCrewAlreadyOnSite: false,
              demobilizationCrewAlreadyOnSite: false
            }
      };
    });
  }

  // Os quatro avisos da referência, na mesma ordem. Eles são por SEÇÃO, não
  // por campo — dizem que existe fase incompleta, e a marcação vermelha por
  // campo (L1) diz qual. Os dois convivem.
  const faseSemCondicao = fases.some(f => !f.workCondition || !f.workConditionConfirmed);
  const faseSemVeiculo = fases.some(f => !f.vehicleType);
  const faseSemDistancia = fases.some(
    f => f.workCondition === 'travel'
      && f.vehicleType !== 'none'
      && numberValue(f.hotelSiteDistanceKmPerDay) <= 0
  );
  const faseSemCombustivel = fases.some(f => {
    if (f.workCondition !== 'travel' || f.vehicleType === 'none') return false;
    const combustivel = registros(f.expenses).find(
      d => d.code === HOTEL_SITE_COMMUTE_EXPENSE_CODE
    );
    return (
      !combustivel ||
      combustivel.included === false ||
      numberValue(combustivel.quantity) <= 0 ||
      numberValue(combustivel.unitValue) <= 0
    );
  });

  return (
    <section className="com-painel">
      <div className="com-secao-titulo">
        <div>
          <h2>Mão de obra por fases</h2>
          <p>
            Cada fase usa exclusivamente os cargos e a composição salarial do LEC. Informe a
            condição da obra e separe jornada normal, HE 70% e HE 100%.
          </p>
        </div>
        <button type="button" className="com-btn-add" onClick={incluirOuAdicionarFase}>
          {semMaoDeObra ? 'Incluir mão de obra' : '+ Adicionar fase'}
        </button>
      </div>

      <ConfirmacaoEscopo
        confirmado={semMaoDeObra}
        tituloPendente="Revisão obrigatória da mão de obra"
        tituloConfirmado="Sem mão de obra confirmado"
        descricaoPendente="Se realmente não houver colaboradores neste escopo, confirme para evitar uma omissão acidental."
        descricaoConfirmada="As fases ficam preservadas, mas não entram neste levantamento."
        rotulo="Confirmo que não haverá mão de obra"
        onChange={definirSemMaoDeObra}
      />

      {!semMaoDeObra && faseSemCondicao && (
        <AvisoPendencia>
          Selecione obrigatoriamente a condição de trabalho em todas as fases: Sede, Em viagem
          ou Offshore.
        </AvisoPendencia>
      )}
      {!semMaoDeObra && faseSemVeiculo && (
        <AvisoPendencia>
          Selecione o veículo obrigatório em todas as fases para liberar o salvamento do
          levantamento.
        </AvisoPendencia>
      )}
      {!semMaoDeObra && faseSemDistancia && (
        <AvisoPendencia>
          Informe a distância diária entre hotel e obra nas fases em viagem.
        </AvisoPendencia>
      )}
      {!semMaoDeObra && faseSemCombustivel && (
        <AvisoPendencia>
          O combustível do deslocamento hotel ↔ obra é obrigatório nas fases em viagem.
        </AvisoPendencia>
      )}

      {!semMaoDeObra && (
        <>
          <div className="com-visao-geral" aria-label="Resumo geral da mão de obra">
            <article>
              <span>Pico simultâneo</span>
              <strong>
                {people(numberValue(result.peakHeadcount), 'colaborador', 'colaboradores')}
              </strong>
              <small>Maior equipe ativa no mesmo período</small>
            </article>
            <article>
              <span>Pessoa-dias</span>
              <strong>{number(numberValue(result.totalPersonDays))}</strong>
              <small>Somatório das alocações nas fases</small>
            </article>
            <article>
              <span>HH total</span>
              <strong>{number(numberValue(result.totalLaborHours))} HH</strong>
              <small>Jornada normal e horas extras</small>
            </article>
          </div>

          <div className="com-nota-regra">
            <strong>Regra para fases em viagem</strong>
            <span>
              O padrão considera 50 km diários no trajeto hotel ↔ obra e R$ 50 de combustível
              por veículo a cada dia trabalhado. Sábados, domingos e feriados informados
              também entram no cálculo.
            </span>
          </div>

          <div className="com-fases">
            {fases.map((fase, indice) => (
              <FaseCard
                key={String(fase.id ?? indice)}
                fase={fase}
                indice={indice}
                total={fases.length}
                levantamento={levantamento}
              />
            ))}
          </div>

        </>
      )}

      <div className="com-total-secao" aria-label="Custo total da aba Mão de obra">
        <strong>Custo total desta aba</strong>
        <span>{money(custoTotalMaoDeObra(result))}</span>
      </div>
    </section>
  );
}
