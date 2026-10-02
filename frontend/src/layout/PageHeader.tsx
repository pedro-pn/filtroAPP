import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface PageHeaderBreadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: readonly PageHeaderBreadcrumb[];
  actions?: ReactNode;
  auxiliary?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  auxiliary,
  className
}: PageHeaderProps) {
  return (
    <header
      className={['fv-ds', 'fv-page-header', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="fv-page-header__main">
        <div className="fv-page-header__copy">
          {breadcrumb?.length ? (
            <nav aria-label="Breadcrumb">
              <ol className="fv-page-header__breadcrumb">
                {breadcrumb.map((item, index) => (
                  <li key={`${item.label}-${index}`}>
                    {item.href ? (
                      <Link to={item.href}>{item.label}</Link>
                    ) : (
                      item.label
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? (
          <div className="fv-page-header__actions">{actions}</div>
        ) : null}
      </div>
      {auxiliary ? (
        <div className="fv-page-header__auxiliary">{auxiliary}</div>
      ) : null}
    </header>
  );
}
