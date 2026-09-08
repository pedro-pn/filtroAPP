interface ChecklistItemsEditorProps {
  value: string[];
  onChange: (items: string[]) => void;
  disabled?: boolean;
  emptyText?: string;
  placeholder?: string;
  itemLabel?: string;
  addLabel?: string;
}

function updateAt(items: string[], index: number, value: string) {
  return items.map((item, currentIndex) =>
    currentIndex === index ? value : item
  );
}

function move(items: string[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function ChecklistItemsEditor({
  value,
  onChange,
  disabled = false,
  emptyText = 'Nenhum ponto cadastrado.',
  placeholder = 'Ponto de checagem',
  itemLabel = 'Ponto de checagem',
  addLabel = 'Adicionar ponto'
}: ChecklistItemsEditorProps) {
  return (
    <div className="checklist-items-editor">
      {value.length === 0 && <p className="rel-meta">{emptyText}</p>}
      {value.map((item, index) => (
        <div className="checklist-item-editor-row" key={index}>
          <div className="tech-build-main checklist-item-editor-main">
            <span className="checklist-item-editor-index">{index + 1}</span>
            <input
              type="text"
              value={item}
              maxLength={300}
              disabled={disabled}
              placeholder={placeholder}
              aria-label={`${itemLabel} ${index + 1}`}
              onChange={(event) =>
                onChange(updateAt(value, index, event.target.value))
              }
            />
            <div className="checklist-item-editor-actions">
              <button
                className="mini-btn alt checklist-item-editor-action"
                type="button"
                aria-label="Mover ponto para cima"
                title="Mover para cima"
                disabled={disabled || index === 0}
                onClick={() => onChange(move(value, index, -1))}
              >
                ↑
              </button>
              <button
                className="mini-btn alt checklist-item-editor-action"
                type="button"
                aria-label="Mover ponto para baixo"
                title="Mover para baixo"
                disabled={disabled || index === value.length - 1}
                onClick={() => onChange(move(value, index, 1))}
              >
                ↓
              </button>
              <button
                className="mini-btn danger checklist-item-editor-action"
                type="button"
                aria-label="Remover ponto"
                title="Remover ponto"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    value.filter((_, currentIndex) => currentIndex !== index)
                  )
                }
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ))}
      <button
        className="mini-btn alt checklist-item-editor-add"
        type="button"
        disabled={disabled || value.length >= 100}
        onClick={() => onChange([...value, ''])}
      >
        {addLabel}
      </button>
    </div>
  );
}
