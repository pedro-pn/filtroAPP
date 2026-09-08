export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelSize {
  width: number;
  height: number;
}

const MIN_FIELD_SIZE = 0.02;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function clampNormalizedRect(rect: NormalizedRect): NormalizedRect {
  const width = clamp(rect.width, MIN_FIELD_SIZE, 1);
  const height = clamp(rect.height, MIN_FIELD_SIZE, 1);
  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    width,
    height
  };
}

export function pixelToNormalized(rect: NormalizedRect, container: PixelSize): NormalizedRect {
  if (container.width <= 0 || container.height <= 0) {
    return { x: 0, y: 0, width: MIN_FIELD_SIZE, height: MIN_FIELD_SIZE };
  }
  return clampNormalizedRect({
    x: rect.x / container.width,
    y: rect.y / container.height,
    width: rect.width / container.width,
    height: rect.height / container.height
  });
}

export function normalizedToPercent(rect: NormalizedRect) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`
  };
}

export function captureInviteFromFragment(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>
) {
  const params = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  const token = params.get('convite') || '';
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return /^[a-f0-9]{64}$/i.test(token) ? token : '';
}
