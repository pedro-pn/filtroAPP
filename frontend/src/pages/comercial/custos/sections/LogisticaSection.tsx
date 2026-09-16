import { useMemo, useState } from 'react';
import { CabecalhoRetratil } from '../../components/CabecalhoRetratil';

import {
  LOGISTICS_TRAVEL_DEFAULTS,
  normalizeCostEstimatePayload
} from '../../../../../../shared/comercial/dist/cost-model.js';
import { EnderecoInput } from '../../components/EnderecoField';
import { AvisoPendencia, ConfirmacaoEscopo } from '../ConfirmacaoEscopo';
import { DistanciaDoDestino } from './DistanciaDoDestino';
import { money, numberValue } from '../formato';
import { itemPrecisaAtencao, transporteDispensado } from '../logistica';
import { custoTotalLogistica } from '../totaisDasSecoes';
import type { Levantamento } from '../useLevantamento';
import { LogisticaItem } from './LogisticaItem';

/**
 * Seção 4 — Mobilização e desmobilização.
 *
 * A maior das cinco em controles (`CUSTO-CTL-229..394`, 166). Porte de
 * `LogisticsSection` (`app/custos/page.tsx:1269-1957`).
 *
 * A tela tem duas metades: os **destinos** (para onde a equipe e o material
 * vão, e a que distância) e os **itens de deslocamento**, cada um com um modo
 * de cálculo que decide quais campos são obrigatórios.
 *
 * O predicado que diz se um item está incompleto já estava portado e testado
 * antes desta tela existir — é ele que o rodapé-guia consulta, e é ele que esta
 * seção usa para marcar item por item. Assim a marcação da tela e a pendência
 * do rodapé nunca discordam: são a mesma função.
 */

type AnyRecord = Record<string, unknown>;

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

