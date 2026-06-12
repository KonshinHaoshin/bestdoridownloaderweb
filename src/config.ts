const BUILD_TIME_BASE = import.meta.env.VITE_BESTDORI_BASE ?? '';

const base = BUILD_TIME_BASE.trim().replace(/\/+$/, '');

export function getApiBase(): string {
  return base ? `${base}/bestdori-api` : '/bestdori-api';
}

export function getAssetsBase(): string {
  return base ? `${base}/bestdori-assets` : '/bestdori-assets';
}
