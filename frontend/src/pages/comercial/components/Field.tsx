import { useId } from 'react';

import { dinheiroDigitado, mascaraDeDinheiro } from '../custos/formato';
import type { ReactNode } from 'react';

/**
 * Campo de formulário do módulo Comercial — a base da lacuna L1.
 *
 * Generaliza o componente `Field` da referência (`app/page.tsx:1187`), que é o
 * **único** lugar do app de origem que faz `aria-invalid` certo. A tela de
 * custos, com 465 controles, tem zero.
 *
 * O que este componente resolve, e por que importa:
 *
 * A referência concatena todas as pendências numa string e joga fora o `path`
 * que a validação já devolve. O usuário recebe um banner com doze erros
 * grudados e nenhuma pista de qual campo é qual. Aqui cada pendência tem
 * endereço.
 *
 * **Vazio e inválido são dois estados, não um.** Marcar de vermelho resolve o
 * *onde* e não resolve o *quê*: o campo fica destacado, o usuário olha, vê
 * texto lá dentro e continua sem entender. Por isso `error` aceita a mensagem
 * específica ("E-mail inválido") em vez de só um booleano.
 *
 * As classes vêm do `base.css` compartilhado, não do CSS do módulo: estado de
 * campo inválido é **comportamento**, e a exceção de identidade portada do
 * Princípio VI é só de aparência.
 */

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Mensagem específica. Vazio/ausente = campo válido. */
  error?: string | null;
  required?: boolean;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  /** Texto de apoio permanente, exibido mesmo sem erro. */
  hint?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel' | 'url';
  /**
   * Âncora para o tutorial (T096/T097).
   *
   * Declarada de propósito, e não deixada como `data-*` solto: TypeScript
   * **aceita qualquer `data-*` em JSX sem reclamar**, e o `Field` não repassa
   * props extras — escrever `data-tutorial="cnpj"` na chamada compilava, não
   * chegava ao DOM, e o passo do tutorial sumia sem erro nenhum.
   */
  dataTutorial?: string;
};

