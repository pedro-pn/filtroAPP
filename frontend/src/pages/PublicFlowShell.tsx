import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { BrandLogo } from '../components/brand/BrandLogo';
import './PublicFlowShell.css';

export function PublicFlowShell({ title, description, children, wide = false, preview = false }: {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  preview?: boolean;
}) {
  return <main className={`fv-ds public-flow-page${wide ? ' public-flow-page--wide' : ''}`} data-fv-ds>
    <section className="public-flow-card" aria-labelledby="public-flow-title">
      {preview ? <div className="public-flow-preview"><span>Demonstração visual · nenhum dado será enviado</span><Link to="/visualizar">Ver todos os links</Link></div> : null}
      <header className="public-flow-header">
        <BrandLogo className="public-flow-logo" />
        <h1 id="public-flow-title">{title}</h1>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="public-flow-content">{children}</div>
    </section>
  </main>;
}
