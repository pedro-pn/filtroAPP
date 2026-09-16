import { FieldPanel, MoneyField, NumberField, SelectField } from '../../components/Field';
import {
  LOGISTICS_RETURN_MIRROR_FIELDS,
  LOGISTICS_TRAVEL_DEFAULTS,
  isLogisticsCalculationModeAllowed
} from '../../../../../../shared/comercial/dist/cost-model.js';
import { money, numberValue } from '../formato';
import { transporteDispensado } from '../logistica';
import type { Levantamento } from '../useLevantamento';

/**
 * Um deslocamento de mobilização ou desmobilização.
 *
 * **O modo de cálculo decide quais campos aparecem.** Frete externo pede
 * quantidade, viagens e custo; veículo de equipe pede vínculo com a fase,
 * viajantes, capacidade e distância; passagem pede dias de viagem. Mostrar
 * todos os campos sempre pediria dado que não se aplica — e é o caminho mais
 * curto para o usuário preencher qualquer coisa só para o aviso sumir.
 *
 * Os erros são endereçados pelo índice original do item, usando a validação
 * compartilhada e as respostas do servidor (não apenas presença de valores).
 */

type AnyRecord = Record<string, unknown>;

const MODOS = [
  { value: 'external_freight', label: 'Frete externo (transportadora)' },
  { value: 'company_crew_vehicle', label: 'Veículo próprio com a equipe' },
  { value: 'rental_crew_vehicle', label: 'Veículo alugado com a equipe' },
  { value: 'bus_crew_transport', label: 'Ônibus (passagem)' },
  { value: 'air_crew_transport', label: 'Aéreo (passagem)' },
  { value: 'company_truck_driver', label: 'Caminhão próprio com motorista' }
];

const MODO_CONTAGEM = [
  { value: 'automatic', label: 'Automática pela equipe' },
  { value: 'manual', label: 'Informada manualmente' }
];

const RETORNOS = [
  { value: 'mirrored', label: 'Repetir a composição da mobilização' },
  { value: 'custom', label: 'Preencher a desmobilização separadamente' }
];

const PERNOITES_DE_ONIBUS = [
  { value: 'continuous', label: 'Viagem direta, sem parada para dormir' },
  { value: 'hotel_stop', label: 'Parada com hospedagem' }
];

const USOS_DO_CARRO_ALUGADO = [
  { value: 'mobilization_only', label: 'Somente no deslocamento' },
  { value: 'mobilization_and_site', label: 'Deslocamento e uso durante a obra' }
];

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

