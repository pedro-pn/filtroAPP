import type { ImgHTMLAttributes } from 'react';

import { useTheme } from '../../theme/useTheme';
import './BrandLogo.css';

import { BRAND_LOGO_ASSETS } from './brandAssets';

export type BrandLogoVariant = 'adaptive' | keyof typeof BRAND_LOGO_ASSETS;

export interface BrandLogoProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'alt' | 'height' | 'src' | 'width'
> {
  variant?: BrandLogoVariant;
  alt?: string;
  decorative?: boolean;
}

export function BrandLogo({
  variant = 'adaptive',
  alt = 'Filtrovali',
  decorative = false,
  className,
  loading = 'eager',
  ...props
}: BrandLogoProps) {
  const { resolvedTheme } = useTheme();
  const resolvedVariant =
    variant === 'adaptive'
      ? resolvedTheme === 'dark'
        ? 'white'
        : 'color'
      : variant;
  const asset = BRAND_LOGO_ASSETS[resolvedVariant];

  return (
    <img
      {...props}
      className={['fv-brand-logo', className].filter(Boolean).join(' ')}
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt={decorative ? '' : alt}
      aria-hidden={decorative || undefined}
      data-brand-variant={resolvedVariant}
      decoding="async"
      loading={loading}
    />
  );
}
