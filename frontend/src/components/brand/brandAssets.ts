const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(
  /\/$/,
  ''
);

function brandAsset(filename: string) {
  return `${assetsBaseUrl}/assets/Logo/${filename}`;
}

export const BRAND_LOGO_ASSETS = {
  color: { src: brandAsset('LOGO_COLORIDO.png'), width: 3505, height: 943 },
  header: { src: brandAsset('LOGO_HEADER.png'), width: 3519, height: 1065 },
  white: { src: brandAsset('LOGO_BRANCA.png'), width: 3514, height: 974 },
  login: { src: brandAsset('LOGO_LOGIN.png'), width: 2756, height: 1978 },
  symbol: { src: brandAsset('LOGO_TAB.png'), width: 2011, height: 2028 },
  green: { src: brandAsset('LOGO_VERDE.png'), width: 4501, height: 1240 }
} as const;

