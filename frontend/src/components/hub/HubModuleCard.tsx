import { ChevronRight } from 'lucide-react';

import type { HubModuleEntry } from '../../pages/hubModules';
import { AppIcon } from '../icons/AppIcon';
import { Badge, Card } from '../ui/ds';
import { MODULE_NAVIGATION_ICONS } from '../../layout/navigationIcons';

export interface HubModuleCardProps {
  module: HubModuleEntry;
  isNew?: boolean;
  onActivate?: () => void;
}

export function HubModuleCard({
  module,
  isNew = false,
  onActivate
}: HubModuleCardProps) {
  const disabled = Boolean(module.disabled || !onActivate);
  const ModuleIcon = MODULE_NAVIGATION_ICONS[module.id];

  return (
    <Card
      variant={disabled ? 'flat' : 'interactive'}
      padding="md"
      className={`hub-module-card${disabled ? ' is-disabled' : ''}`}
      data-hub-module-id={module.id}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onActivate}
    >
      <span className="hub-module-card__icon" aria-hidden="true">
        <AppIcon icon={ModuleIcon} size="lg" />
      </span>

      <span className="hub-module-card__content">
        <span className="hub-module-card__heading">
          <span className="hub-module-card__title">{module.title}</span>
          {isNew ? (
            <Badge tone="brand" aria-label="Novo módulo">
              Novo
            </Badge>
          ) : null}
        </span>
        <span className="hub-module-card__description">{module.copy}</span>
      </span>

      {!disabled ? (
        <AppIcon
          className="hub-module-card__arrow"
          icon={ChevronRight}
          size="sm"
        />
      ) : null}
    </Card>
  );
}
