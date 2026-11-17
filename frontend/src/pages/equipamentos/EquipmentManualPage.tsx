import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

import manualHtml from './manual/manual.html?raw';
import './manual/manual.css';

// Manual do usuário do módulo Equipamentos. O conteúdo (HTML + CSS) é gerado a partir de
// `docs/manual-usuario-equipamentos/` e as capturas de tela ficam em `assets/manual-equipamentos/`.
const imageUrls = Object.fromEntries(
  Object.entries(import.meta.glob('../../assets/manual-equipamentos/*.{jpg,png}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)
    .map(([path, url]) => [path.split('/').pop()!.replace(/\.[^.]+$/, ''), url])
);

function resolveManualImages(html: string) {
  return html.replace(/\{\{img:([a-z0-9-]+)\}\}/g, (_match, name: string) => imageUrls[name] ?? '');
}

export function EquipmentManualPage() {
  const html = useMemo(() => resolveManualImages(manualHtml), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const previous = document.title;
    document.title = 'Manual do módulo Equipamentos';
    return () => { document.title = previous; };
  }, []);

  // Abre direto no capítulo quando a URL tem #ancora (ex.: /equipamentos/manual#h8).
  useEffect(() => {
    if (!location.hash) return;
    const target = rootRef.current?.querySelector(`[id="${CSS.escape(location.hash.slice(1))}"]`);
    target?.scrollIntoView();
  }, [location.hash]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const nav = root.querySelector<HTMLElement>('nav.toc');
    const button = root.querySelector<HTMLButtonElement>('[data-toc-button]');
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('nav.toc .list a'));
    const byId = new Map(links.map(link => [link.getAttribute('href')!.slice(1), link]));
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h1[id], h2[id]'));

    function toggleToc() {
      const open = nav?.classList.toggle('open') ?? false;
      button?.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function spy() {
      let current: HTMLElement | null = null;
      for (const heading of headings) if (heading.getBoundingClientRect().top < 140) current = heading;
      for (const link of links) link.classList.remove('on');
      if (current) byId.get(current.id)?.classList.add('on');
    }
    function onClick(event: MouseEvent) {
      const back = (event.target as HTMLElement).closest('[data-manual-back]');
      if (back) {
        event.preventDefault();
        navigate('/equipamentos');
      }
    }

    button?.addEventListener('click', toggleToc);
    root.addEventListener('click', onClick);
    window.addEventListener('scroll', spy, { passive: true });
    spy();
    return () => {
      button?.removeEventListener('click', toggleToc);
      root.removeEventListener('click', onClick);
      window.removeEventListener('scroll', spy);
    };
  }, [navigate]);

  return <div className="equip-manual" ref={rootRef} data-equip-manual dangerouslySetInnerHTML={{ __html: html }} />;
}
