import {
  LOGISTICS_TRAVEL_DEFAULTS,
  VEHICLE_RENTAL_CALENDAR_DAY_EXPENSE_CODE,
  isLogisticsCalculationModeAllowed,
  logisticsCrewCoverage,
  normalizeCostEstimatePayload
} from '../../../../../shared/comercial/dist/cost-model.js';
import { numberValue } from './formato';

/**
 * Predicados de logística — a última peça da cadeia do rodapé-guia.
 *
 * Porte de `crewTransportWaived`, `logisticsItemNeedsAttention` e
 * `logisticsGroupsNeedAttention` (`app/custos/page.tsx`). São **171 linhas de
 * lógica densa** no original, e o predicado mais complexo do app.
 *
 * Por que vive num módulo à parte, e não dentro da seção: ele é a única coisa
 * que impede o rodapé de mandar o usuário para uma tela que não sabe validar.
 * Isolado, dá para testá-lo modo a modo sem montar os 166 controles da seção.
 *
 * Os modos de cálculo mudam quais campos são obrigatórios — frete externo
 * cobra quantidade, viagens e custo unitário; transporte de equipe cobra
 * vínculo com a fase, viajantes e capacidade de veículo. Tratar todos igual
 * cobraria campo que não se aplica, e é o caminho mais curto para o usuário
 * aprender a ignorar o aviso.
 */

type AnyRecord = Record<string, unknown>;

const MODOS_TRANSPORTE_EQUIPE = [
  'company_crew_vehicle',
  'rental_crew_vehicle',
  'bus_crew_transport',
  'air_crew_transport'
];

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

/**
 * O item de transporte de equipe está dispensado?
 *
 * Sem esta dispensa, um levantamento cuja equipe já está na obra ficaria
 * cobrando transporte que não vai acontecer — e a única saída seria inventar
 * um deslocamento.
 */
export function transporteDispensado(
  item: AnyRecord,
  confirmacoes: AnyRecord = {}
): boolean {
  if (
    confirmacoes.combinedCrewAndEquipmentTransport === true &&
    item.requiredSlot === true &&
    item.slotType === 'equipment'
  ) {
    return true;
  }
  if (!item.requiredSlot || item.slotType !== 'crew') return false;
  if (confirmacoes.noLabor === true) return true;
  // Modo de cálculo confirmado vence a dispensa: quem escolheu como calcular
  // está dizendo que o deslocamento existe.
  if (item.calculationModeConfirmed && item.calculationMode) return false;
  return item.direction === 'mobilization'
    ? confirmacoes.mobilizationCrewAlreadyOnSite === true
    : confirmacoes.demobilizationCrewAlreadyOnSite === true;
}

/** Quantas pessoas cada alocação da fase disponibiliza, arredondado para cima. */
function disponiveisPorAlocacao(fase: AnyRecord | undefined): Map<string, number> {
  return new Map(
    registros(fase?.assignments).map(alocacao => [
      String(alocacao.id),
      Math.ceil(
        (numberValue(alocacao.quantity) * numberValue(alocacao.allocationPercent)) / 100
      )
    ])
  );
}

/**
 * O item de logística está incompleto?
 *
 * Transcrição fiel de `logisticsItemNeedsAttention`. A ordem das condições é a
 * do original — ela importa porque as primeiras são baratas e as últimas
 * dependem de contas.
 */
