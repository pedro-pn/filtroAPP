import { useState } from 'react';

import {
  LEC_CONTEXT_EXPENSES,
  offshoreWorkSchedule
} from '../../../../../../shared/comercial/dist/cost-model.js';
import { Field, NumberField, SelectField } from '../../components/Field';
import {
  atualizarDataDeInicioDaFase,
  dataDeInicioDaFase
} from '../datasDaFase';
import { numberValue } from '../formato';
import type { Levantamento } from '../useLevantamento';
import { AlocacoesTabela } from './AlocacoesTabela';
import { DespesasFase } from './DespesasFase';

/**
 * Cartão de uma fase de mão de obra.
 *
 * Porte de `.phase-card` (`app/custos/page.tsx:729-...`). Cada fase tem
 * período, jornada, local, deslocamento e as alocações de pessoal.
 *
 * O painel "Local e deslocamento" é o que destrava a pendência da seção: sem
 * condição de trabalho confirmada e sem veículo, o rodapé-guia manda para cá.
 */

type AnyRecord = Record<string, unknown>;

const CONDICOES = [
  { value: 'headquarters', label: 'Sede / Itajaí' },
  { value: 'travel', label: 'Em viagem' },
  { value: 'offshore', label: 'Offshore' }
];

const VEICULOS = [
  { value: 'none', label: 'Sem veículo' },
  { value: 'sedan', label: 'Carro sedan · 3 pessoas' },
  { value: 'pickup', label: 'Pickup · 2 pessoas' },
  { value: 'hr', label: 'HR · 2 pessoas' }
];

const MODO_VEICULOS = [
  { value: 'automatic', label: 'Automática pela equipe' },
  { value: 'manual', label: 'Informada manualmente' }
];

