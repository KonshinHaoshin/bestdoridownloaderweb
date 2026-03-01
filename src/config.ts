/**
 * Bestdori API / Assets 基地址（支持运行时切换直连 / 反代）
 * - 直连：空字符串，使用相对路径（本地走 Vite 代理，生产需部署方配置代理）
 * - 反代：Worker 域名，如 https://live2d.shelter.net.cn
 */
export const BESTDORI_WORKER_URL = 'https://live2d.shelter.net.cn';

const BUILD_TIME_BASE = import.meta.env.VITE_BESTDORI_BASE ?? '';

function getStored(): string {
  try {
    const stored = localStorage.getItem('bestdori_base');
    if (stored !== null) return stored;
  } catch {}
  return BUILD_TIME_BASE;
}

let _runtimeBase: string = getStored();

export function getBestdoriBase(): string {
  return _runtimeBase;
}

export function setBestdoriBase(base: string): void {
  _runtimeBase = base;
  try {
    localStorage.setItem('bestdori_base', base);
  } catch {}
}

export function getApiBase(): string {
  const base = _runtimeBase;
  return base ? `${base}/bestdori-api` : '/bestdori-api';
}

export function getAssetsBase(): string {
  const base = _runtimeBase;
  return base ? `${base}/bestdori-assets` : '/bestdori-assets';
}

/** 供 React 初始状态使用：与 getBestdoriBase 一致 */
export function getInitialBestdoriBase(): string {
  return getStored();
}
