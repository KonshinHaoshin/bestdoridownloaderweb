export interface BundleFile {
  bundleName: string;
  fileName: string;
}

export interface BuildData {
  model: BundleFile;
  physics: BundleFile;
  textures: BundleFile[];
  transition: BundleFile;
  motions: BundleFile[];
  expressions: BundleFile[];
}

export interface MotionFile {
  file: string;
}

export interface ExpressionFile {
  name: string;
  file: string;
}

export interface Live2dModel {
  model: string;
  physics: string;
  textures: string[];
  motions: Record<string, MotionFile[]>;
  expressions: ExpressionFile[];
}

export interface CharacterInfo {
  characterType: string;
  characterName: string[];
  nickname: (string | null)[];
}

export type CharaRoster = Record<string, CharacterInfo>;

export interface CostumeInfo {
  characterId: number;
  assetBundleName: string;
  description?: string[];
}

export type CostumeMap = Record<string, CostumeInfo>;
