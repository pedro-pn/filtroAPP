import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { BrandLogo, type BrandLogoVariant } from '../components/brand/BrandLogo';
import './PublicFlowShell.css';

export function PublicFlowShell({ title, description, children, wide = false, preview = false, logoVariant, titleHidden = false }: {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  preview?: boolean;
  logoVariant?: BrandLogoVariant;
  titleHidden?: boolean;
}) {
  return <main className={`fv-ds public-flow-page${wide ? ' public-flow-page--wide' : ''}`} data-fv-ds>
    <section className="public-flow-card" aria-labelledby="public-flow-title">
      {preview ? <div className="public-flow-preview"><span>Demonstração visual · nenhum dado será enviado</span><Link to="/visualizar">Ver todos os links</Link></div> : null}
      <header className="public-flow-header">
        <BrandLogo className="public-flow-logo" variant={logoVariant} />
        <h1 id="public-flow-title" className={titleHidden ? 'fv-sr-only' : undefined}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="public-flow-content">{children}</div>
    </section>
  </main>;
}