export function itemPrecisaAtencao(item: AnyRecord, fases: AnyRecord[] = []): boolean {
  if (item.included === false) return false;

  // Desmobilização com espelhamento pendente: alguém precisa decidir se o
  // retorno repete a ida ou é diferente.
  if (
    item.direction === 'demobilization' &&
    item.requiredSlot &&
    item.returnSetup === 'pending'
  ) {
    return true;
  }

  if (!item.calculationMode || !item.calculationModeConfirmed) return true;
  if (!isLogisticsCalculationModeAllowed(
    String(item.calculationMode), String(item.slotType || ''), item.requiredSlot === true
  )) return true;

  // Custo adicional incluído precisa de descrição, quantidade e valor.
  if (
    registros(item.additionalCosts).some(
      adicional =>
        adicional.included !== false &&
        (!String(adicional.description || '').trim() ||
          numberValue(adicional.quantity) <= 0 ||
          numberValue(adicional.unitCost) <= 0)
    )
  ) {
    return true;
  }

  if (item.calculationMode === 'external_freight') {
    return (
      numberValue(item.quantity) <= 0 ||
      numberValue(item.trips) <= 0 ||
      numberValue(item.unitCost) <= 0
    );
  }

  const veiculoProprio = item.calculationMode === 'company_crew_vehicle';
  const veiculoAlugado = item.calculationMode === 'rental_crew_vehicle';
  const onibus = item.calculationMode === 'bus_crew_transport';
  const aereo = item.calculationMode === 'air_crew_transport';
  const comPassagem = onibus || aereo;
  const transporteEquipe = veiculoProprio || veiculoAlugado || comPassagem;
  const caminhaoProprio = item.calculationMode === 'company_truck_driver';
  const usaVeiculoRodoviario = veiculoProprio || veiculoAlugado || caminhaoProprio;
  const usaViagemDeEquipe = transporteEquipe || caminhaoProprio;

  if (!usaViagemDeEquipe) return false;

  const fase = fases.find(f => f.id === item.contextId);
  const usaViajantesPorAlocacao = item.travelerAssignmentsConfirmed !== false;

  const efetivoBruto = registros(fase?.assignments).reduce(
    (soma, alocacao) =>
      soma +
      (numberValue(alocacao.quantity) * numberValue(alocacao.allocationPercent)) / 100,
    0
  );

  const disponiveis = disponiveisPorAlocacao(fase);
  const efetivoVinculado = [...disponiveis.values()].reduce((s, q) => s + q, 0);

  const selecionados = new Map<string, number>();
  let selecaoInvalida = false;

  for (const viajante of registros(item.travelerAssignments)) {
    const alocacaoId = String(viajante.assignmentId || '');
    const quantidade = numberValue(viajante.quantity);
    if (
      usaViajantesPorAlocacao &&
      (!disponiveis.has(alocacaoId) || quantidade <= 0 || !Number.isInteger(quantidade))
    ) {
      selecaoInvalida = true;
      continue;
    }
    selecionados.set(alocacaoId, (selecionados.get(alocacaoId) || 0) + quantidade);
  }

  // Não dá para mandar viajar mais gente do que a alocação tem.
  if (
    usaViajantesPorAlocacao &&
    [...selecionados].some(([id, qtd]) => qtd > (disponiveis.get(id) || 0))
  ) {
    selecaoInvalida = true;
  }

  const automaticoPorAlocacao = transporteEquipe ? efetivoVinculado : 0;
  const pessoasPorAlocacao =
    item.travelerCountMode === 'manual'
      ? [...selecionados.values()].reduce((s, q) => s + q, 0)
      : automaticoPorAlocacao;

  const automaticoLegado = transporteEquipe
    ? Math.ceil(efetivoBruto)
    : item.vehicleCountMode === 'manual'
      ? numberValue(item.vehicleCount)
      : 1;
  const pessoasLegado =
    item.travelerCountMode === 'manual'
      ? numberValue(item.travelerCount)
      : automaticoLegado;

  const pessoas = usaViajantesPorAlocacao ? pessoasPorAlocacao : pessoasLegado;

  const capacidade =
    veiculoProprio || veiculoAlugado
      ? Math.min(
          (LOGISTICS_TRAVEL_DEFAULTS as AnyRecord).passengersPerCompanyCar as number,
          Math.max(1, numberValue(item.passengersPerVehicle))
        )
      : caminhaoProprio
        ? 1
        : 0;

  const veiculosAutomaticos =
    veiculoProprio || veiculoAlugado
      ? pessoas > 0
        ? Math.ceil(pessoas / capacidade)
        : 0
      : caminhaoProprio
        ? usaViajantesPorAlocacao
          ? pessoas
          : 1
        : 0;

  const veiculos =
    item.vehicleCountMode === 'manual'
      ? numberValue(item.vehicleCount)
      : veiculosAutomaticos;

  const diasDeViagem = usaVeiculoRodoviario
    ? numberValue(item.dailyDistanceLimitKm) > 0
      ? Math.ceil(
          numberValue(item.distanceKmPerVehicle) / numberValue(item.dailyDistanceLimitKm)
        ) * numberValue(item.trips)
      : 0
    : numberValue(item.travelCalendarDaysPerTrip) * numberValue(item.trips);

  const aluguelDuplicado =
    veiculoAlugado &&
    item.direction === 'mobilization' &&
    item.rentalUse === 'mobilization_and_site' &&
    registros(fase?.expenses).some(
      despesa =>
        despesa.code === VEHICLE_RENTAL_CALENDAR_DAY_EXPENSE_CODE &&
        despesa.included !== false
    );

  const exigeHospedagem =
    usaVeiculoRodoviario ||
    (onibus && item.busOvernightMode === 'hotel_stop') ||
    (aereo && numberValue(item.travelCalendarDaysPerTrip) > 1);

  const custosDeViagemInvalidos =
    numberValue(item.travelHoursPerDay) <= 0 ||
    numberValue(item.travelHoursPerDay) >
      (comPassagem
        ? 24
        : ((LOGISTICS_TRAVEL_DEFAULTS as AnyRecord).travelHoursPerDay as number)) ||
    numberValue(item.trips) <= 0 ||
    numberValue(item.mealPerPersonDay) <= 0 ||
    (comPassagem &&
      (!Number.isInteger(numberValue(item.travelCalendarDaysPerTrip)) ||
        numberValue(item.travelCalendarDaysPerTrip) <= 0)) ||
    (exigeHospedagem && numberValue(item.lodgingPerPersonDay) <= 0) ||
    (usaVeiculoRodoviario &&
      (numberValue(item.dailyDistanceLimitKm) <= 0 ||
        numberValue(item.dailyDistanceLimitKm) >
          ((LOGISTICS_TRAVEL_DEFAULTS as AnyRecord).dailyDistanceLimitKm as number) ||
        numberValue(item.fuelEfficiencyKmPerLiter) <= 0 ||
        numberValue(item.fuelPricePerLiter) <= 0)) ||
    (comPassagem && numberValue(item.ticketPerPersonPerTrip) <= 0) ||
    (onibus && !item.busOvernightMode) ||
    (onibus &&
      item.busOvernightMode === 'hotel_stop' &&
      numberValue(item.lodgingNightsPerTrip) <= 0) ||
    (aereo &&
      numberValue(item.travelCalendarDaysPerTrip) > 1 &&
      numberValue(item.lodgingNightsPerTrip) <= 0) ||
    (veiculoAlugado &&
      (!item.rentalUse ||
        numberValue(item.rentalDailyRate) <= 0 ||
        (item.direction === 'mobilization' &&
          item.rentalUse === 'mobilization_and_site' &&
          numberValue(item.rentalSiteDays) <= 0)));

  return (
    !item.contextId ||
    fase?.enabled === false ||
    selecaoInvalida ||
    pessoas <= 0 ||
    (!usaViajantesPorAlocacao && pessoas > Math.ceil(efetivoBruto)) ||
    (usaVeiculoRodoviario && veiculos <= 0) ||
    (usaVeiculoRodoviario && numberValue(item.distanceKmPerVehicle) <= 0) ||
    (usaVeiculoRodoviario &&
      item.vehicleCountMode === 'manual' &&
      numberValue(item.vehicleCount) <= 0) ||
    (usaVeiculoRodoviario &&
      usaViajantesPorAlocacao &&
      item.vehicleCountMode === 'manual' &&
      !Number.isInteger(numberValue(item.vehicleCount))) ||
    numberValue(item.travelSaturdayDays) + numberValue(item.travelSundayDays) >
      diasDeViagem ||
    ((veiculoProprio || veiculoAlugado) &&
      (numberValue(item.passengersPerVehicle) < 1 ||
        numberValue(item.passengersPerVehicle) >
          ((LOGISTICS_TRAVEL_DEFAULTS as AnyRecord).passengersPerCompanyCar as number) ||
        (usaViajantesPorAlocacao &&
          !Number.isInteger(numberValue(item.passengersPerVehicle))) ||
        veiculos * capacidade < pessoas)) ||
    (caminhaoProprio && pessoas < veiculos) ||
    custosDeViagemInvalidos ||
    Boolean(aluguelDuplicado)
  );
}

