import axios from 'axios';
import { BuildData, CharaRoster, CostumeMap } from '../types';
import { getApiBase, getAssetsBase } from '../config';
import { bundleAssetUrl } from '../utils/assets';

export const fetchCharaRoster = async (): Promise<CharaRoster> => {
  const response = await axios.get(`${getApiBase()}/characters/all.2.json`);
  return response.data;
};

export const fetchAssetsIndex = async (): Promise<any> => {
  const response = await axios.get(`${getApiBase()}/explorer/jp/assets/_info.json`);
  return response.data;
};

export const fetchCostumes = async (): Promise<CostumeMap> => {
  const response = await axios.get(`${getApiBase()}/costumes/all.5.json`);
  return response.data;
};

export const fetchBuildData = async (modelName: string): Promise<BuildData> => {
  const url = `${getAssetsBase()}/jp/live2d/chara/${modelName}_rip/buildData.asset`;
  const response = await axios.get(url);
  return response.data.Base;
};

export const getFileCount = (data: BuildData): number => {
  return 1 + 1 + data.textures.length + data.motions.length + data.expressions.length;
};

export const fetchModelSize = async (data: BuildData): Promise<number> => {
  const urls = [
    bundleAssetUrl(data.model, 'model'),
    bundleAssetUrl(data.physics, 'physics'),
    ...data.textures.map((t) => bundleAssetUrl(t, 'texture')),
    ...data.motions.map((m) => bundleAssetUrl(m, 'motion')),
    ...data.expressions.map((e) => bundleAssetUrl(e, 'expression')),
  ];

  const sizes = await Promise.all(
    urls.map(async (url) => {
      try {
        const resp = await axios.head(url);
        const contentType = String(resp.headers['content-type'] || '');
        if (contentType.startsWith('text/html')) return 0;
        const len = resp.headers['content-length'];
        return len ? parseInt(len, 10) : 0;
      } catch {
        return 0;
      }
    })
  );

  return sizes.reduce((sum, s) => sum + s, 0);
};

export const formatSize = (bytes: number): string => {
  if (bytes === 0) return '计算中…';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};
