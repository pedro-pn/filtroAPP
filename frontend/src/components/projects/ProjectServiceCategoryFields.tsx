export function ProjectServiceCategoryFields({ id, category, startDate, endDate, onChange }: {
  id: string; category: 'SERVICE' | 'RENTAL'; startDate: string; endDate: string;
  onChange: (patch: { serviceCategory?: 'SERVICE' | 'RENTAL'; startDate?: string; endDate?: string; operatorId?: string }) => void;
}) {
  return <>
    <div className="field-group">
      <label htmlFor={`${id}-category`}>Categoria do serviço</label>
      <select id={`${id}-category`} value={category} onChange={event => onChange({
        serviceCategory: event.target.value as 'SERVICE' | 'RENTAL', ...(event.target.value === 'RENTAL' ? { operatorId: '' } : {})
      })}>
        <option value="SERVICE">Serviço operacional</option><option value="RENTAL">Locação de equipamentos</option>
      </select>
    </div>
    {category === 'RENTAL' ? <>
      <div className="field-group"><label htmlFor={`${id}-start`}>Início da locação</label>
        <input id={`${id}-start`} type="date" value={startDate} max={endDate || undefined} onChange={event => onChange({ startDate: event.target.value })} /></div>
      <div className="field-group"><label htmlFor={`${id}-end`}>Fim da locação</label>
        <input id={`${id}-end`} type="date" value={endDate} min={startDate || undefined} onChange={event => onChange({ endDate: event.target.value })} /></div>
      <p className="muted">Locação é acompanhada em dias corridos, incluindo as datas de início e fim.</p>
    </> : null}
  </>;
}
