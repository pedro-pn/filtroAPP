import { useEffect, useState } from 'react';

import { BrandLoading } from '../components/brand/BrandLoading';
import { BrandLogo } from '../components/brand/BrandLogo';
import { Button } from '../components/ui/ds';
import { PublicFlowShell } from './PublicFlowShell';
import './VisualPreviewLoadingPage.css';

export function VisualPreviewLoadingPage() {
  const [progress, setProgress] = useState(0);
  const [replay, setReplay] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;

    let frame = 0;
    let startedAt: number | null = null;
    const tick = (now: number) => {
      startedAt ??= now;
      const next = Math.min(100, Math.round((now - startedAt) / 45));
      setProgress(next);
      if (next < 100) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, replay]);

  return <PublicFlowShell title="Animações de carregamento" description="Compare a rotação das setas com o preenchimento por progresso." preview>
    <section className="loading-preview-option" aria-labelledby="loading-preview-spin-title">
      <h2 id="loading-preview-spin-title">Setas girando</h2>
      <div className="loading-preview-comparison">
        <figure>
          <div className="loading-preview-stage">
            <BrandLogo variant="symbol" alt="Símbolo original da Filtrovali" className="loading-preview-original" />
          </div>
          <figcaption>Logo original</figcaption>
        </figure>
        <figure>
          <div className="loading-preview-stage">
            <BrandLoading mode="spin" label="Setas girando ao redor da marca" />
          </div>
          <figcaption>Animação</figcaption>
        </figure>
      </div>
    </section>
    <section className="loading-preview-option" aria-labelledby="loading-preview-progress-title">
      <h2 id="loading-preview-progress-title">Setas colorindo conforme o progresso</h2>
      <div className="loading-preview-stage">
        <BrandLoading mode="progress" progress={progress} label="Progresso do carregamento" />
      </div>
      <div className="loading-preview-controls">
        <label htmlFor="loading-preview-progress">Progresso <output htmlFor="loading-preview-progress">{progress}%</output></label>
        <input id="loading-preview-progress" type="range" min="0" max="100" value={progress} onChange={event => { setPlaying(false); setProgress(Number(event.target.value)); }} />
        <Button variant="secondary" size="sm" type="button" onClick={() => { setProgress(0); setReplay(value => value + 1); setPlaying(true); }}>Reproduzir</Button>
      </div>
    </section>
  </PublicFlowShell>;
}
