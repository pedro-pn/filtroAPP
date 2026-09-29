import type { LucideIcon } from 'lucide-react';

import { moduleIdFromPath } from '../auth/moduleNavigation';
import type { HubModuleEntry } from '../pages/hubModules';
import {
  MODULE_NAVIGATION_ICONS,
  NAVIGATION_CHROME_ICONS
} from './navigationIcons';

export type NavigationBadge = string | number;

export interface NavigationSubItem {
  id: string;
  label: string;
  shortLabel?: string;
  href: string;
  badge?: NavigationBadge;
  active: boolean;
  children?: NavigationSubItem[];
  onSelect?: () => void;
}

export interface NavigationItem {
  id: string;
  label: string;
  description?: string;
  href?: string;
  group: string;
  icon: LucideIcon;
  badge?: NavigationBadge;
  active: boolean;
  disabled?: boolean;
  expanded?: boolean;
  children?: NavigationSubItem[];
}

export interface NavigationGroup {
  id: string;
  label: string;
  items: NavigationItem[];
}

export interface NavigationModel {
  groups: NavigationGroup[];
}

export interface CreateNavigationModelOptions {
  modules: readonly HubModuleEntry[];
  pathname: string;
  subNavigation?: {
    parentId: string;
    items: NavigationSubItem[];
  };
}

export function createNavigationModel({
  modules,
  pathname,
  subNavigation
}: CreateNavigationModelOptions): NavigationModel {
  const activeModuleId = moduleIdFromPath(pathname);

  return {
    groups: [
      {
        id: 'principal',
        label: 'Principal',
        items: [
          {
            id: 'hub',
            label: 'Visão geral',
            description: 'Módulos disponíveis',
            href: '/modulos',
            group: 'principal',
            icon: NAVIGATION_CHROME_ICONS.home,
            active: pathname === '/modulos'
          }
        ]
      },
      {
        id: 'modules',
        label: 'Módulos',
        items: modules.map((module) => {
          const children =
            subNavigation?.parentId === module.id
              ? subNavigation.items
              : undefined;
          return {
            id: module.id,
            label: module.title,
            description: module.copy,
            href: module.path,
            group: 'modules',
            icon: MODULE_NAVIGATION_ICONS[module.id],
            active: activeModuleId === module.id,
            disabled: module.disabled || !module.path,
            expanded: Boolean(children?.length),
            children
          };
        })
      }
    ]
  };
}

export function navigationItems(model: NavigationModel) {
  return model.groups.flatMap((group) => group.items);
}

export interface MobileSectionNavigation {
  module: NavigationItem;
  quickItems: NavigationSubItem[];
  allItems: NavigationSubItem[];
  hasMore: boolean;
  moreActive: boolean;
}

export function mobileSectionNavigation(model: NavigationModel): MobileSectionNavigation | null {
  const module = navigationItems(model).find(item => item.active && !item.disabled && (item.children?.length ?? 0) > 1);
  if (!module?.children) return null;

  const hasMore = module.children.length > 4;
  const quickItems = hasMore ? module.children.slice(0, 3) : module.children;

  return {
    module,
    quickItems,
    allItems: module.children,
    hasMore,
    moreActive: hasMore && module.children.some(item => item.active) && !quickItems.some(item => item.active)
  };
}