function id(prefixo: string) {
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function novoDestino(indice: number): AnyRecord {
  return {
    id: id('destino'),
    nameSource: 'custom',
    name: `Destino ${indice + 1}`,
    address: '',
    oneWayDistanceKm: 0
  };
}

function novoItem(direcao: string, destinoId?: string): AnyRecord {
  const padroes = LOGISTICS_TRAVEL_DEFAULTS as AnyRecord;
  return {
    id: id('logistica'),
    destinationId: destinoId,
    slotType: 'additional',
    requiredSlot: false,
    direction: direcao,
    category: 'travel',
    description:
      direcao === 'mobilization'
        ? 'Deslocamento de mobilização'
        : 'Retorno de desmobilização',
    calculationMode: '',
    calculationModeConfirmed: false,
    basis: 'fixed',
    quantity: 1,
    trips: 1,
    travelerCountMode: 'automatic',
    travelerCount: 0,
    travelerAssignments: [],
    travelerAssignmentsConfirmed: true,
    vehicleCountMode: 'automatic',
    vehicleCount: 0,
    passengersPerVehicle: padroes.passengersPerCompanyCar,
    distanceKmPerVehicle: 0,
    dailyDistanceLimitKm: padroes.dailyDistanceLimitKm,
    travelHoursPerDay: padroes.travelHoursPerDay,
    travelCalendarDaysPerTrip: 1,
    travelSaturdayDays: 0,
    travelSundayDays: 0,
    ticketPerPersonPerTrip: 0,
    busOvernightMode: '',
    lodgingNightsPerTrip: 0,
    lodgingPerPersonDay: padroes.lodgingPerPersonDay,
    mealPerPersonDay: padroes.mealPerPersonDay,
    rentalUse: '',
    rentalDailyRate: 0,
    rentalSiteDays: 0,
    fuelEfficiencyKmPerLiter: padroes.companyCarFuelEfficiencyKmPerLiter,
    fuelPricePerLiter: padroes.gasolinePricePerLiter,
    tollPerVehicleKm: padroes.companyCarTollPerVehicleKm,
    additionalCosts: [],
    unitCost: 0,
    returnSetup: 'custom',
    included: true
  };
}

export function LogisticaSection({ levantamento }: { levantamento: Levantamento }) {
  const { draft, result, setDraft, updateCollection, removeCollection, errosVisiveis, erroDe, errosPorCampo } =
    levantamento;

  const confirmacoes = (draft.scopeConfirmations as AnyRecord) || {};
  const semLogistica = confirmacoes.noLogistics === true;
  const transporteConjunto = confirmacoes.combinedCrewAndEquipmentTransport === true;
  const destinos = registros(draft.logisticsDestinations);
  // Exibe os mesmos valores que o motor valida e calcula, inclusive retornos
  // espelhados. O índice das pendências continua sendo o do rascunho original.
  const itensNormalizados = useMemo(
    () => normalizeCostEstimatePayload(draft).logistics,
    [draft]
  );
  const itens = registros(draft.logistics).map(item =>
    (item.returnSetup === 'mirrored' && item.autoSyncedFromMobilization === true)
      || itensNormalizados.some(normalizado => normalizado.id === item.id
        && (normalizado.slotType !== item.slotType || normalizado.requiredSlot !== item.requiredSlot))
      ? (itensNormalizados.find(normalizado => normalizado.id === item.id) as unknown as AnyRecord) || item
      : item
  );
  const fases = registros(draft.laborContexts);

  const visivel = (item: AnyRecord) =>
    !(
      transporteConjunto &&
      item.requiredSlot === true &&
      item.slotType === 'equipment'
    );
  const mobilizacao = itens.filter(
    item => item.direction === 'mobilization' && visivel(item)
  );
  const desmobilizacao = itens.filter(
    item => item.direction === 'demobilization' && visivel(item)
  );

  function definirSemLogistica(valor: boolean) {
    setDraft(atual => ({
      ...atual,
      scopeConfirmations: {
        ...((atual.scopeConfirmations as AnyRecord) || {}),
        noLogistics: valor
      }
    }));
  }

  function definirTransporteConjunto(valor: boolean) {
    setDraft(atual => ({
      ...atual,
      scopeConfirmations: {
        ...((atual.scopeConfirmations as AnyRecord) || {}),
        combinedCrewAndEquipmentTransport: valor,
        noLogistics: false
      }
    }));
  }

  function acrescentarDestino() {
    setDraft(atual => {
      const atuais = registros(atual.logisticsDestinations);
      return {
        ...atual,
        logisticsDestinations: [...atuais, novoDestino(atuais.length)]
      };
    });
  }

  function acrescentarItem(direcao: string) {
    setDraft(atual => ({
      ...atual,
      logistics: [
        ...registros(atual.logistics),
        novoItem(direcao, String(registros(atual.logisticsDestinations)[0]?.id || ''))
      ],
      scopeConfirmations: {
        ...((atual.scopeConfirmations as AnyRecord) || {}),
        noLogistics: false
      }
    }));
  }

  // Contagem de itens pendentes, usando o MESMO predicado do rodapé.
  const pendentes = itens.filter(
    item => !transporteDispensado(item, confirmacoes) && (
      itemPrecisaAtencao(item, fases)
      || [...errosPorCampo.keys()].some(campo => campo.startsWith(
        `logistics[${registros(draft.logistics).findIndex(original => original.id === item.id)}].`
      ))
    )
  ).length;

  const destinoSemNome = destinos.some(d => !String(d.name || '').trim());

  return (
    <>
      <section className="com-painel">
        <div className="com-secao-titulo">
          <div>
            <h2>Mobilização e desmobilização</h2>
            <p>
              Para onde a equipe e o material vão, a que distância, e como cada deslocamento
              é calculado.
            </p>
          </div>
          <button type="button" className="com-btn-add" onClick={acrescentarDestino}>
            + Adicionar destino
          </button>
        </div>

        <ConfirmacaoEscopo
          confirmado={semLogistica}
          tituloPendente="Revisão obrigatória da logística"
          tituloConfirmado="Sem logística confirmado"
          descricaoPendente="Se este serviço não tiver mobilização nem desmobilização, confirme explicitamente antes de finalizar."
          descricaoConfirmada="Deslocamentos ficam fora deste levantamento."
          rotulo="Confirmo que não haverá mobilização nem desmobilização"
          error={erroDe('scopeConfirmations.noLogistics')}
          onChange={definirSemLogistica}
        />

        {!semLogistica && (
          <label className="com-logistica-conjunta">
            <input
              type="checkbox"
              checked={transporteConjunto}
              onChange={event => definirTransporteConjunto(event.target.checked)}
            />
            <span>
              <strong>Equipe e equipamentos usam a mesma mobilização</strong>
              <small>
                Um único card por sentido será preenchido e cobrado. Os dados separados ficam
                preservados caso esta opção seja desmarcada.
              </small>
            </span>
          </label>
        )}

        {!semLogistica && errosVisiveis && destinoSemNome && (
          <AvisoPendencia>Todo destino precisa de um nome.</AvisoPendencia>
        )}

        {/* O aviso diz "estão marcados abaixo", e só é verdade depois que a
            marcação aparece. Mostrá-lo antes seria apontar para nada. */}
        {!semLogistica && errosVisiveis && pendentes > 0 && (
          <AvisoPendencia>
            {pendentes === 1
              ? '1 deslocamento está incompleto.'
              : `${pendentes} deslocamentos estão incompletos.`}{' '}
            Os itens pendentes estão marcados abaixo.
          </AvisoPendencia>
        )}

        {!semLogistica && (
          <>
            <h3 className="com-subtitulo">Destinos</h3>

            {destinos.length > 0 ? (
              <div className="com-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">
                        Destino<span className="survey-required-marker">*</span>
                      </th>
                      <th scope="col">Endereço</th>
                      <th scope="col">Distância só ida (km)</th>
                      <th scope="col">
                        <span className="com-sr">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {destinos.map(destino => {
                      const destinoId = String(destino.id);
                      const editar = (patch: AnyRecord) =>
                        updateCollection('logisticsDestinations', destinoId, patch);
                      const semNome = errosVisiveis && !String(destino.name || '').trim();

                      // Distância só é cobrada se algum item obrigatório
                      // aponta para este destino — cobrar sempre marcaria de
                      // vermelho um destino que ninguém usa.
                      const cobrado = itens.some(
                        item =>
                          item.destinationId === destinoId &&
                          item.included !== false &&
                          (item.requiredSlot ||
                            item.calculationMode === 'company_crew_vehicle' ||
                            item.calculationMode === 'company_truck_driver')
                      );
                      const semDistancia =
                        errosVisiveis &&
                        cobrado &&
                        numberValue(destino.oneWayDistanceKm) <= 0;

                      return (
                        <tr key={destinoId}>
                          <td>
                            <input
                              aria-label="Nome do destino"
                              className={semNome ? 'com-campo-invalido' : undefined}
                              aria-invalid={semNome || undefined}
                              value={String(destino.name || '')}
                              onChange={event => editar({ name: event.target.value })}
                            />
                          </td>
                          <td>
                            {/* Sugestões do Google enquanto se digita (T134). O
                                `placeId` é descartado de propósito: o payload do
                                levantamento é normalizado pelo motor portado, que
                                monta o destino campo a campo — guardá-lo exigiria
                                mexer no modelo compartilhado, que os goldens
                                protegem, para um proveito que só a T126b usaria.
                                O texto escolhido já é o do próprio Google, que é o
                                que faz a distância resolver certo depois. */}
                            <EnderecoInput
                              aria-label="Endereço"
                              value={String(destino.address || '')}
                              onChange={endereco => editar({ address: endereco })}
                            />
                          </td>
                          <td>
                            <DistanciaDoDestino
                              endereco={String(destino.address || '')}
                              km={numberValue(destino.oneWayDistanceKm)}
                              invalido={semDistancia}
                              obrigatorio={cobrado}
                              onChange={km => editar({ oneWayDistanceKm: km })}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="com-remover"
                              aria-label={`Remover ${String(destino.name || 'destino')}`}
                              onClick={() =>
                                removeCollection('logisticsDestinations', destinoId)
                              }
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="com-vazio">Nenhum destino cadastrado.</div>
            )}
          </>
        )}
      </section>

      {!semLogistica && (
        <>
          <BlocoDirecao
            titulo="Mobilização"
            descricao={
              transporteConjunto
                ? 'Ida conjunta da equipe e dos equipamentos para a obra.'
                : 'Ida da equipe e do material para a obra.'
            }
            itens={mobilizacao}
            levantamento={levantamento}
            onAdicionar={() => acrescentarItem('mobilization')}
          />

          <BlocoDirecao
            titulo="Desmobilização"
            descricao={
              transporteConjunto
                ? 'Retorno conjunto. Pode espelhar a mobilização ou ser diferente.'
                : 'Retorno. Pode espelhar a mobilização ou ser diferente.'
            }
            itens={desmobilizacao}
            levantamento={levantamento}
            onAdicionar={() => acrescentarItem('demobilization')}
          />

        </>
      )}

      <div className="com-total-secao" aria-label="Custo total da aba Logística">
        <strong>Custo total desta aba</strong>
        <span>{money(custoTotalLogistica(result))}</span>
      </div>
    </>
  );
}

function BlocoDirecao({
  titulo,
  descricao,
  itens,
  levantamento,
  onAdicionar
}: {
  titulo: string;
  descricao: string;
  itens: AnyRecord[];
  levantamento: Levantamento;
  onAdicionar: () => void;
}) {
  const [aberto, setAberto] = useState(true);
  const corpoId = titulo === 'Mobilização'
    ? 'mobilizacao-conteudo'
    : 'desmobilizacao-conteudo';

  return (
    <section className="com-painel">
      <div className="com-secao-titulo com-cabecalho-retratil">
        <h2>
          <CabecalhoRetratil
            titulo={titulo}
            descricao={descricao}
            aberto={aberto}
            conteudoId={corpoId}
            onAlternar={() => setAberto(valor => !valor)}
          />
        </h2>
      </div>

      <div id={corpoId} hidden={!aberto}>
        <div className="com-secao-acoes com-retratil-acoes">
          <button type="button" className="com-btn-add" onClick={onAdicionar}>
            + Adicionar deslocamento
          </button>
        </div>
        {itens.length > 0 ? (
          <div className="com-fases">
            {itens.map(item => (
              <LogisticaItem
                key={String(item.id)}
                item={item}
                levantamento={levantamento}
              />
            ))}
          </div>
        ) : (
          <div className="com-vazio">Nenhum deslocamento nesta direção.</div>
        )}
      </div>
    </section>
  );
}