export function Field({
  label,
  value,
  onChange,
  error,
  required,
  type = 'text',
  placeholder = '',
  disabled,
  readOnly,
  maxLength,
  hint,
  inputMode,
  dataTutorial
}: FieldProps) {
  const id = useId();
  const errorId = `${id}-erro`;
  const hintId = `${id}-dica`;
  const invalid = Boolean(error);

  return (
    <div className={groupClass(invalid)} data-tutorial={dataTutorial}>
      <label htmlFor={id}>
        {label}
        {required && <span className="survey-required-marker">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={maxLength}
        inputMode={inputMode}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(invalid ? errorId : null, hint ? hintId : null)}
        onChange={event => onChange(event.target.value)}
      />
      {hint && !invalid && (
        <small id={hintId} className="field-hint">
          {hint}
        </small>
      )}
      {invalid && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

/**
 * Campo numérico — porte de `NumberInput` da referência.
 *
 * Mantém `type="number"` com `min`/`max`/`step` como no original: as setinhas
 * do navegador aparecem nas capturas da baseline, então são paridade.
 * Campo vazio vira `0`, como lá — não `NaN`, que quebraria o cálculo ao vivo.
 */
type NumberFieldProps = {
  label: string;
  value: unknown;
  onChange: (value: number) => void;
  error?: string | null;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
};

export function NumberField({
  label,
  value,
  onChange,
  error,
  required,
  min,
  max,
  step = 1,
  disabled,
  placeholder,
  hint
}: NumberFieldProps) {
  const id = useId();
  const errorId = `${id}-erro`;
  const hintId = `${id}-dica`;
  const invalid = Boolean(error);

  return (
    <div className={groupClass(invalid)}>
      <label htmlFor={id}>
        {label}
        {required && <span className="survey-required-marker">*</span>}
      </label>
      <input
        id={id}
        type="number"
        value={Number(value) === 0 ? '' : ((value as string | number | null | undefined) ?? '')}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(invalid ? errorId : null, hint ? hintId : null)}
        onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
      />
      {hint && !invalid && (
        <small id={hintId} className="field-hint">
          {hint}
        </small>
      )}
      {invalid && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

type AreaProps = Omit<FieldProps, 'type' | 'inputMode'> & { rows?: number };

export function Area({
  label,
  value,
  onChange,
  error,
  required,
  placeholder = '',
  disabled,
  readOnly,
  maxLength,
  hint,
  rows = 4
}: AreaProps) {
  const id = useId();
  const errorId = `${id}-erro`;
  const hintId = `${id}-dica`;
  const invalid = Boolean(error);

  return (
    <div className={groupClass(invalid)}>
      <label htmlFor={id}>
        {label}
        {required && <span className="survey-required-marker">*</span>}
      </label>
      <textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={maxLength}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(invalid ? errorId : null, hint ? hintId : null)}
        onChange={event => onChange(event.target.value)}
      />
      {hint && !invalid && (
        <small id={hintId} className="field-hint">
          {hint}
        </small>
      )}
      {invalid && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

type SelectFieldProps = Omit<FieldProps, 'type' | 'placeholder' | 'inputMode'> & {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  /** Texto da opção vazia. Ausente = sem opção vazia. */
  emptyLabel?: string;
};

export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  required,
  disabled,
  emptyLabel,
  hint
}: SelectFieldProps) {
  const id = useId();
  const errorId = `${id}-erro`;
  const hintId = `${id}-dica`;
  const invalid = Boolean(error);

  return (
    <div className={groupClass(invalid)}>
      <label htmlFor={id}>
        {label}
        {required && <span className="survey-required-marker">*</span>}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(invalid ? errorId : null, hint ? hintId : null)}
        onChange={event => onChange(event.target.value)}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map(option => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && !invalid && (
        <small id={hintId} className="field-hint">
          {hint}
        </small>
      )}
      {invalid && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

/**
 * Grupo sem controle próprio — checkbox, radio, lista.
 * Usa `.field-invalid-panel` porque esses grupos não têm borda para pintar.
 */
export function FieldPanel({
  label,
  error,
  required,
  children
}: {
  label: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-erro`;
  const invalid = Boolean(error);

  return (
    <div className="field-group">
      <span className="field-group-label">
        {label}
        {required && <span className="survey-required-marker">*</span>}
      </span>
      <div
        className={invalid ? 'field-invalid-panel' : undefined}
        role="group"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
      >
        {children}
      </div>
      {invalid && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

function groupClass(invalid: boolean) {
  return invalid ? 'field-group field-invalid' : 'field-group';
}

function describedBy(...ids: Array<string | null>) {
  const present = ids.filter(Boolean);
  return present.length ? present.join(' ') : undefined;
}

/**
 * Campo de VALOR, com máscara de R$ — desvio nº 14, aprovado em 11/08.
 *
 * Mesmo contrato do `NumberField`: recebe e devolve **número**, porque é ele
 * que alimenta o cálculo ao vivo. O que muda é a exibição — os dígitos são
 * lidos como centavos, e digitar `12345` mostra `R$ 123,45`.
 *
 * **Por que não `type="number"`:** com máscara, o valor exibido deixa de ser um
 * número válido para o navegador, e o campo passaria a rejeitar o próprio
 * conteúdo. `inputMode="numeric"` mantém o teclado numérico no celular, que era
 * metade do ganho das setinhas.
 *
 * O que se perde em relação ao `NumberField`: as setinhas de incremento, que
 * aparecem nas capturas da baseline. É parte do desvio, e está registrada nele —
 * incrementar de um em um centavo não servia para nada.
 */
type MoneyFieldProps = Omit<NumberFieldProps, 'min' | 'max' | 'step'>;

export function MoneyField({
  label,
  value,
  onChange,
  error,
  required,
  disabled,
  placeholder = 'R$ 0,00',
  hint
}: MoneyFieldProps) {
  const id = useId();
  const errorId = `${id}-erro`;
  const hintId = `${id}-dica`;
  const invalid = Boolean(error);

  return (
    <div className={groupClass(invalid)}>
      <label htmlFor={id}>
        {label}
        {required && <span className="survey-required-marker">*</span>}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={mascaraDeDinheiro(value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(invalid ? errorId : null, hint ? hintId : null)}
        onChange={event => onChange(dinheiroDigitado(event.target.value))}
      />
      {hint && !invalid && (
        <small id={hintId} className="field-hint">
          {hint}
        </small>
      )}
      {invalid && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

/**
 * A mesma máscara, **sem rótulo** — para as células de tabela.
 *
 * As seções de insumos, produtos, filtros, despesas e alocações desenham os
 * valores dentro de `<td>`, com `aria-label` no lugar do `<label>`. Reusar o
 * `MoneyField` ali traria o invólucro do campo para dentro da célula e
 * desalinharia a tabela inteira.
 */
export function MoneyInput({
  value,
  onChange,
  disabled,
  invalid,
  ...resto
}: {
  value: unknown;
  onChange: (value: number) => void;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label': string;
  className?: string;
}) {
  return (
    <input
      {...resto}
      type="text"
      inputMode="numeric"
      value={mascaraDeDinheiro(value)}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={event => onChange(dinheiroDigitado(event.target.value))}
    />
  );
}
