const MIRROR_BASE = '/mirror';

export function getApiBase(): string {
  return `${MIRROR_BASE}/bestdori-api`;
}

export function getAssetsBase(): string {
  return `${MIRROR_BASE}/bestdori-assets`;
}
