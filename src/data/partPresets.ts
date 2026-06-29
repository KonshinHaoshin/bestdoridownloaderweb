import type { PartCategory } from '../types';

export const PART_CATEGORIES: PartCategory[] = ['后发', '身体', '脸', '帽子'];

export const PART_PRESETS: Record<PartCategory, string[]> = {
  后发: ['PARTS_01_HAIR_BACK_001'],
  身体: [
    'PARTS_01_ARM_R_001',
    'PARTS_01_ARM_L_001',
    'PARTS_SKIRT',
    'PARTS_01_BODY',
    'PARTS_LOWER_BODY',
  ],
  脸: [
    'PARTS_01_FACE_001',
    'PARTS_01_CHEEK_001',
    'PARTS_01_EYE_R_001',
    'PARTS_01_EYE_L_001',
    'PARTS_01_BROW_001',
    'PARTS_01_TEAR_001',
    'PARTS_01_MOUTH_001',
    'PARTS_01_NOSE_001',
    'PARTS_01_EAR_001',
    'PARTS_01_HAIR_FRONT_001',
    'PARTS_01_HAIR_SIDE_001',
  ],
  帽子: ['PARTS_HAT', 'PARTS_01_HAT'],
};

export type PartPresetName = '全部' | '脸' | '身体' | '后发' | '无';

export const PART_PRESET_MAP: Record<PartPresetName, PartCategory[]> = {
  全部: ['后发', '身体', '脸', '帽子'],
  脸: ['脸', '帽子'],
  身体: ['身体'],
  后发: ['后发'],
  无: [],
};

export const PART_PRESET_OPTIONS = Object.keys(PART_PRESET_MAP) as PartPresetName[];