export function LogisticaItem({
  item,
  levantamento
}: {
  item: AnyRecord;
  levantamento: Levantamento;
}) {
  const { draft, result, updateCollection, removeCollection, errosVisiveis, erroDe, errosPorCampo } =
    levantamento;
  const id = String(item.id);
  const confirmacoes = (draft.scopeConfirmations as AnyRecord) || {};
  const fases = registros(draft.laborContexts);
  const destinos = registros(draft.logisticsDestinations);
  const todosOsItens = registros(draft.logistics);
  const caminho = `logistics[${todosOsItens.findIndex(candidato => candidato.id === item.id)}]`;

  const dispensado = transporteDispensado(item, confirmacoes);
  // A marcação do card segue a mesma regra do vermelho nos campos: só
  // depois que o usuário tenta avançar. Antes disso quem avisa é o rodapé.
  const pendente =
    errosVisiveis && !dispensado && [...errosPorCampo.keys()].some(campo => campo.startsWith(`${caminho}.`));

  function erroCampo(campo: string) {
    if (dispensado || (item.included === false && campo !== 'included')) return undefined;
    return erroDe(`${caminho}.${campo}`);
  }

  const calculado =
    registros(result.logisticsResults).find(r => r.id === id) || {};

  const modo = String(item.calculationMode || '');
  const dicaEquipamento = item.requiredSlot && item.slotType === 'equipment'
    ? 'Se os equipamentos viajam com a equipe, marque “Equipe e equipamentos usam a mesma mobilização” acima.'
    : undefined;
  const modosDisponiveis = MODOS.filter(opcao => isLogisticsCalculationModeAllowed(
    opcao.value, String(item.slotType || ''), item.requiredSlot === true
  ));
  // Preserva a escolha antiga, mas explica por que ela precisa ser corrigida.
  // Nunca troca silenciosamente o transporte nem o custo de um orçamento salvo.
  const opcoesModo = modosDisponiveis.map(opcao => ({ ...opcao, disabled: false }));
  if (modo && !opcoesModo.some(opcao => opcao.value === modo)) {
    opcoesModo.push({
      value: modo,
      label: modo === 'legacy' ? 'Cálculo manual (legado)'
        : `${MODOS.find(opcao => opcao.value === modo)?.label || modo} — escolha incompatível com este item`,
      disabled: modo !== 'legacy'
    });
  }
  const veiculoRodoviario =
    modo === 'company_crew_vehicle' ||
    modo === 'rental_crew_vehicle' ||
    modo === 'company_truck_driver';
  const comPassagem = modo === 'bus_crew_transport' || modo === 'air_crew_transport';
  const transporteDeEquipe =
    modo === 'company_crew_vehicle' ||
    modo === 'rental_crew_vehicle' ||
    comPassagem ||
    modo === 'company_truck_driver';
  const veiculoDeEquipe =
    modo === 'company_crew_vehicle' || modo === 'rental_crew_vehicle';

  function editar(patch: AnyRecord) {
    const editouEspelho = item.returnSetup === 'mirrored'
      && patch.returnSetup === undefined
      && LOGISTICS_RETURN_MIRROR_FIELDS.some(campo => campo in patch);
    updateCollection('logistics', id, {
      ...(editouEspelho ? item : {}),
      ...patch,
      ...(editouEspelho ? { returnSetup: 'custom', autoSyncedFromMobilization: false } : {})
    });
  }

  function definirRetorno(valor: string) {
    if (valor !== 'mirrored') {
      editar({ returnSetup: valor, autoSyncedFromMobilization: false });
      return;
    }

    const origem = todosOsItens.find(
      candidato =>
        candidato.direction === 'mobilization' &&
        candidato.slotType === item.slotType &&
        candidato.destinationId === item.destinationId
    );
    const espelho: AnyRecord = {};
    for (const campo of LOGISTICS_RETURN_MIRROR_FIELDS) {
      if (origem?.[campo] !== undefined) espelho[campo] = origem[campo];
    }
    editar({
      ...espelho,
      returnSetup: 'mirrored',
      autoSyncedFromMobilization: true
    });
  }

  const faseVinculada = fases.find(fase => fase.id === item.contextId);
  const alocacoes = registros(faseVinculada?.assignments);

  function editarViajante(assignmentId: string, quantidade: number) {
    const atuais = registros(item.travelerAssignments).filter(
      viajante => viajante.assignmentId !== assignmentId
    );
    editar({
      travelerAssignments: quantidade > 0
        ? [...atuais, { assignmentId, quantity: quantidade }]
        : atuais,
      travelerAssignmentsConfirmed: true
    });
  }

  return (
    <article className={`com-fase-card${pendente ? ' com-item-pendente' : ''}`}>
      <header className="com-fase-card-topo">
        <div className="com-fase-identidade">
          <label>
            <small>Descrição do deslocamento</small>
            <input
              aria-label="Descrição do deslocamento"
              value={String(item.description || '')}
              onChange={event => editar({ description: event.target.value })}
            />
          </label>
        </div>
        <div className="com-fase-acoes">
          {dispensado && <span className="com-etiqueta">Dispensado</span>}
          {pendente && <span className="com-etiqueta com-etiqueta-alerta">Incompleto</span>}
          <span className="com-volume-badge">{money(numberValue(calculado.total))}</span>
          <label className="com-incluir">
            <input
              type="checkbox"
              aria-invalid={Boolean(erroCampo('included')) || undefined}
              aria-describedby={erroCampo('included') ? `${id}-incluir-erro` : undefined}
              checked={item.included !== false}
              onChange={event => editar({ included: event.target.checked })}
            />
            Incluir
            {erroCampo('included') && <small id={`${id}-incluir-erro`} className="field-error">{erroCampo('included')}</small>}
          </label>
          <button
            type="button"
            className="com-btn com-btn-perigo"
            /* Slot obrigatório não se remove — ele existe porque o fluxo o
               exige. O caminho é desmarcar "incluir" e confirmar a dispensa. */
            disabled={item.requiredSlot === true}
            title={
              item.requiredSlot === true
                ? 'Deslocamento obrigatório: desmarque "incluir" em vez de remover'
                : 'Remover deslocamento'
            }
            onClick={() => removeCollection('logistics', id)}
          >
            Remover
          </button>
        </div>
      </header>

      <div className="com-form-grid">
        {item.direction === 'demobilization' && item.requiredSlot === true && (
          <SelectField
            label="Composição do retorno"
            required
            value={item.returnSetup === 'pending' ? '' : String(item.returnSetup || '')}
            emptyLabel="Escolha como será a desmobilização"
            options={RETORNOS}
            error={erroCampo('returnSetup')}
            onChange={definirRetorno}
          />
        )}

        <SelectField
          label="Modo de cálculo"
          required
          value={item.calculationModeConfirmed ? modo : ''}
          emptyLabel="Selecione como este deslocamento é calculado"
          options={opcoesModo}
          error={erroCampo('calculationMode') && dicaEquipamento
            ? `${erroCampo('calculationMode')} ${dicaEquipamento}`
            : erroCampo('calculationMode')}
          hint={dicaEquipamento}
          /* Mesmo padrão da condição de trabalho: o valor só aparece depois de
             confirmado, para forçar a escolha em vez de aceitar um padrão. */
          onChange={valor =>
            editar({ calculationMode: valor, calculationModeConfirmed: true })
          }
        />

        <SelectField
          label="Destino"
          required
          value={String(item.destinationId || '')}
          emptyLabel="Sem destino"
          options={destinos.map(destino => ({
            value: String(destino.id),
            label: String(destino.name || 'Destino')
          }))}
          error={erroCampo('destinationId')}
          onChange={valor => editar({ destinationId: valor })}
        />

        <NumberField
          label="Viagens"
          required
          value={item.trips}
          min={0}
          step={1}
          error={erroCampo('trips')}
          onChange={valor => editar({ trips: valor })}
        />
      </div>

      {modo === 'external_freight' && (
        <div className="com-form-grid">
          <NumberField
            label="Quantidade"
            required
            value={item.quantity}
            min={0}
            step={0.01}
            error={erroCampo('quantity')}
            onChange={valor => editar({ quantity: valor })}
          />
          <MoneyField
            label="Custo unitário"
            required
            value={item.unitCost}
            error={erroCampo('unitCost')}
            onChange={valor => editar({ unitCost: valor })}
          />
        </div>
      )}

      {transporteDeEquipe && (
        <div className="com-form-grid">
          <SelectField
            label="Fase vinculada"
            required
            value={String(item.contextId || '')}
            emptyLabel="Selecione a fase"
            options={fases.map(fase => ({
              value: String(fase.id),
              label: String(fase.name || 'Fase')
            }))}
            error={erroCampo('contextId')}
            /* Sem fase não há equipe, e sem equipe não há quem transportar. */
            onChange={valor => editar({ contextId: valor })}
          />

          <SelectField
            label="Contagem de viajantes"
            required={modo === 'company_truck_driver'}
            value={String(item.travelerCountMode || 'automatic')}
            options={MODO_CONTAGEM}
            error={erroCampo('travelerCountMode') || (item.travelerCountMode !== 'manual' ? erroCampo('travelerAssignments') : undefined)}
            onChange={valor => editar({ travelerCountMode: valor })}
          />

          {item.travelerCountMode === 'manual' && (
            <FieldPanel
              label="Viajantes por cargo"
              required
              error={erroCampo('travelerAssignments')}
            >
              {alocacoes.length > 0 ? (
                <div className="com-viajantes-cargos">
                  {alocacoes.map(alocacao => {
                    const assignmentId = String(alocacao.id);
                    const selecionado = registros(item.travelerAssignments).find(
                      viajante => viajante.assignmentId === assignmentId
                    );
                    const disponiveis = Math.ceil(
                      (numberValue(alocacao.quantity) *
                        numberValue(alocacao.allocationPercent)) /
                        100
                    );
                    return (
                      <label key={assignmentId}>
                        <span>{String(alocacao.role || 'Cargo')}</span>
                        <input
                          type="number"
                          min={0}
                          max={disponiveis}
                          step={1}
                          aria-label={`Viajantes de ${String(alocacao.role || 'cargo')}`}
                          value={numberValue(selecionado?.quantity) || ''}
                          onChange={evento =>
                            editarViajante(assignmentId, Number(evento.target.value) || 0)
                          }
                        />
                        <small>de {disponiveis}</small>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <small className="com-nota">Selecione primeiro uma fase com equipe.</small>
              )}
            </FieldPanel>
          )}
        </div>
      )}

      {veiculoRodoviario && (
        <div className="com-form-grid">
          <NumberField
            label="Distância por veículo (km)"
            required
            value={item.distanceKmPerVehicle}
            min={0}
            step={1}
            error={erroCampo('distanceKmPerVehicle')}
            onChange={valor => editar({ distanceKmPerVehicle: valor })}
          />

          <NumberField
            label="Limite diário de rodagem (km)"
            required
            value={item.dailyDistanceLimitKm}
            min={0}
            step={1}
            hint="Define em quantos dias o trajeto é feito"
            error={erroCampo('dailyDistanceLimitKm')}
            onChange={valor => editar({ dailyDistanceLimitKm: valor })}
          />

          <SelectField
            label="Contagem de veículos"
            value={String(item.vehicleCountMode || 'automatic')}
            options={MODO_CONTAGEM}
            error={item.vehicleCountMode !== 'manual' ? erroCampo('vehicleCount') : undefined}
            onChange={valor => editar({ vehicleCountMode: valor })}
          />

          {item.vehicleCountMode === 'manual' && (
            <NumberField
              label="Nº de veículos"
              required
              value={item.vehicleCount}
              min={0}
              step={1}
              error={erroCampo('vehicleCount')}
              onChange={valor => editar({ vehicleCount: valor })}
            />
          )}

          {veiculoDeEquipe && (
            <NumberField
              label="Passageiros por veículo"
              required
              value={item.passengersPerVehicle}
              min={1}
              max={LOGISTICS_TRAVEL_DEFAULTS.passengersPerCompanyCar}
              step={1}
              error={erroCampo('passengersPerVehicle')}
              onChange={valor => editar({ passengersPerVehicle: valor })}
            />
          )}

          <NumberField
            label="Horas de viagem por dia"
            required
            value={item.travelHoursPerDay}
            min={0}
            max={10}
            step={0.5}
            error={erroCampo('travelHoursPerDay')}
            onChange={valor => editar({ travelHoursPerDay: valor })}
          />

          <MoneyField
            label="Hospedagem por pessoa/dia"
            required
            value={item.lodgingPerPersonDay}
            error={erroCampo('lodgingPerPersonDay')}
            onChange={valor => editar({ lodgingPerPersonDay: valor })}
          />

          <NumberField
            label="Rendimento do combustível (km/L)"
            required
            value={item.fuelEfficiencyKmPerLiter}
            min={0}
            step={0.1}
            error={erroCampo('fuelEfficiencyKmPerLiter')}
            onChange={valor => editar({ fuelEfficiencyKmPerLiter: valor })}
          />

          <MoneyField
            label="Combustível (R$/L)"
            required
            value={item.fuelPricePerLiter}
            error={erroCampo('fuelPricePerLiter') || (numberValue(item.fuelPricePerLiter) <= 0 ? erroCampo('fuelEfficiencyKmPerLiter') : undefined)}
            onChange={valor => editar({ fuelPricePerLiter: valor })}
          />

          <MoneyField
            label="Pedágio estimado (R$/km da frota)"
            value={item.tollPerVehicleKm}
            onChange={valor => editar({ tollPerVehicleKm: valor })}
          />
        </div>
      )}

      {modo === 'rental_crew_vehicle' && (
        <div className="com-form-grid">
          <SelectField
            label="Uso do carro alugado"
            required
            value={String(item.rentalUse || '')}
            emptyLabel="Selecione onde o carro será usado"
            options={USOS_DO_CARRO_ALUGADO}
            error={erroCampo('rentalUse')}
            onChange={valor => editar({ rentalUse: valor })}
          />
          <MoneyField
            label="Diária do carro alugado"
            required
            value={item.rentalDailyRate}
            error={erroCampo('rentalDailyRate')}
            onChange={valor => editar({ rentalDailyRate: valor })}
          />
          {item.direction === 'mobilization' &&
            item.rentalUse === 'mobilization_and_site' && (
              <NumberField
                label="Dias corridos de locação na obra"
                required
                value={item.rentalSiteDays}
                min={0}
                step={1}
                error={erroCampo('rentalSiteDays')}
                onChange={valor => editar({ rentalSiteDays: valor })}
              />
            )}
        </div>
      )}

      {comPassagem && (
        <div className="com-form-grid">
          <NumberField
            label="Horas de viagem por dia"
            required
            value={item.travelHoursPerDay}
            min={0}
            max={24}
            step={0.5}
            error={erroCampo('travelHoursPerDay')}
            onChange={valor => editar({ travelHoursPerDay: valor })}
          />
          <NumberField
            label="Dias corridos por viagem"
            required
            value={item.travelCalendarDaysPerTrip}
            error={erroCampo('travelCalendarDaysPerTrip')}
            min={0}
            step={1}
            onChange={valor => editar({ travelCalendarDaysPerTrip: valor })}
          />
          <MoneyField
            label="Passagem por pessoa/viagem"
            required
            value={item.ticketPerPersonPerTrip}
            error={erroCampo('ticketPerPersonPerTrip')}
            onChange={valor => editar({ ticketPerPersonPerTrip: valor })}
          />
          <MoneyField
            label="Alimentação por pessoa/dia"
            required
            value={item.mealPerPersonDay}
            error={erroCampo('mealPerPersonDay')}
            onChange={valor => editar({ mealPerPersonDay: valor })}
          />
          {modo === 'bus_crew_transport' && (
            <SelectField
              label="Pernoite no trajeto de ônibus"
              required
              value={String(item.busOvernightMode || '')}
              emptyLabel="Selecione como será o pernoite"
              options={PERNOITES_DE_ONIBUS}
              error={erroCampo('busOvernightMode')}
              onChange={valor => editar({ busOvernightMode: valor })}
            />
          )}
          {((modo === 'bus_crew_transport' && item.busOvernightMode === 'hotel_stop') ||
            (modo === 'air_crew_transport' &&
              numberValue(item.travelCalendarDaysPerTrip) > 1)) && (
            <>
              <NumberField
                label="Pernoites por viagem"
                required
                value={item.lodgingNightsPerTrip}
                min={0}
                step={1}
                error={erroCampo('lodgingNightsPerTrip')}
                onChange={valor => editar({ lodgingNightsPerTrip: valor })}
              />
              <MoneyField
                label="Hospedagem por pessoa/dia"
                required
                value={item.lodgingPerPersonDay}
                error={erroCampo('lodgingPerPersonDay')}
                onChange={valor => editar({ lodgingPerPersonDay: valor })}
              />
            </>
          )}
        </div>
      )}

      {transporteDeEquipe && !comPassagem && (
        <div className="com-form-grid">
          <MoneyField
            label="Alimentação por pessoa/dia"
            required
            value={item.mealPerPersonDay}
            error={erroCampo('mealPerPersonDay')}
            onChange={valor => editar({ mealPerPersonDay: valor })}
          />
        </div>
      )}

      {transporteDeEquipe && (
        <div className="com-form-grid">
          <NumberField
            label="Sábados em viagem"
            value={item.travelSaturdayDays}
            error={erroCampo('travelSaturdayDays')}
            min={0}
            step={1}
            onChange={valor => editar({ travelSaturdayDays: valor })}
          />
          <NumberField
            label="Domingos e feriados em viagem"
            value={item.travelSundayDays}
            error={erroCampo('travelSundayDays')}
            min={0}
            step={1}
            onChange={valor => editar({ travelSundayDays: valor })}
          />
        </div>
      )}

      {!modo && (
        <p className="com-nota">
          Escolha o modo de cálculo para ver os campos que este deslocamento exige.
        </p>
      )}
    </article>
  );
}
