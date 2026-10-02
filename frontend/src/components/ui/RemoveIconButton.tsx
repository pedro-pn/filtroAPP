import type { IconButtonProps } from './ds';
import { IconButton } from './ds';
import { DS_ICONS } from './ds/icons';
import './RemoveIconButton.css';

type Props = Omit<IconButtonProps, 'icon' | 'variant' | 'title'>;

/** A mesma ação de remoção em listas, formulários e cartões de todos os módulos. */
export function RemoveIconButton({ className, size = 'sm', ...props }: Props) {
  return (
    <IconButton
      {...props}
      className={['fv-remove-icon-button', className].filter(Boolean).join(' ')}
      icon={DS_ICONS.trash}
      variant="danger"
      size={size}
      title="Remover"
    />
  );
}
