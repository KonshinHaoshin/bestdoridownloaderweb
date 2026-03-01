import axios from 'axios';
import { BuildData, CharaRoster } from '../types';

const API_BASE = '/bestdori-api';
const ASSETS_BASE = '/bestdori-assets';

export const fetchCharaRoster = async (): Promise<CharaRoster> => {
  const response = await axios.get(`${API_BASE}/characters/all.2.json`);
  return response.data;
};

export const fetchAssetsIndex = async (): Promise<any> => {
  const response = await axios.get(`${API_BASE}/explorer/jp/assets/_info.json`);
  return response.data;
};

export const fetchBuildData = async (modelName: string): Promise<BuildData> => {
  const url = `${ASSETS_BASE}/jp/live2d/chara/${modelName}_rip/buildData.asset`;
  const response = await axios.get(url);
  return response.data.Base;
};

export const getFileCount = (data: BuildData): number => {
  return 1 + 1 + data.textures.length + data.motions.length + data.expressions.length;
};

export const fetchModelSize = async (modelName: string, data: BuildData): Promise<number> => {
  const baseUrl = `/bestdori-assets/jp/live2d/chara/${modelName}_rip/`;
  const fileNames = [
    data.model.fileName,
    data.physics.fileName,
    ...data.textures.map((t) => t.fileName),
    ...data.motions.map((m) => m.fileName),
    ...data.expressions.map((e) => e.fileName),
  ];

  const sizes = await Promise.all(
    fileNames.map(async (f) => {
      try {
        const resp = await axios.head(`${baseUrl}${f}`);
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
