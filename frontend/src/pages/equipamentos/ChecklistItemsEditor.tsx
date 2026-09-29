import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { AppIcon } from '../../components/icons/AppIcon';
import { Button } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';

interface ChecklistItemsEditorProps {
  appearance?: 'legacy' | 'design-system';
  value: string[];
  onChange: (items: string[]) => void;
  disabled?: boolean;
  emptyText?: string;
  placeholder?: string;
  itemLabel?: string;
  addLabel?: string;
}

function EditorButton({ appearance, variant, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  appearance: 'legacy' | 'design-system';
  variant: 'secondary' | 'danger';
  children: ReactNode;
}) {
  if (appearance === 'design-system') {
    return <Button variant={variant} size="sm" className={className} {...props}>{children}</Button>;
  }
  return <button type="button" className={`mini-btn ${variant === 'danger' ? 'danger' : 'alt'} ${className || ''}`} {...props}>{children}</button>;
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
  appearance = 'legacy',
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
              <EditorButton
                appearance={appearance} variant="secondary" className="checklist-item-editor-action"
                aria-label="Mover ponto para cima"
                title="Mover para cima"
                disabled={disabled || index === 0}
                onClick={() => onChange(move(value, index, -1))}
              >
                ↑
              </EditorButton>
              <EditorButton
                appearance={appearance} variant="secondary" className="checklist-item-editor-action"
                aria-label="Mover ponto para baixo"
                title="Mover para baixo"
                disabled={disabled || index === value.length - 1}
                onClick={() => onChange(move(value, index, 1))}
              >
                ↓
              </EditorButton>
              <EditorButton
                appearance={appearance} variant="danger" className="checklist-item-editor-action"
                aria-label="Remover ponto"
                title="Remover ponto"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    value.filter((_, currentIndex) => currentIndex !== index)
                  )
                }
              >
                {appearance === 'design-system' ? <AppIcon icon={DS_ICONS.trash} size="sm" /> : '×'}
              </EditorButton>
            </div>
          </div>
        </div>
      ))}
      <EditorButton
        appearance={appearance} variant="secondary" className="checklist-item-editor-add"
        disabled={disabled || value.length >= 100}
        onClick={() => onChange([...value, ''])}
      >
        {addLabel}
      </EditorButton>
    </div>
  );
}