/**
 * Existem itens do mesmo grupo (direção + fase) que se contradizem?
 *
 * Dois transportes para a mesma equipe na mesma direção não podem ambos
 * calcular viajantes automaticamente — cada um contaria a equipe inteira, e o
 * custo sairia dobrado.
 */
export function gruposPrecisamAtencao(
  logistica: AnyRecord[] = [],
  fases: AnyRecord[] = []
): boolean {
  const grupos = new Map<string, AnyRecord[]>();

  for (const item of logistica) {
    if (item.included === false || !item.contextId) continue;
    if (
      !MODOS_TRANSPORTE_EQUIPE.includes(String(item.calculationMode)) &&
      item.calculationMode !== 'company_truck_driver'
    ) {
      continue;
    }
    const chave = `${item.direction}:${item.contextId}`;
    grupos.set(chave, [...(grupos.get(chave) || []), item]);
  }

  return [...grupos.values()].some(itens => {
    if (itens.length <= 1) return false;
    if (itens.some(item => item.travelerAssignmentsConfirmed === false)) return false;
    // Automático com mais de um item no grupo é a contradição.
    if (itens.some(item => item.travelerCountMode === 'automatic')) return true;

    const fase = fases.find(f => f.id === itens[0].contextId);
    const disponiveis = disponiveisPorAlocacao(fase);
    const somados = new Map<string, number>();

    for (const item of itens) {
      for (const viajante of registros(item.travelerAssignments)) {
        const id = String(viajante.assignmentId || '');
        somados.set(id, (somados.get(id) || 0) + numberValue(viajante.quantity));
      }
    }

    // A soma dos viajantes do grupo não pode passar do que a fase tem.
    return [...somados].some(([id, qtd]) => qtd > (disponiveis.get(id) || 0));
  });
}

