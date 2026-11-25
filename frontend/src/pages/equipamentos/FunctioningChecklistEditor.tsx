import { useId } from 'react';
import type { FunctioningChecklistTemplate } from '../../api/equipamentos';
import { ChecklistItemsEditor } from './ChecklistItemsEditor';

export function FunctioningChecklistEditor({ value, onChange, disabled = false }: {
  value: FunctioningChecklistTemplate;
  onChange: (value: FunctioningChecklistTemplate) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return <div className="equip-form">
    <div className="field-group">
      <label htmlFor={id}>Formato para impressão</label>
      <select id={id} value={value.format} disabled={disabled} onChange={event => onChange({
        ...value,
        format: event.target.value as FunctioningChecklistTemplate['format'],
        responsibleLabels: event.target.value === 'INSPECTION' ? value.responsibleLabels : undefined
      })}>
        <option value="MONTHLY">Verificação mensal (dias 1 a 31)</option>
        <option value="INSPECTION">Inspeção, acessórios e entrega/devolução</option>
      </select>
    </div>
    <p className="form-hint">{value.format === 'MONTHLY'
      ? 'O PDF contém cliente, missão, local, proposta, área, mês, grade diária, legenda OK/R/P e assinaturas.'
      : 'O PDF contém acessórios, defeitos, observações, datas, responsáveis, funções, assinaturas e registro fotográfico. Sem acessórios cadastrados, serão impressas dez linhas em branco.'}</p>
    <ChecklistItemsEditor appearance="design-system" value={value.items} onChange={items => onChange({ ...value, items })} disabled={disabled}
      itemLabel={value.format === 'INSPECTION' ? 'Acessório' : 'Ponto de checagem'}
      placeholder={value.format === 'INSPECTION' ? 'Acessório' : 'Ponto de checagem'}
      addLabel={value.format === 'INSPECTION' ? 'Adicionar acessório' : 'Adicionar ponto'} />
    {value.format === 'INSPECTION' && <>
      <div className="sec">Identificação dos responsáveis</div>
      {(value.responsibleLabels || ['Responsável Filtrovali', 'Responsável', 'Responsável Filtrovali', 'Responsável']).map((label, index, labels) => <div className="field-group" key={index}>
        <label htmlFor={`${id}-responsible-${index}`}>{index < 2 ? 'Fornecimento' : 'Devolução'} — responsável {index % 2 + 1}</label>
        <input id={`${id}-responsible-${index}`} value={label} maxLength={80} required disabled={disabled}
          onChange={event => onChange({ ...value, responsibleLabels: labels.map((current, n) => n === index ? event.target.value : current) })} />
      </div>)}
    </>}
  </div>;
}