export function FaseCard({
  fase,
  indice,
  total,
  levantamento
}: {
  fase: AnyRecord;
  indice: number;
  total: number;
  levantamento: Levantamento;
}) {
  const { draft, setDraft, updateCollection, removeCollection, erroSe, erroDe } = levantamento;
  const caminho = `laborContexts[${indice}]`;
  const erro = (campo: string) => erroDe(`${caminho}.${campo}`);
  const id = String(fase.id);
  const emViagem = fase.workCondition === 'travel';
  const semVeiculo = fase.vehicleType === 'none';
  const exigeDeslocamentoRodoviario = emViagem && !semVeiculo;
  const confirmada = fase.workConditionConfirmed === true;
  const erroDoNome = erro('name') || erroSe(!String(fase.name || '').trim(), 'Campo obrigatório');
  const [aberta, setAberta] = useState(true);

  function editar(patch: AnyRecord) {
    updateCollection('laborContexts', id, patch);
  }

  return (
    <article className="com-fase-card">
      <header className="com-fase-card-topo">
        <div className="com-fase-identidade">
          <span className="com-fase-indice">{indice + 1}</span>
          <label>
            <small>
              Nome da fase<span className="survey-required-marker">*</span>
            </small>
            <input
              aria-label="Nome da fase"
              className={erroDoNome ? 'com-campo-invalido' : undefined}
              aria-invalid={erroDoNome ? true : undefined}
              aria-describedby={erroDoNome ? `${id}-nome-erro` : undefined}
              value={String(fase.name || '')}
              onChange={event => editar({ name: event.target.value })}
            />
            {erroDoNome && (
              <small id={`${id}-nome-erro`} className="field-error">
                {erroDoNome}
              </small>
            )}
          </label>
        </div>
        <div className="com-fase-acoes">
          <button
            type="button"
            className="com-btn com-btn-fantasma"
            aria-expanded={aberta}
            aria-controls={`${id}-conteudo`}
            onClick={() => setAberta(valor => !valor)}
          >
            {aberta ? 'Minimizar' : 'Expandir'}
          </button>
          <button type="button" className="com-btn com-btn-fantasma">
            Duplicar
          </button>
          <button
            type="button"
            className="com-btn com-btn-perigo"
            /* A última fase não pode ser removida: um levantamento com mão de
               obra e zero fases não é estado válido, e a referência trava. */
            disabled={total <= 1}
            onClick={() => removeCollection('laborContexts', id)}
          >
            Remover
          </button>
        </div>
      </header>

      <div id={`${id}-conteudo`} className="com-fase-conteudo" hidden={!aberta}>
      <div className="com-fase-paineis">
        <section className="com-fase-painel">
          <header>
            <strong>Local e deslocamento</strong>
            <small>Informe a condição da equipe e o transporte diário.</small>
          </header>

          <div className="com-form-grid">
            <div className="com-form-wide">
              <SelectField
                label="Condição de trabalho"
                required
                /* O valor só aparece depois de CONFIRMADO. Enquanto não for,
                   o select mostra o vazio — é o que força a escolha
                   consciente em vez de aceitar um padrão silencioso. */
                value={confirmada ? String(fase.workCondition || '') : ''}
                emptyLabel="Selecione Sede, Em viagem ou Offshore"
                options={CONDICOES}
                error={erro('workCondition') || erroSe(!(confirmada && fase.workCondition), 'Campo obrigatório')}
                onChange={valor => {
                  // Offshore traz um calendário próprio de 21 dias — escolher
                  // a condição já preenche a escala, senão o usuário digitaria
                  // à mão uma regra que o LEC já conhece.
                  editar(
                    valor === 'offshore'
                      ? {
                          workCondition: valor,
                          workConditionConfirmed: true,
                          ...(offshoreWorkSchedule(21) as AnyRecord)
                        }
                      : { workCondition: valor, workConditionConfirmed: true }
                  );
                }}
              />
            </div>

            <SelectField
              label="Veículo da equipe"
              required
              value={String(fase.vehicleType || '')}
              emptyLabel="Selecione o veículo"
              options={VEICULOS}
              error={erro('vehicleType') || erroSe(!fase.vehicleType, 'Campo obrigatório')}
              onChange={valor => editar(valor === 'none'
                ? { vehicleType: valor, vehicleCountMode: 'automatic', vehicleCount: 0 }
                : { vehicleType: valor })}
            />

            {!semVeiculo && (
              <SelectField
                label="Quantidade de veículos"
                value={String(fase.vehicleCountMode || 'automatic')}
                options={MODO_VEICULOS}
                onChange={valor => editar({ vehicleCountMode: valor })}
              />
            )}

            <NumberField
              label="Deslocamento hotel ↔ obra / dia (km)"
              required={exigeDeslocamentoRodoviario}
              value={
                fase.hotelSiteDistanceKmPerDay ??
                (LEC_CONTEXT_EXPENSES as AnyRecord).hotelSiteDistanceKmPerDay
              }
              min={0}
              step={1}
              /* Só faz sentido em viagem, e só depois de confirmar a condição. */
              disabled={!confirmada || !exigeDeslocamentoRodoviario}
              error={erro('hotelSiteDistanceKmPerDay') || erroSe(
                exigeDeslocamentoRodoviario && numberValue(fase.hotelSiteDistanceKmPerDay) <= 0,
                'Informe a distância diária entre hotel e obra'
              )}
              onChange={valor => editar({ hotelSiteDistanceKmPerDay: valor })}
            />

            {!semVeiculo && fase.vehicleCountMode === 'manual' && (
              <NumberField
                label="Nº de veículos"
                error={erro('vehicleCount')}
                required
                value={fase.vehicleCount || 0}
                min={0}
                step={1}
                onChange={valor => editar({ vehicleCount: valor })}
              />
            )}
          </div>
        </section>

        <section className="com-fase-painel">
          <header>
            <strong>Período e jornada padrão</strong>
            <small>
              Esta escala é herdada pelos cargos sem cenário próprio. As exceções são
              configuradas individualmente em Equipe alocada.
            </small>
          </header>

          <div className="com-form-grid">
            <Field
              label="Início"
              type="date"
              value={dataDeInicioDaFase(draft, fase)}
              onChange={valor =>
                setDraft(atual => atualizarDataDeInicioDaFase(atual, id, valor))
              }
            />
            <NumberField
              label="Dias corridos"
              error={erro('durationDays')}
              value={fase.durationDays}
              min={1}
              /* Offshore é limitado a 21 dias pelo próprio regime. */
              max={fase.workCondition === 'offshore' ? 21 : undefined}
              onChange={valor => editar({ durationDays: valor })}
            />
            <NumberField
              label="Jornada normal (h/dia)"
              error={erro('hoursPerDay')}
              value={fase.hoursPerDay}
              min={0}
              step={0.5}
              onChange={valor => editar({ hoursPerDay: valor })}
            />
            <NumberField
              label="HE 70% (h/dia)"
              error={erro('weekdayExtra70HoursPerDay')}
              value={fase.weekdayExtra70HoursPerDay}
              min={0}
              step={0.5}
              onChange={valor => editar({ weekdayExtra70HoursPerDay: valor })}
            />
            <NumberField
              label="Sábados"
              error={erro('saturdayCount')}
              value={fase.saturdayCount}
              min={0}
              onChange={valor => editar({ saturdayCount: valor })}
            />
            <NumberField
              label="HE sábado (h/dia)"
              error={erro('saturdayHoursPerDay')}
              value={fase.saturdayHoursPerDay}
              min={0}
              step={0.5}
              onChange={valor => editar({ saturdayHoursPerDay: valor })}
            />
            <NumberField
              label="Domingos e feriados"
              error={erro('sundayCount')}
              value={fase.sundayCount}
              min={0}
              onChange={valor => editar({ sundayCount: valor })}
            />
            <NumberField
              label="HE domingo/feriado (h/dia)"
              error={erro('sundayHoursPerDay')}
              value={fase.sundayHoursPerDay}
              min={0}
              step={0.5}
              onChange={valor => editar({ sundayHoursPerDay: valor })}
            />
          </div>
        </section>
      </div>

      <AlocacoesTabela fase={fase} levantamento={levantamento} caminho={caminho} />

      <DespesasFase fase={fase} levantamento={levantamento} caminho={caminho} />
      </div>
    </article>
  );
}
