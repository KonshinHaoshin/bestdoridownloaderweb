import axios from 'axios';
import { BuildData, CharaRoster } from '../types';

// Use proxy in development, full URL in production if needed
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

export const getAssetsBaseUrl = (modelName: string) => {
  return `https://bestdori.com/assets/jp/live2d/chara/${modelName}_rip/`;
};
