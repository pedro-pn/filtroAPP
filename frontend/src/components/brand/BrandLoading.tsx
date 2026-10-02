import { useId, useState, type CSSProperties, type HTMLAttributes } from 'react';

import { BRAND_LOGO_ASSETS } from './brandAssets';
import './BrandLoading.css';

const spinningArrows = [
  { name: 'blue', matrix: '0 -32 32 0 -5', offsetX: '-0.06%', offsetY: '-0.55%' },
  { name: 'red', matrix: '8 -8 0 0 -2.5', offsetX: '0.2%', offsetY: '-1.4%' },
  { name: 'purple', matrix: '8 8 0 0 -8', offsetX: '0.17%', offsetY: '1.25%' }
];

export interface BrandLoadingProps extends HTMLAttributes<HTMLElement> {
  label?: string;
  fullscreen?: boolean;
  mode?: 'auto' | 'spin' | 'progress';
  progress?: number;
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
  decorative?: boolean;
}

export function BrandLoading({
  label = 'Carregando',
  fullscreen = false,
  mode = 'auto',
  progress,
  size = 'lg',
  inline = false,
  decorative = false,
  className = '',
  style,
  ...props
}: BrandLoadingProps) {
  const [randomMode] = useState<'spin' | 'progress'>(() => Math.random() < 0.5 ? 'spin' : 'progress');
  const filterId = useId().replace(/:/g, '');
  const arrowsFilterId = `${filterId}-arrows`;
  const centerFilterId = `${filterId}-center`;
  const isDeterminate = typeof progress === 'number' && Number.isFinite(progress);
  const isProgress = isDeterminate || (mode === 'auto' ? randomMode : mode) === 'progress';
  const value = isDeterminate ? Math.min(100, Math.max(0, progress)) : 0;
  const Root = inline ? 'span' : 'div';

  return (
    <Root
      {...props}
      className={`fv-ds fv-brand-loading fv-brand-loading--${size}${fullscreen ? ' fv-brand-loading--fullscreen' : ''}${inline ? ' fv-brand-loading--inline' : ''} ${className}`.trim()}
      style={style}
      role={decorative ? undefined : isDeterminate ? 'progressbar' : 'status'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      aria-live={decorative || isDeterminate ? undefined : 'polite'}
      aria-valuemin={!decorative && isDeterminate ? 0 : undefined}
      aria-valuemax={!decorative && isDeterminate ? 100 : undefined}
      aria-valuenow={!decorative && isDeterminate ? value : undefined}
    >
      <span className="fv-brand-loading__symbol" aria-hidden="true">
        <svg className="fv-brand-loading__filters" aria-hidden="true" focusable="false">
          <defs>
            <filter id={arrowsFilterId} colorInterpolationFilters="sRGB">
              <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 -64 64 0 0" result="arrows" />
              <feComposite in="SourceGraphic" in2="arrows" operator="in" />
            </filter>
            <filter id={centerFilterId} colorInterpolationFilters="sRGB">
              <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 64 -64 0 0" result="center" />
              <feComposite in="SourceGraphic" in2="center" operator="in" />
            </filter>
            {!isProgress && spinningArrows.map(arrow => <filter key={arrow.name} id={`${filterId}-spin-${arrow.name}`} colorInterpolationFilters="sRGB">
              <feColorMatrix in="SourceGraphic" type="matrix" values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ${arrow.matrix}`} result="selected-arrow" />
              <feComposite in="SourceGraphic" in2="selected-arrow" operator="in" />
            </filter>)}
          </defs>
        </svg>
        {isProgress ? <>
          <img src={BRAND_LOGO_ASSETS.symbol.src} alt="" className="fv-brand-logo fv-brand-loading__progress-gray" style={{ filter: `url(#${arrowsFilterId}) brightness(0) invert(.65)` }} />
          <img src={BRAND_LOGO_ASSETS.symbol.src} alt="" className={`fv-brand-logo fv-brand-loading__progress-color${isDeterminate ? '' : ' fv-brand-loading__progress-color--animated'}`} style={{ filter: `url(#${arrowsFilterId})`, ...(isDeterminate ? { '--fv-brand-loading-fill': `${value}%` } : {}) } as CSSProperties} />
        </> : <span className="fv-brand-loading__spin-ring">
          {spinningArrows.map(arrow => <img key={arrow.name} src={BRAND_LOGO_ASSETS.symbol.src} alt="" className="fv-brand-logo fv-brand-loading__spin-arrow" style={{ filter: `url(#${filterId}-spin-${arrow.name})`, transform: `translate(${arrow.offsetX}, ${arrow.offsetY})` }} />)}
        </span>}
        <img src={BRAND_LOGO_ASSETS.symbol.src} alt="" className="fv-brand-logo fv-brand-loading__center" style={{ filter: `url(#${centerFilterId})` }} />
      </span>
    </Root>
  );
}