/**
 * Falta informação de mobilização e desmobilização?
 * Porte de `missingRequiredLogisticsInfo` (`app/custos/page.tsx:111-134`).
 */
export function faltaLogistica(draft: AnyRecord, result: AnyRecord = {}): boolean {
  // O motor sincroniza os campos de uma desmobilização espelhada durante a
  // normalização. Validar o rascunho cru aqui deixava a etapa travada porque
  // a tela mostrava os valores herdados da ida, mas o predicado ainda lia os
  // zeros anteriores do retorno.
  const normalizado = normalizeCostEstimatePayload(draft) as unknown as AnyRecord;
  const confirmacoes = (draft.scopeConfirmations as AnyRecord) || {};
  if (confirmacoes.noLogistics === true) return false;

  const logisticaNormalizada = registros(normalizado.logistics);
  // A normalização também cria os quatro slots estruturais quando recebe um
  // rascunho legado. Aqui só queremos os valores sincronizados dos itens que
  // já existem na tela, sem inventar novas pendências no predicado local.
  const logistica = registros(draft.logistics).map(item => {
    const retornoEspelhado =
      item.direction === 'demobilization' &&
      item.requiredSlot === true &&
      item.autoSyncedFromMobilization === true &&
      item.returnSetup === 'mirrored';
    return retornoEspelhado
      ? logisticaNormalizada.find(candidato => candidato.id === item.id) || item
      : item;
  });
  const destinos = registros(draft.logisticsDestinations);
  const fases = registros(draft.laborContexts);

  // Nenhum item incluído.
  if (!logistica.some(item => item.included !== false)) return true;

  // Destino sem nome.
  if (destinos.some(destino => !String(destino.name || '').trim())) return true;

  // Item incompleto, salvo os dispensados.
  if (
    logistica.some(
      item =>
        !transporteDispensado(item, confirmacoes) && itemPrecisaAtencao(item, fases)
    )
  ) {
    return true;
  }

  // Slot obrigatório excluído sem dispensa.
  if (
    logistica.some(
      item =>
        item.requiredSlot &&
        item.included === false &&
        !transporteDispensado(item, confirmacoes)
    )
  ) {
    return true;
  }

  // Destino sem distância, tendo item obrigatório apontando para ele.
  if (
    destinos.some(
      destino =>
        numberValue(destino.oneWayDistanceKm) <= 0 &&
        logistica.some(
          item =>
            item.destinationId === destino.id &&
            item.included !== false &&
            !transporteDispensado(item, confirmacoes) &&
            (item.requiredSlot ||
              item.calculationMode === 'company_crew_vehicle' ||
              item.calculationMode === 'company_truck_driver')
        )
    )
  ) {
    return true;
  }

  if (gruposPrecisamAtencao(
    logistica.filter(item => !transporteDispensado(item, confirmacoes)), fases
  )) return true;

  // Cobertura da equipe: gente sem transporte, dos dois lados.
  //
  // `logisticsCrewCoverage` lê `result.logisticsResults` sem guarda, então
  // chamá-la com resultado parcial estoura. Na tela o resultado sempre vem
  // completo, mas um predicado que quebra em entrada incompleta é frágil —
  // e foi o teste que mostrou isso. Sem os dados da cobertura não dá para
  // concluir que falta transporte, então a checagem é pulada: acusar
  // pendência sem base seria pior que não acusar.
  if (!Array.isArray(result.logisticsResults)) return false;

  // O motor tipa `result` como `CostEstimateResultV2`; aqui ele chega como
  // registro genérico. O cast é local e não escapa deste arquivo.
  const cobertura = logisticsCrewCoverage as (
    resultado: unknown,
    direcao: string
  ) => AnyRecord;
  const mobilizacao = cobertura(result, 'mobilization');
  const desmobilizacao = cobertura(result, 'demobilization');

  if (
    numberValue(mobilizacao.missing) > 0 &&
    confirmacoes.mobilizationCrewAlreadyOnSite !== true
  ) {
    return true;
  }

  if (
    numberValue(desmobilizacao.missing) > 0 &&
    confirmacoes.demobilizationCrewAlreadyOnSite !== true
  ) {
    return true;
  }

  return false;
}
