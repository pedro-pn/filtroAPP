import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';

import { AppIcon } from '../components/icons/AppIcon';
import { Badge } from '../components/ui/ds';
import { NAVIGATION_CHROME_ICONS } from './navigationIcons';
import type { NavigationModel, NavigationSubItem } from './navigationModel';

export interface NavigationListProps {
  navigation: NavigationModel;
  onNavigate?: () => void;
  compact?: boolean;
}

function handleSubItemClick(event: MouseEvent<HTMLAnchorElement>, item: NavigationSubItem, onNavigate?: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (item.onSelect) {
    event.preventDefault();
    item.onSelect();
  }
  onNavigate?.();
}

function NavigationSubmenuItem({ item, onNavigate, menuId }: {
  item: NavigationSubItem;
  onNavigate?: () => void;
  menuId: string;
}) {
  const [expanded, setExpanded] = useState(item.active);
  const activeChildRef = useRef<HTMLAnchorElement>(null);
  const activeChildId = item.children?.find(child => child.active)?.id;
  useEffect(() => {
    if (item.active) setExpanded(true);
  }, [item.active]);
  useEffect(() => {
    if (!expanded || !activeChildId) return;
    const link = activeChildRef.current;
    const scroller = link?.closest<HTMLElement>('.fv-sidebar__navigation');
    if (!link || !scroller) return;
    const linkBounds = link.getBoundingClientRect();
    const scrollerBounds = scroller.getBoundingClientRect();
    if (linkBounds.top < scrollerBounds.top) scroller.scrollTop += linkBounds.top - scrollerBounds.top;
    else if (linkBounds.bottom > scrollerBounds.bottom) scroller.scrollTop += linkBounds.bottom - scrollerBounds.bottom;
  }, [activeChildId, expanded]);

  if (!item.children?.length) {
    return (
      <Link className={`fv-navigation-subitem${item.active ? ' is-active' : ''}`}
        to={item.href} aria-current={item.active ? 'page' : undefined}
        onClick={event => handleSubItemClick(event, item, onNavigate)}>
        <span className="fv-navigation-subitem__marker" aria-hidden="true" />
        <span className="fv-navigation-item__label">{item.label}</span>
        {item.badge !== undefined ? <Badge tone={item.active ? 'brand' : 'neutral'}>{item.badge}</Badge> : null}
      </Link>
    );
  }

  return (
    <>
      <button type="button" className={`fv-navigation-subitem fv-navigation-subitem--toggle${item.active ? ' is-active' : ''}`}
        aria-expanded={expanded} aria-controls={menuId}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next && !item.active) item.onSelect?.();
        }}>
        <span className="fv-navigation-subitem__marker" aria-hidden="true" />
        <span className="fv-navigation-item__label">{item.label}</span>
        {item.badge !== undefined ? <Badge tone={item.active ? 'brand' : 'neutral'}>{item.badge}</Badge> : null}
        <AppIcon className="fv-navigation-subitem__chevron" icon={NAVIGATION_CHROME_ICONS.collapse} size="sm" />
      </button>
      {expanded ? (
        <ul className="fv-navigation-submenu fv-navigation-submenu--nested" id={menuId} aria-label={`Categorias de ${item.label}`}>
          {item.children.map(child => (
            <li key={child.id}>
              <Link ref={child.active ? activeChildRef : undefined}
                className={`fv-navigation-subitem${child.active ? ' is-active' : ''}`}
                to={child.href} aria-current={child.active ? 'location' : undefined}
                onClick={event => handleSubItemClick(event, child, onNavigate)}>
                <span className="fv-navigation-subitem__marker" aria-hidden="true" />
                <span className="fv-navigation-item__label">{child.label}</span>
                {child.badge !== undefined ? <Badge tone={child.active ? 'brand' : 'neutral'}>{child.badge}</Badge> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function NavigationList({
  navigation,
  onNavigate,
  compact = false
}: NavigationListProps) {
  const groupIdPrefix = useId();

  return (
    <div className="fv-navigation-list" data-compact={compact || undefined}>
      {navigation.groups.map((group) => (
        <section
          className="fv-navigation-group"
          key={group.id}
          aria-labelledby={`${groupIdPrefix}-${group.id}`}
        >
          <h2
            className="fv-navigation-group__label"
            id={`${groupIdPrefix}-${group.id}`}
          >
            {group.label}
          </h2>
          <ul className="fv-navigation-group__items">
            {group.items.map((item) => (
              <li key={item.id}>
                {item.disabled || !item.href ? (
                  <span
                    className="fv-navigation-item is-disabled"
                    aria-disabled="true"
                    aria-label={compact ? item.label : undefined}
                    title={compact ? item.label : undefined}
                  >
                    <AppIcon icon={item.icon} />
                    <span className="fv-navigation-item__label">
                      {item.label}
                    </span>
                    {item.badge !== undefined ? (
                      <Badge tone="neutral">{item.badge}</Badge>
                    ) : null}
                  </span>
                ) : (
                  <Link
                    className={`fv-navigation-item${item.active ? ' is-active' : ''}`}
                    to={item.href}
                    aria-current={
                      item.active &&
                      (compact || !item.children?.some((child) => child.active))
                        ? 'page'
                        : undefined
                    }
                    aria-expanded={item.children && !compact ? item.expanded : undefined}
                    aria-controls={
                      item.children && !compact
                        ? `${groupIdPrefix}-${item.id}-submenu`
                        : undefined
                    }
                    title={compact ? item.label : undefined}
                    onClick={onNavigate}
                  >
                    <AppIcon icon={item.icon} />
                    <span className="fv-navigation-item__label">
                      {item.label}
                    </span>
                    {item.badge !== undefined ? (
                      <Badge tone={item.active ? 'brand' : 'neutral'}>
                        {item.badge}
                      </Badge>
                    ) : null}
                    {item.expanded ? (
                      <AppIcon
                        className="fv-navigation-item__expansion"
                        icon={NAVIGATION_CHROME_ICONS.collapse}
                        size="sm"
                      />
                    ) : null}
                  </Link>
                )}
                {!compact && item.expanded && item.children?.length ? (
                  <ul
                    className="fv-navigation-submenu"
                    id={`${groupIdPrefix}-${item.id}-submenu`}
                    aria-label={`Áreas de ${item.label}`}
                  >
                    {item.children.map((child) => (
                      <li key={child.id}>
                        <NavigationSubmenuItem item={child} onNavigate={onNavigate}
                          menuId={`${groupIdPrefix}-${item.id}-${child.id}-submenu`} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
